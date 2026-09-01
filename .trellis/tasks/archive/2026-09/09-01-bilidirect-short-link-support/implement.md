# 实施计划：bilidirect B站短链接接入

## 目标

在不改动挑战生命周期和播放契约的前提下，让 Worker 和仍在使用的直接播放器路径调用 bilidirect main 的 `url` 输入能力，并完成文案、测试与发布前验证。

## 有序清单

1. **锁定输入契约与共享校验**
   - 在 Worker adapter 中增加受限的 B站视频页/`b23.tv` 输入解析与请求体构造。
   - 保持 exact BV 兼容，并拒绝任意外部、QQ 和未支持短链。
   - 复查现有 retry/timeout/body-limit/API key 逻辑没有被短链分支绕过。
2. **接入 Worker creator parse**
   - 修改 `/api/bilibili/parse` 仅调用共享解析/resolve 入口，不再先行拒绝 `b23.tv`。
   - 确认成功返回仍签发同一种 video ticket，短链的 `source` 诊断不进入 ticket 或持久化数据。
3. **同步直接播放器兼容路径**
   - 让 `parseBilibiliInput`/请求 helper 对 `b23.tv` 发送 `url`；保留 `parseVideoByBvid` 兼容包装和 B站媒体 fallback。
   - 不扩大到 QQ 小程序或 bilidirect 未承诺的短链域名。
4. **更新用户可见文案与项目说明**
   - 更新制作页、直接播放器 hint 和 README，说明可直接粘贴 `b23.tv` 短链。
   - 移除“先打开短链再复制地址”的旧指引；错误仍使用普通用户可理解的恢复动作。
5. **补充/调整回归测试**
   - Worker adapter：BV、标准 URL、短链、非法主机、上游错误、source 脱敏和请求体断言。
   - Client helper/player：短链输入请求、成功响应、QQ/不支持域名错误和现有超时/取消行为。
6. **全量质量门禁**
   - 运行 lint、type-check、Worker/前端全量测试、生产 build、`wrangler deploy --dry-run` 和 `git diff --check`。
   - 检查变更只覆盖本任务文件；不纳入已有未跟踪资料或其他任务的工作区改动。

## 验证命令

```powershell
npm run lint -- --no-warn-ignored
npm run type-check
npm test -- --run
npm run build
npx wrangler deploy --dry-run
git diff --check
```

## 风险与回滚点

- **风险**：若直接把原始字符串交给上游而跳过 allowlist，可能形成任意 URL 代理；必须以共享 host/path 校验为前置。
- **风险**：只改 Worker 而遗漏旧 direct-player helper，会造成不同入口行为不一致；测试两条调用路径。
- **风险**：把 `data.source` 或 `resolvedUrl` 合并进播放/签名对象，会扩大 token 和隐私面；只消费既有稳定字段。
- **回滚**：回滚本任务提交即可恢复原有 BV-only 解析，不涉及 D1 migration、token schema 或生产数据。

## 开始实施前检查

- [ ] `prd.md`、`design.md`、本文件已审阅，且没有阻塞产品决策。
- [ ] `implement.jsonl` 与 `check.jsonl` 已填入真实规范/研究文件。
- [ ] 用户明确批准本次规划后，再执行 `task.py start` 和代码修改。
