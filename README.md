# 绷绷炸弹

一个部署在 Cloudflare Workers + D1 上的临时“绷住挑战”网站。视频由浏览器直接读取 B 站 CDN，摄像头与 MediaPipe 表情检测全部在浏览器本地运行；Worker 只中转解析/弹幕等轻量请求并保存一次最终结果。

## 本地开发

需要 Node.js 20+。首次运行：

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
npx wrangler d1 migrations apply bengbeng-bomb-db --local
npm run build
npx wrangler dev
```

编辑 `.dev.vars`，填写至少 32 字符的随机 `APP_SIGNING_SECRET` 和已有 bilidirect 服务的 `BILIDIRECT_API_KEY`。在 `wrangler.jsonc` 中把 `BILIDIRECT_BASE_URL` 改为已有后端地址。不要提交 `.dev.vars`。

若要分别调试 Vite 前端，可在一个终端运行 `npx wrangler dev`，另一个运行 `npm run dev`；Vite 会把 `/api` 代理到 `127.0.0.1:8787`。摄像头必须运行在 HTTPS 或 localhost 安全上下文中。

## 可配置生命周期

这些是 Worker 的普通环境变量，修改部署配置即可，不需要改业务代码或重新构建前端：

- `CHALLENGE_TTL_HOURS`：未完成挑战有效期，默认 `48`
- `RESULT_TTL_HOURS`：完成后私人结果保留期，默认 `48`
- `VIDEO_TICKET_TTL_MINUTES`：创建阶段视频票据有效期，默认 `15`
- `BILIBILI_QN`：请求的 B 站清晰度，默认 `80`

每小时 Cron 删除过期私人会话；`video_stats` 和 `video_fail_buckets` 是不可关联昵称/留言的匿名聚合，不随私人结果销毁。

## Cloudflare 部署

1. 创建 D1 数据库并把实际 `database_id` 写入 `wrangler.jsonc`。
2. 执行 `npx wrangler d1 migrations apply bengbeng-bomb-db --remote`。
3. 用 `npx wrangler secret put APP_SIGNING_SECRET` 和 `npx wrangler secret put BILIDIRECT_API_KEY` 配置 Secret。
4. 执行 `npm run check` 和 `npx wrangler deploy --dry-run`，确认后再运行 `npx wrangler deploy`。

回滚时部署上一版 Worker bundle。v1 migration 只有新增表与索引，不应在回滚中删除表。更换签名 Secret 会使尚未过期的既有链接失效。

## 隐私与限制

- 摄像头帧、landmark、blendshape、逐帧 Smile Score 不会进入网络请求或 D1。
- D1 只保存打开/开始/完成状态、最终结果、失败秒数和 attempt token 的 SHA-256 摘要；不保存昵称、留言、公私凭证或摄像头数据。
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
