# 接入 bilidirect B站短链接解析

## 目标与用户价值

让用户在制作挑战时可以直接粘贴 bilidirect 已支持的 B 站短链接（`b23.tv`），点击一次“解析视频”即可继续制作挑战，不再需要先手动打开短链、再复制跳转后的长视频页地址。现有 BV 号和标准 B 站视频页流程必须保持不变。

## 已确认事实

- `https://github.com/xmbhjQAQ/bilidirect` 的 `main` 分支当前提交 `2a2110a74b1fc990138ad77cd401e7344125b25d` 已支持 `GET/POST /api/parse` 的 `url` 参数。
- 上游 `url` 支持标准 B 站视频页和 `b23.tv` 短链，由服务端跟随有限次重定向并提取 BV 号；成功响应仍包含现有视频元数据、媒体候选和弹幕字段，并额外提供 `data.source` 诊断信息。
- 当前 Worker 在 `src/worker/index.ts` 先调用 `parseDirectBvid`，`src/worker/bilibili/adapter.ts` 始终向上游发送 `bvid`，因此短链会在到达 bilidirect 前被拒绝。
- 当前主制作页 `ComposerView` 已将用户输入原样提交给 `/api/bilibili/parse`，但提示文案仍要求用户手动展开短链；旧的直接播放器路径也将短链标记为不支持。

## 需求

### R1. 支持范围

- 接受精确 BV 号、标准 B 站视频页（包括常见查询参数）和 `b23.tv` 短链。
- 仅接受受支持的 B 站主机名或 `b23.tv` 主机名；QQ 小程序分享地址、其他短链域名和任意外部 URL 继续拒绝。
- 输入应在 Worker 侧完成裁剪、格式和主机校验；短链解析由 bilidirect 服务端完成，浏览器不得自行跟随短链。

### R2. Worker 与上游契约

- `/api/bilibili/parse` 对 BV 输入和可本地提取 BV 的标准 B 站页面继续发送 `bvid`；仅对 `b23.tv` 短链发送 `url`，并保留现有 `page/qn/fnval/fourk/probe` 参数、超时、重试、响应体上限和服务端 `X-API-Key` 约束。
- 上游返回的 `data.source` 仅用于诊断，不进入签名挑战、D1 或公开/私密结果；挑战仍只保存稳定 BV 元数据和经过清理的媒体候选。
- 短链解析成功后，后续挑战创建、打开、播放、弹幕、刷新和结算流程与标准视频页完全一致。

### R3. 前端体验与文案

- 制作挑战页和仍在使用的直接播放器入口都明确说明支持 `b23.tv` 短链，成功解析后不要求用户二次复制长链接。
- 解析失败时保留输入并显示普通用户可理解的恢复提示；不展示 endpoint、HTTP 状态、上游实现或 token/key 信息。
- 输入校验和请求失败不能造成页面刷新或白屏。

### R4. 回归与可验证性

- 增加 Worker adapter 对短链 URL 请求体、标准 URL、BV 输入、非法主机和上游错误的测试。
- 增加客户端输入解析/请求体测试，证明短链不再被标记为 `UNSUPPORTED_SHORT_LINK`，而 QQ/不受支持域名仍被拒绝。
- 现有挑战生命周期、媒体候选、弹幕、重试/超时和 API key 隔离测试继续通过。

## 验收标准

- [ ] AC1：输入 `https://b23.tv/<code>`（可带分享查询参数）点击解析后，Worker 向 bilidirect 发送 JSON `url` 字段；模拟上游成功响应时页面显示视频信息并可继续生成挑战。
- [ ] AC2：输入精确 BV 号或标准 B 站视频页仍发送原有 `bvid` 请求形状，解析结果与改动前兼容。
- [ ] AC3：非法主机、任意外部 URL、QQ 小程序链接和其他短链在 Worker/客户端边界被拒绝且不调用 bilidirect；错误文案可操作且不含内部细节。
- [ ] AC4：上游短链重定向失败、非 JSON、超时、5xx 或超大响应沿用现有安全错误映射和有界重试，不泄露 key、短链凭证或完整敏感 URL。
- [ ] AC5：解析成功后签名挑战、D1 记录、播放媒体、弹幕及刷新/结算链路只使用规范化 BV 元数据；`data.source` 不出现在 capability 或持久化投影中。
- [ ] AC6：主制作页、直接播放器路径和相关帮助文案不再要求用户手动展开 `b23.tv` 短链；普通用户看不到技术实现说明。
- [ ] AC7：lint、类型检查、全量前端/Worker 测试、生产构建和 `wrangler deploy --dry-run` 全部通过。

## 不在范围

- 修改 bilidirect 后端本身、其重定向策略、API key、VPS/Cloudflare Tunnel 或 B 站上游解析逻辑。
- 支持 QQ 小程序、`bili22.cn`/`bili23.cn` 等 bilidirect 当前未承诺的短链域名。
- 将 `source.resolvedUrl`、短链原文或临时 CDN 地址写入挑战 token、D1、排行榜、分享图或日志。
- 改变挑战生命周期、视频播放策略、弹幕协议、重试次数配置或页面路由流程。

## 阻塞问题

无。后端支持范围和兼容边界已从 main 分支 README/worker 契约确认；实现仍需在用户批准本规划后开始。
