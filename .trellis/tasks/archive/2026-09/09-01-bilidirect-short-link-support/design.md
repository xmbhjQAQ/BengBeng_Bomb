# 技术设计：bilidirect B站短链接接入

## 1. 变更边界

### 最小行为缺口

当前制作页把输入送到 Worker，但 Worker 只提取 BV 号并拒绝 `b23.tv`；因此后端已经具备的短链能力没有被调用。目标是让 Worker 在受信任的 B 站 URL 边界内把 URL 交给 bilidirect，并让仍在使用的直接播放器路径采用同一请求形状。

### 真实行为所在位置

- Worker 输入边界：`src/worker/index.ts` 的 `/api/bilibili/parse` 路由。
- 上游请求构造、超时/重试/响应清理：`src/worker/bilibili/adapter.ts`。
- 直接播放器输入解析与 bilidirect 请求：`src/client/gameplay/bilibili/bilibili.ts`、`useBilibiliPlayer.ts`。
- 主制作页用户提示：`src/client/app/ComposerView.tsx`；直接播放器提示：`src/client/gameplay/i18n/resources.ts`。

### 预期文件边界

- 必改：Worker adapter、Worker route、对应 Worker 测试。
- 需要同步：直接播放器 Bilibili 输入 helper/请求测试、制作页和直接播放器文案、README、相关 active specs。
- 不改：challenge token schema、D1 repository/schema、播放和弹幕协议、bilidirect 后端仓库。

## 2. 输入与请求数据流

```text
用户输入
  └─> 客户端仅做格式/主机提示（不跟随重定向）
       └─> POST /api/bilibili/parse { input }
            └─> Worker parseBilibiliInput
                 ├─ exact BV       -> bilidirect { bvid, ... }
                 ├─ B站视频页 URL  -> bilidirect { bvid, ... }（本地提取，保持兼容）
                 └─ b23.tv 短链    -> bilidirect { url, ... }
                                      └─> bilidirect 服务端有限重定向
                                           └─> sanitized PlaybackData
                                                └─> video ticket/challenge
```

Worker 必须保持 URL allowlist，不能把新增的 `url` 字段变成任意目标代理：

- 允许 `bilibili.com`、`www.bilibili.com`、`m.bilibili.com` 的 `/video/BV...` 路径；这类页面本地提取 BV 后继续发送 `bvid`。
- 允许 `b23.tv`（以及与上游一致的 `*.b23.tv`）短链，并仅将这类无法本地解析的输入发送为 `url`。
- exact BV 号继续走 `bvid` 分支。
- 其他主机、QQ 小程序、其他短链域名在本地边界返回 400，不访问上游。

URL 只用于本次解析请求；成功后以响应里的规范化 BV 号和现有稳定元数据构造 `PlaybackData`。`data.source` 不加入 `PlaybackData`、签名 payload、D1 或日志。

## 3. Adapter 接口策略

将现有 `resolveBilibili` 扩展为接受“视频输入”而不是只接受 BV 字符串，或提取一个共享的 `parseBilibiliInput`/request-body builder；所有调用方都复用同一验证和构造逻辑，避免 Worker 与客户端各自实现一套短链规则。

兼容要求：

- 保留对现有 `resolveBilibili(bvid, ...)` 调用的行为和测试。
- 保留服务端 API key 只放在 `X-API-Key`，不把 key 拼到用户可见 URL 或错误信息。
- 保留现有总超时、可配置重试（默认 3 次额外尝试）、响应体上限、内容类型检查、响应体取消和安全错误映射。
- 对短链上游 400/502/503/504/超时使用与标准 URL 相同的错误边界；不在 Worker 中自行等待或解析上游重定向。

客户端直接播放器路径可以新增 `parseVideoByInput`，让 `parseVideoByBvid` 继续作为兼容包装器。短链请求体使用 `url`，成功响应必须从服务端返回的 `bvid` 生成稳定 selection；没有有效 BV 号时按普通解析失败处理。

## 4. 前端兼容与文案

- 主制作页继续把原始输入交给 Worker；只更新 hint，明确“支持 B站视频页和 b23.tv 短链”。
- 直接播放器 helper 允许 `b23.tv`，但仍拒绝 QQ 小程序和其他后端未承诺的域名。
- 失败保留输入并提供重试，不展示 `source.resolvedUrl`、HTTP 状态、endpoint、API key 或 token 细节。
- 不改变 `/`、`/c/<token>` 或群组路径，也不新增页面跳转。

## 5. 测试设计

### Worker

- 精确 BV、标准 B站视频页（含 query）构造兼容的 `bvid` 请求体；`b23.tv` 短链构造 `url` 请求体。
- `b23.tv` 短链构造 `url`，上游成功响应被规范化为现有 `PlaybackData`。
- `evil.example/BV...`、QQ 小程序、`bili23.cn` 等被拒绝且 fetch 调用次数为 0。
- 上游响应中包含 `source` 时，结果和序列化 token 不含该诊断对象。
- 现有 4xx、5xx、超时、响应体上限、重试和 API key 断言保持通过。

### Client

- `parseBilibiliInput` 对 `b23.tv` 返回 URL 输入，不再抛 `UNSUPPORTED_SHORT_LINK`。
- `parseVideoByInput` 对短链发送 `{ url, page, qn, ... }`，对标准页面继续发送 `{ bvid, page, qn, ... }`，并能消费与现有字段相同的成功响应。
- QQ 小程序/不支持域名仍给出友好错误。
- hint/README 文案与真实能力一致。

## 6. 回滚与发布

- 代码回滚点为本任务提交；回滚后仅恢复“短链需手动展开”的旧行为，不影响现有 BV 挑战 token 与 D1 数据。
- 不需要数据库迁移或生产数据写入。
- 上线前通过本地模拟短链响应、完整测试、构建和 Wrangler dry-run；部署后再用一条真实 `b23.tv` 链接烟测解析和挑战创建。
