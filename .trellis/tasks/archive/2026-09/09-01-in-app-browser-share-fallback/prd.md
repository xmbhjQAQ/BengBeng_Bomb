# 修复内置浏览器引导与系统分享降级

## Goal

让 QQ/微信内置浏览器中的用户能明确知道如何切换到可用的系统浏览器，并让“系统分享图片”在桌面端或移动端能力受限时始终给出可执行的结果，而不是看起来没有反应。

## Background and confirmed facts

- 应用是由 `src/client/app/App.tsx` 统一承载的 SPA，所有路由都经过同一个应用外壳，因此浏览器环境提示可以在全站统一展示。
- 当前已在摄像头挑战路由提供 QQ/微信内置浏览器提示；本次补充 iOS WebKit 放行和遮罩内复制挑战网址入口。
- `ComposerView` 的“系统分享图片”会预先生成 PNG `File`，再要求 `navigator.canShare({ files })` 为真后调用 `navigator.share({ title, files })`；不支持或失败时自动复制分享文案并显示手动复制按钮。
- 桌面 Edge 通常没有可调用的 Web Share 系统面板；移动浏览器对文件分享、用户激活和 `canShare` 的支持也可能不一致。`navigator.share()` 必须由用户激活触发，`canShare()` 只代表当前数据形态是否可分享（MDN Web Share API）。
- 现有产品约束是图片优先分享，系统分享数据不得携带挑战/结果 URL；不支持图片分享时需要提供复制分享文案兜底。
- 静态页面由 Worker 的 `secureAsset` 统一附加 CSP；Clarity 初始化脚本和 Cloudflare Pages Web Analytics 需要在这份策略中显式放行，否则浏览器会在发起请求前拦截。

## Requirements

### R0. Non-challenge pages return home

- Every non-challenge page exposes a clearly visible “回到首页” control: group entry, group results, public report, management and invalid-route/error pages.
- The control uses the existing SPA history/popstate shell to return to `/` without a document reload; it is not rendered on `/c/<token>` or `/g/<token>` challenge pages, including the in-page settlement stage.
- The homepage itself does not need a redundant home control. The control uses one consistent label and accessible link semantics across desktop and mobile layouts.

### R1. QQ/微信内置浏览器提示

- 使用浏览器 UA 识别 QQ 或微信内置浏览器；普通 Chrome、Edge、Safari 等不显示提示。iOS/iPadOS 不显示该遮罩，直接沿用 WebKit 摄像头能力。
- 只有真正会请求摄像头的单人挑战 `/c/<token>` 与群组挑战 `/g/<token>` 页面在 Android 或无法判断平台的 QQ/微信环境显示提示；首页、排行榜、群组入口、结果页和管理页不显示遮罩。
- 遮罩覆盖挑战页面并阻断底层交互，不改变当前路径，不刷新页面，不尝试强制拉起外部浏览器。
- 文案明确说明需要点击右上角菜单选择“在浏览器中打开”。
- Android 文案推荐 Edge 或 Via；无法判断平台时使用“系统浏览器”泛化文案。
- 遮罩提供“复制挑战网址”控件，复制当前挑战完整网址并反馈成功或失败；不得把长网址常驻展示在遮罩文案中。
- 遮罩使用可访问的警示语义和明确的操作指引，在窄屏下保持文案和按钮可读。

### R2. 系统图片分享可靠降级

- 保留图片优先原则：支持文件分享时只调用 `navigator.share({ title, files })`，不得把挑战链接、结果链接或管理凭证作为 `url`/`text` 传入。
- 不因 `navigator.canShare` 缺失而提前判定失败；在存在 `navigator.share` 但没有 `canShare` 时允许尝试调用，并捕获拒绝结果。
- 用户取消系统分享时仅提示“已取消系统分享”，不自动复制或下载，避免覆盖用户剪贴板。
- 浏览器/系统不支持或调用失败时，必须在同一页面显示可理解的反馈，并保留“复制分享文案”手动操作；分享文案仍包含完整公开挑战链接以便传播。
- 在支持 `ClipboardItem` 图片写入的环境中，失败降级优先尝试复制 PNG 图片，并同时提供手动复制分享文案；图片复制失败再自动复制分享文案。
- 现有“下载分享图”继续作为最终可用路径；任何降级都不得抛出未处理异常或导致页面导航。
- 分享按钮在生成图片期间保持禁用；重复点击不能并发触发多个系统分享或重复生成。

### R3. 统计脚本 CSP 兼容

- 保留现有 CSP 的收紧目标，不使用全局 `script-src 'unsafe-inline'`。
- 通过 Clarity 初始化内联脚本的固定 CSP 哈希允许该脚本执行，并放行 Clarity 官方脚本域名。
- 放行 Cloudflare Pages 自动注入的 `static.cloudflareinsights.com` beacon 脚本，使 Cloudflare Web Analytics 正常工作。
- 不改变摄像头、媒体、API、Worker 或页面路由行为；Clarity/Insights 请求失败时网站核心功能仍可用。

## Out of scope

- 不改变服务端 API、挑战/结果数据结构、二维码内容或链接有效期。
- 不为 QQ/微信实现自动 deep link、应用唤起或浏览器安装引导。
- 不把桌面浏览器伪装成支持系统分享；桌面端按能力检测走友好降级。
- 不新增第三方分享 SDK。

## Acceptance Criteria

- [x] Android QQ/微信打开 `/c/<token>` 或 `/g/<token>` 时显示全屏阻断遮罩，并提供“复制挑战网址”按钮；iOS/iPadOS QQ/微信打开同类页面不显示遮罩；普通 UA 不显示提示。
- [x] 首页、群组入口、结果页、管理页和排行榜不显示遮罩；Android/未知平台遮罩提示用户点击右上角菜单选择“在浏览器中打开”，并推荐 Edge/Via 或泛化为系统浏览器；底层摄像头与挑战控件不可操作。
- [x] 复制挑战网址按钮使用完整当前 URL，成功和失败均有可见反馈，不改变当前路由。
- [x] 群组入口、群组结果、公开战报、管理和错误页均有“回到首页”控件，点击后使用 SPA 导航且不刷新；单人/群组挑战页（包含结算阶段）没有该控件。
- [x] 支持文件分享时，系统分享调用参数只有标题和 PNG 文件，不含 `url` 或 `text`。
- [x] `navigator.share` 存在但 `navigator.canShare` 缺失时仍会尝试系统分享；`canShare` 返回假值、系统拒绝或异常时进入降级反馈。
- [x] 用户取消系统分享不会触发复制；其他失败会显示图片复制成功或分享文案复制成功，并显示手动“复制分享文案”控件。
- [x] 剪贴板 API 不可用或拒绝时，页面仍保留下载分享图与手动复制入口，且显示明确失败反馈。
- [x] 新增 UA、分享能力和组件交互测试；前端 lint、类型检查、全量测试和生产构建通过。
- [x] 静态资源 CSP 允许 Clarity 初始化哈希、Clarity 脚本域名和 Cloudflare Insights 脚本域名，且 `script-src` 未放宽为 `unsafe-inline`。

## Decisions

- Android/未知平台的 QQ/微信挑战页采用全屏阻断遮罩，因为这些内置浏览器无法可靠调用摄像头；iOS/iPadOS 使用 WebKit 摄像头能力，保持挑战页正常运行。遮罩内提供复制挑战网址作为用户切换浏览器的兜底入口。
