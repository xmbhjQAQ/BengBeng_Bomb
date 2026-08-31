# 绷绷炸弹

一个部署在 Cloudflare Workers + D1 上的临时“绷住挑战”网站。视频由浏览器直接读取 B 站 CDN，摄像头与 MediaPipe 表情检测全部在浏览器本地运行；Worker 只中转解析/弹幕等轻量请求并保存一次最终结果。

## 本地开发

需要 Node.js 20+。首次运行：

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
npx wrangler d1 migrations apply bengbeng_bomb --local
npm run seed:leaderboard # 可选：填充本地排行榜测试数据
npm run build
npx wrangler dev
```

`npm run seed:leaderboard` 只写入本地 D1，用于预览排行榜；不会修改远程数据库。

编辑 `.dev.vars`，填写至少 32 字符的随机 `APP_SIGNING_SECRET` 和已有 bilidirect 服务的 `BILIDIRECT_API_KEY`。在 `wrangler.jsonc` 中把 `BILIDIRECT_BASE_URL` 改为已有后端地址。不要提交 `.dev.vars`。

若要分别调试 Vite 前端，可在一个终端运行 `npm run dev:worker`，另一个运行 `npm run dev`；两者都会监听 `0.0.0.0`，Vite 会把 `/api` 代理到 `127.0.0.1:8787`。本机可访问 Vite 输出的 Local 地址，局域网设备可访问 Network 地址。摄像头必须运行在 HTTPS 或 localhost 安全上下文中，因此局域网设备请访问 Vite 输出的 HTTPS Network 地址并在测试设备上信任本地证书。监听所有网卡会让同一网络中的设备能够访问测试服务，测试完请关闭两个进程。

手机端最方便的测试方式是运行 `npm run dev:phone`。该命令会先构建前端，再通过 Wrangler Quick Tunnel 输出一个具有有效证书的临时 HTTPS 地址；用手机打开该地址即可测试摄像头。隧道运行期间网站可从公网访问，请勿分享地址，并在测试结束后按 `Ctrl+C` 关闭。

## 可配置生命周期

这些是 Worker 的普通环境变量，修改部署配置即可，不需要改业务代码或重新构建前端：

- `CHALLENGE_TTL_HOURS`：未完成挑战有效期，默认 `48`
- `RESULT_TTL_HOURS`：完成后私人结果及降采样表情曲线保留期，默认 `48`
- `VIDEO_TICKET_TTL_MINUTES`：创建阶段视频票据有效期，默认 `15`
- `LEADERBOARD_MIN_ATTEMPTS`：视频进入永久排行榜所需的最少完成次数，默认 `5`
- `LEADERBOARD_CACHE_SECONDS`：公开排行榜缓存时间，默认 `600`
- `LEADERBOARD_LIMIT`：排行榜返回条目上限，默认 `20`
- `BILIBILI_QN`：请求的 B 站清晰度，默认 `80`
- `PUBLIC_ORIGIN`：公开挑战、结果和战报链接使用的 HTTPS 根地址；部署环境应显式设置
- `APP_ENV`：部署环境标识；`staging`/`production` 会强制要求 `PUBLIC_ORIGIN`
- `BILIDIRECT_TIMEOUT_MS`：解析/弹幕上游超时，默认 `8000`，范围 `1000–20000`
- `BILIDIRECT_JSON_MAX_BYTES`：解析上游 JSON 大小上限，默认 `524288`
- `BILIDIRECT_TEXT_MAX_BYTES`：弹幕上游文本大小上限，默认 `4194304`

每小时 Cron 删除过期私人会话和群组记录；`video_stats` 和 `video_fail_buckets` 是不可关联昵称/留言的匿名聚合，不随私人结果销毁。

## Cloudflare 部署

1. 为 staging/production 分别创建 Worker、D1 和（可选但建议）三类 Rate Limiting namespace；不要复用本地 D1。
2. 把目标环境的实际 `database_id`、`PUBLIC_ORIGIN` 和 Rate Limiting binding 写入对应 Wrangler 环境，并运行 `npm run release:preflight -- --env <staging|production>`。
3. 执行 `npx wrangler d1 migrations apply DB --remote --env <target>`（`DB` 是该环境的绑定名，不要复用生产库名）。
4. 用 `npx wrangler secret put APP_SIGNING_SECRET --env <target>` 和 `npx wrangler secret put BILIDIRECT_API_KEY --env <target>` 配置 Secret。
5. 执行 `npm run check` 和 `npx wrangler deploy --dry-run --env <target>`；部署、真机验收和生产发布需要单独确认。

回滚时部署上一版 Worker bundle。现有 migrations 只新增表、列与索引，不应在回滚中删除表。更换签名 Secret 会使尚未过期的既有链接失效。

## 隐私与限制

- 摄像头帧、landmark、blendshape、原始及逐帧 Smile Score 不会进入网络请求或 D1；只上传每秒最多一个、总计不超过 600 个的 0–100 整数量化点。
- D1 保存打开/开始/完成状态、最终结果、失败秒数、attempt token 的 SHA-256 摘要，以及与私人结果同寿命的降采样曲线。群组挑战另外保存参与者自行填写的昵称、完成状态和坚持时间，结果链接有效期内持有统一结果链接的人都能看到；单人留言不会写入 D1。任何模式都不保存公私凭证或摄像头数据。
- 私人结果过期或主动销毁时同步删除曲线；排行榜只保留不可关联个人身份的视频元数据和永久匿名聚合。
- 管理凭证放在 URL fragment 中，并仅通过 `Authorization` 请求头发送。
- B 站临时视频 URL 不写入挑战凭证或 D1；打开挑战时会重新解析，视频主体不经过 Worker。
- 当前稳定支持 `bilibili.com/video/BV...` 直接链接。b23.tv、QQ 小程序等短链会提示用户先打开再复制 BV 地址。
- 浏览器端规则用于普通娱乐挑战，无法对抗主动篡改客户端的对手。B 站接口、CDN 防盗链和使用条款可能变化。

## 质量命令

```powershell
npm run type-check
npm run lint
npm test
npm run test:worker
npm run build
npm run check
```

产品源代码与构建配置不会导入 `模块化开发及技术验证成果` 或 `已有后端`；参考目录删除后不影响产品构建。MediaPipe 模型、WASM 和许可证已复制到 `public/vendor/mediapipe`。
