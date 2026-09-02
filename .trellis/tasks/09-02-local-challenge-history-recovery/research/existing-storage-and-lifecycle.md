# 现有浏览器存储与挑战生命周期核查

## 结论

本任务可在不修改 D1 表结构和 Worker API 的前提下完成。服务端已经保存尝试凭证的 SHA-256，并以单次状态转换保证结果只统计一次；缺口在于浏览器把原始尝试凭证仅放在 `sessionStorage`，以及创建结果只存在组件内存中。

## 代码证据

- `src/client/storage/session.ts` 只有安全降级的 `sessionStorage` 包装，没有持久化存储模块。
- `src/client/app/ComposerView.tsx` 的 `Created` 状态包含 `challengeUrl`、`manageUrl`、有效期及群组结果入口，但创建成功后没有写入浏览器持久化存储。
- `src/client/app/HomeView.tsx` 只有 `compose | leaderboard` 两个首页标签；排行榜中的 `self` 创建响应也只读取 `challengeUrl`，忽略了可供本机找回的 `manageUrl`。
- `src/client/app/ChallengeView.tsx` 使用以下会话键：
  - `bengbeng-attempt:<token>`
  - `bengbeng-group-attempt:<token>`
  - `bengbeng-group-attempt-id:<token>`
  - `bengbeng-completed:<token>`
- 单人挑战打开后若服务端为 `started` 且本地不存在尝试凭证，页面只能提示从原页面继续；服务端不会再次下发原始 bearer。
- 群组挑战每次 `/api/groups/start` 都创建独立 attempt；持久化并复用本次 `attemptToken + attemptId` 可以避免异常退出后误建第二条参与记录。
- `useSmileDemo` 的校准、摄像头、视频进度和过程分数均是内存状态；页面隐藏会使当前挑战失效。因此精确续播既不自然，也会扩大需要持久化的敏感状态。

## 约束

- 创建者管理链接和尝试 bearer 都是能力凭证。保存到 `localStorage` 会延长同源脚本可读取它们的时间，因此必须依赖现有严格 CSP、限制保存期限、避免分析/日志采集，并提供清除入口。
- `localStorage` 和 IndexedDB 都不能防御已经成功执行的同源 XSS；本任务数据量很小，采用带 schema 校验的 `localStorage` 比 IndexedDB 更简单。
- HTTP 缓存与 Service Worker 缓存不适合保存私密入口：它们面向请求响应资源、清理规则不可控，也不提供适合本任务的结构化更新模型。
- 浏览器存储被禁用、清空或跨设备时无法恢复原始 bearer；服务端只有哈希，不能反推出凭证。这是无账号体系前提下的明确边界。

## 后端负担

- 保存、读取昵称和本机挑战列表全部发生在浏览器，不产生 Worker 请求或 D1 写入。
- 恢复挑战复用原 attempt，不再次调用 `/start`；只保留现有 `/open`、媒体解析和最终 `/complete` 请求。
- “我的挑战”不轮询；打开已有管理/结果入口时才执行现有查询，因此不会形成常驻请求负担。
