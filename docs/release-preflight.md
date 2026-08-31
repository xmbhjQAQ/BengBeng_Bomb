# 发布环境预检

本仓库的根 `wrangler.jsonc` 只用于本地开发，D1 ID 是故意保留的占位值。发布前请在本地未提交的 `wrangler.jsonc` 中增加 `env.staging` / `env.production`，每个环境独立配置 Worker 名称、D1 binding、`PUBLIC_ORIGIN` 和三类 Rate Limiting binding：

```jsonc
"env": {
  "staging": {
    "name": "bengbeng-bomb-staging",
    "vars": { "APP_ENV": "staging", "PUBLIC_ORIGIN": "https://staging.example.com" },
    "d1_databases": [{
      "binding": "DB",
      "database_name": "bengbeng-bomb-staging-db",
      "database_id": "<real-staging-d1-id>",
      "migrations_dir": "migrations"
    }],
    "ratelimits": [
      { "name": "RATE_LIMITER_EXPENSIVE", "namespace_id": "<namespace-id>", "simple": { "limit": 20, "period": 60 } },
      { "name": "RATE_LIMITER_MUTATION", "namespace_id": "<namespace-id>", "simple": { "limit": 60, "period": 60 } },
      { "name": "RATE_LIMITER_PUBLIC", "namespace_id": "<namespace-id>", "simple": { "limit": 120, "period": 60 } }
    ]
  }
}
```

不要把真实 ID 或 Secret 写进提交。先执行：

```powershell
npm run release:preflight -- --env staging
npx wrangler d1 migrations apply bengbeng-bomb-db --remote --env staging
npx wrangler secret put APP_SIGNING_SECRET --env staging
npx wrangler secret put BILIDIRECT_API_KEY --env staging
npm run release:preflight -- --env staging --secrets-checked
npx wrangler deploy --dry-run --env staging
```

`--secrets-checked` 只表示操作者已经用 Wrangler 配置并核对两个 Secret；脚本不会读取或打印 Secret 值。生产环境沿用同样顺序，先完成 staging 自动/真机验收，再单独批准 production deploy。
