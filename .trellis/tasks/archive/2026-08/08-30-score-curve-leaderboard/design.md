# 表情曲线与难绷排行榜 — Technical Design

## 1. Boundaries and invariants

- 摄像头帧、landmarks、blendshapes 与逐帧原始信号继续只存在浏览器内。
- 允许提交的数据仅扩展为降采样后的 `{ timeSeconds, score }[]`：视频时间为非负数，score 为 0–100 整数，按时间严格递增。
- 单次曲线与完成 session 同寿命，使用同一个 `result_expires_at`；匿名 `video_stats` 与排行榜视频目录为永久累计数据。
- 首页“制作挑战 / 难绷排行”是 `/` 内部视图状态，不改变 URL。进入实际单人挑战时使用 History API 把 URL 更新为 `/c/<token>`，但不触发文档刷新，并继续复用现有 `ChallengeView`。

## 2. Score trace capture and payload

`useInferenceSession` 在正式挑战的有效 sample 上记录曲线。采样桶宽为：

```text
max(1 second, ceil(videoDurationSeconds / maxPoints))
```

同一桶仅保留最新平滑分数，结束时输出至多 `CLIENT_CONFIG.scoreTrace.maxPoints` 个点；服务端再次校验长度、单调时间、视频时长和 0–100 整数范围。暂停、丢脸、buffering 期间不制造样本或补点。

完成请求扩展：

```ts
interface ScorePoint { timeSeconds: number; score: number }
POST /api/challenges/complete {
  challengeToken: string;
  attemptToken: string;
  outcome: 'held' | 'failed';
  elapsedSeconds: number;
  scoreTrace: ScorePoint[];
}
```

`LocalChallengeResult` 升级 schema，并冻结曲线快照，保证提交失败后的重试发送完全相同的数据。

## 3. Persistence and report resolution

新增迁移：

- `challenge_score_traces(challenge_id PRIMARY KEY, points_json, expires_at)`；首次完成时写入，幂等重试不覆盖。
- `video_catalog(video_key PRIMARY KEY, bvid, cid, page, title, cover, duration_seconds, updated_at)`；挑战 open 时从已签名 payload upsert。
- `video_stats` 增加 `last_completed_at`，用于稳定 tie-break 和后续扩展。

`ReportPayload` 增加可选 `resultRef`（challenge id）以兼容已有 v1 报告。`/api/reports/resolve` 只在报告 token 有效时读取对应曲线；旧报告或无曲线返回空数组。`destroy` 显式先删曲线再删 session；定时 cleanup 同时按 `expires_at` 删除残留曲线。

隐私说明改为：只上传最终结果、坚持秒数和每秒最多一个的 0–100 表情程度值；不上传图像和人脸特征。

## 4. Curve visualization

结算 `Stats` 上方新增原生 SVG `ScoreTraceChart`，不引入图表依赖：

- 横轴为视频时间，纵轴为“表情变化 0–100”；0 表示稳定，越高越接近破防。
- 显示危险阈值与失败阈值参考线，失败结果标记爆炸点，成功结果标记视频终点。
- 每个点具备可访问名称；触摸/键盘聚焦可读取时间和分数，旁边提供峰值、危险区间等文字摘要。
- 0/1 个样本、全相同分数、长视频、失败/成功及空曲线均有确定布局；`prefers-reduced-motion` 禁用绘制动画。
- 同页结算使用本地 immutable trace；公开报告使用 resolve API 返回的 trace。

## 5. Permanent video leaderboard

新增 `GET /api/leaderboard`，返回 Top N 视频：

```ts
interface LeaderboardEntry {
  rank: number;
  video: VideoMetadata;
  total: number;
  held: number;
  failed: number;
  failureRate: number;
  averageElapsedRatio: number;
  difficultyScore: number;
}
```

仅 `total >= LEADERBOARD_MIN_ATTEMPTS` 的视频入榜。难绷指数使用可解释的固定公式：

```text
100 × (0.7 × failureRate + 0.3 × (1 - averageElapsedSeconds / durationSeconds))
```

各项 clamp 到 0–1，结果保留一位小数；按 difficultyScore、total、last_completed_at、video_key 依次排序，保证稳定。MVP 永久累计，不维护日期桶。

Worker 配置新增并做边界校验：

- `LEADERBOARD_MIN_ATTEMPTS`：默认 5。
- `LEADERBOARD_CACHE_SECONDS`：默认 600。
- `LEADERBOARD_LIMIT`：默认 20。

客户端仅首次进入榜单视图时请求。Worker 先查 `caches.default`，未命中才查 D1，并通过 `ctx.waitUntil(cache.put(...))` 写入公共短缓存；完成挑战不主动 purge，榜单允许最多一个 TTL 的延迟。

## 6. Homepage interaction and challenge actions

新增 `HomeView` 作为 `/` 根视图，顶部使用 segmented tabs：

- 默认“制作挑战”，保留当前 Composer 的所有表单状态。
- “难绷排行”作为独立主面板，含加载、空、错误/重试、Top 3 强调与普通列表；切换不修改 URL，不刷新，两个面板不会同时暴露给辅助技术。
- 切换带短距离 fade/slide，并尊重 reduced motion；移动端 tab 固定可触达，榜单卡片不横向溢出。

每条榜单有两个 CTA：

1. **我来挑战**：调用既有 parse 获取新 video ticket，再以 `mode: 'self'` 创建免昵称挑战；成功后 `history.pushState` 到 `/c/<token>` 并在同一 React root 渲染 `ChallengeView`。介绍页统一显示“单人挑战”。
2. **分享给朋友**：获取/复用新 video ticket，切回 Composer 的装填步骤并保留解析后视频；用户继续填写发起人、接收者和留言。

`ChallengePayload.mode` 扩展为 `'classic' | 'self'`，`initiator` 对 self 可省略。经典挑战合同不变；报告不展示 self 的虚构身份。App 增加最小的 reactive navigation state 和 `popstate` 监听，不引入路由库。

## 7. Compatibility, risk and rollback

- 旧 challenge/report token 没有 `resultRef` 或 self mode，decoder 必须继续接受。
- 排行榜视频媒体地址不入库；点击挑战时重新通过已有 Worker/Bilidirect 解析，以免复用过期直链。
- Cache API 在本地/测试不可用时直接回源 D1，不影响正确性。
- 迁移只新增表/列；前端与 API 可独立回滚，新增持久化数据不会破坏旧读取。
- 最大风险是 complete payload 扩大和幂等写入；服务端长度限制、冻结本地 result 与仓储测试共同保护。

## 8. Validation

- 单元/组件：采样降频、曲线模型/SVG/可访问性、Home tab 状态保持、榜单加载状态与双 CTA、self 文案。
- Worker/仓储：曲线校验、首次完成写入、重试幂等、TTL 删除、旧报告兼容、video catalog upsert、门槛/排序/公式、缓存命中。
- 全量：lint、type-check、前端/Worker tests、build、Wrangler dry-run、桌面与 390px 首页/榜单/结算可视检查。

