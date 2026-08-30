# 表情曲线与难绷排行榜 — Implementation Plan

## Workstream 1 — Contracts, config and migration

- [ ] 扩展共享 score trace、leaderboard、self challenge/report 合同并保持旧 token 兼容。
- [ ] 增加 client score trace 上限及 Worker leaderboard 门槛/缓存/limit 配置与测试。
- [ ] 新增 D1 migration：score traces、video catalog、stats tie-break 字段。

## Workstream 2 — Trace capture, completion and report

- [ ] 在 inference session 按动态时间桶记录有效平滑分数，reset/restart 正确清空。
- [ ] 将 immutable trace 放入 LocalChallengeResult；完成重试复用相同 payload。
- [ ] Worker 严格校验并幂等保存 trace，使用 `RESULT_TTL_HOURS` 的 result expiry。
- [ ] report token/resolve 返回仍有效的 trace；destroy/cleanup 删除 trace。
- [ ] 更新隐私说明与提交态文案。

## Workstream 3 — Curve UI

- [ ] 创建无依赖 SVG 曲线模型与组件，覆盖轴、阈值、爆炸/终点、摘要和空状态。
- [ ] 在本地结算及公开报告的热力图上方接入，保证触屏/键盘/reduced motion 可用。
- [ ] 增加空、单点、常量、长序列、成功与失败测试。

## Workstream 4 — Leaderboard backend

- [ ] open 时 upsert video catalog，complete 时维护永久 aggregate/last_completed_at。
- [ ] 实现门槛过滤、难绷指数、稳定排序和 Top N 仓储查询。
- [ ] 实现 `GET /api/leaderboard` 与 Cache API read-through；本地无 Cache API 安全回源。
- [ ] 增加仓储/API/缓存命中、过期与配置测试。

## Workstream 5 — Homepage and actions

- [ ] 建立 HomeView 双视图及可访问 tab，Composer 状态跨切换保持。
- [ ] 实现榜单卡片、加载/空/错误重试、响应式布局与动效。
- [ ] “分享给朋友”解析并回填 Composer 装填步骤。
- [ ] 新增 self 创建模式；“我来挑战”一键创建并 SPA push 到 ChallengeView。
- [ ] 统一单人模式文案为“单人挑战”，旧经典挑战展示不变。
- [ ] 增加 popstate/back 行为与无刷新断言。

## Validation

- [ ] `npm run lint`
- [ ] `npm run type-check`
- [ ] `npm test`
- [ ] `npm run test:worker`
- [ ] `npm run build`
- [ ] `npx wrangler deploy --dry-run`
- [ ] 桌面和 390px 检查：首页 tab → 榜单 → 分享给朋友 / 我来挑战 → 结算曲线 → 公开报告。

## Risky files / rollback points

- `src/worker/index.ts`：API 目前集中在单文件，新增路由需保持旧接口分支和错误映射。
- `src/worker/repositories/sessions.ts`：complete 幂等与多表写入不可重复累计。
- `src/client/gameplay/app/useInferenceSession.ts`：只记录输出，不改变评分/判负状态机。
- `src/client/app/App.tsx`、`ComposerView.tsx`：SPA navigation 与表单保活边界。
- `src/client/app/Settlement.tsx`、`ReportView.tsx`：本地/远端 trace 数据源不同但共享同一图表。

