# Task: Migrate Content Scheduler to Cloudflare Workers Cron

## Goal

将 Python 版 `workers/scheduler.py`（内容发现调度器）迁移为 CF Workers Cron Trigger，随现有 `api/` 一起部署，去掉对 VPS 常驻进程的依赖。

## Current State

- **Scheduler**: Python 脚本，`asyncpg` 长连接，`run_loop()` 每 5 分钟轮询
- **运行方式**: 需要在 VPS 上单独启动 `python -m workers.scheduler`
- **问题**: `docker-compose.worker.yml` 中没有 scheduler 服务，实际上没有在任何地方自动运行
- **CF Workers API**: 已部署在 `api.cerul.ai`，Hono + Neon serverless，无 cron trigger

## Architecture After This Task

```
CF Workers (cerul-api)
  ├── HTTP Routes (existing — search, index, admin, etc.)
  └── Cron Trigger (NEW — every 5 minutes)
        └── scheduled() handler
              ├── Query content_sources (Neon)
              ├── Discover new videos (YouTube RSS/API, Pexels, Pixabay)
              ├── Insert processing_jobs (Neon)
              ├── Update sync_cursor (Neon)
              └── Backfill channel metadata (YouTube API + R2)
```

## Why CF Workers

| | VPS 常驻进程 | CF Workers Cron |
|---|---|---|
| 运维 | 需要手动启动、监控、重启 | 零运维，自动调度 |
| 成本 | 占 VPS 资源 | 免费（Workers Free 10ms CPU/invocation，Cron 免费） |
| 可靠性 | VPS 重启/OOM 后需恢复 | CF 保证触发 |
| 部署 | 独立部署流程 | 随 API 一起 `wrangler deploy` |
| 复杂度 | Python + asyncpg | TypeScript + Neon serverless（复用现有 API 代码） |

## Implementation Plan

### Step 1: wrangler.toml 添加 Cron Trigger

```toml
# 在 wrangler.toml 顶层添加
[triggers]
crons = ["*/5 * * * *"]   # 每 5 分钟
```

staging 环境也加（可用更低频率测试）：

```toml
[env.staging.triggers]
crons = ["*/10 * * * *"]
```

### Step 2: 修改 api/src/index.ts 导出 scheduled handler

CF Workers Cron 需要 `export default { scheduled() }` 而非纯 Hono app。

```typescript
// api/src/index.ts
import { runScheduledDiscovery } from "./scheduled/discovery";

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduledDiscovery(env));
  },
};
```

### Step 3: 新增 api/src/scheduled/discovery.ts

核心调度逻辑，TypeScript 重写。主要函数：

```
api/src/scheduled/
  └── discovery.ts        # 主入口
```

**逻辑流程（对应 Python scheduler.run_once）**：

1. `createDatabaseClient(env)` 获取 Neon 连接
2. `SELECT * FROM content_sources WHERE is_active = TRUE`
3. 对每个 source 调用对应的 discover 函数：
   - `discoverYouTubeItems(source)` — RSS feed 优先，fallback 到 Search API
   - `discoverYouTubeSearchItems(source)` — YouTube 搜索 + 可选 LLM filter
   - `discoverPexelsItems(source)` — Pexels 视频搜索
   - `discoverPixabayItems(source)` — Pixabay 视频搜索
4. 去重：检查 `processing_jobs` 中是否已存在
5. 插入新 `processing_jobs`（status='pending'）
6. 更新 `sync_cursor`
7. 回填 YouTube 频道元数据 + 镜像头像到 R2

### Step 4: YouTube Client (TypeScript)

新建 `api/src/services/youtube.ts`，用 `fetch()` 替代 `httpx`：

需要实现的方法（对应 Python `YouTubeClient`）：

| 方法 | 用途 | API Quota |
|------|------|-----------|
| `getRssVideoIds(channelId)` | RSS feed 发现新视频 | 0（免费） |
| `searchChannelVideos(channelId, maxResults)` | 频道视频搜索 | ~100 units |
| `searchVideos(query, maxResults, publishedAfter)` | 关键词搜索 | ~100 units |
| `getVideosByIds(videoIds)` | 批量获取视频元数据 | ~1 unit/50 |
| `getChannelsInfo(channelIds)` | 批量获取频道信息 | ~1 unit/50 |

RSS feed URL: `https://www.youtube.com/feeds/videos.xml?channel_id={id}`
需要 XML 解析，Workers 环境下可用 `fast-xml-parser` 或简单正则提取 video ID。

### Step 5: Pexels / Pixabay Client

新建 `api/src/services/pexels.ts` 和 `api/src/services/pixabay.ts`。
逻辑简单，各一个 `searchVideos()` 函数，直接 `fetch()` 调对应 API。

### Step 6: LLM Relevance Filter（可选）

YouTube search source 的 `llm_filter` 功能，调 Gemini API 做语义过滤。
新建 `api/src/services/llm-filter.ts`，用 `fetch()` 调 Gemini REST API。

已有 `GEMINI_API_KEY` secret，可复用。

### Step 7: R2 Avatar Mirroring

频道头像镜像。CF Workers 可直接用 R2 binding（`QUERY_IMAGES_BUCKET`），比 Python 的 boto3 S3 兼容方式更简单：

```typescript
await env.QUERY_IMAGES_BUCKET.put(key, imageBytes, {
  httpMetadata: { contentType: "image/jpeg" },
});
```

需要新增一个 R2 binding 或复用现有的 `QUERY_IMAGES_BUCKET`。

### Step 8: Types 更新

在 `api/src/types.ts` 的 `Bindings` 中确认以下 key 已存在（大部分已有）：

```typescript
// 已有
YOUTUBE_API_KEY?: string;
PEXELS_API_KEY?: string;
PIXABAY_API_KEY?: string;
GEMINI_API_KEY?: string;

// 确认 R2 binding 可用于 avatar
QUERY_IMAGES_BUCKET?: R2Bucket;
```

## Secrets Needed

全部已在 wrangler secrets 中配置，无需新增：

- `DATABASE_URL` — Neon 连接串
- `YOUTUBE_API_KEY` — YouTube Data API
- `PEXELS_API_KEY` — Pexels API
- `PIXABAY_API_KEY` — Pixabay API
- `GEMINI_API_KEY` — LLM filter（可选功能）

## Constraints & Edge Cases

### CPU Time Limit
- CF Workers Free: 10ms CPU / invocation
- CF Workers Paid ($5/mo): 30s CPU / invocation
- Scheduler 单次执行主要是网络 I/O（fetch API），CPU 消耗很低
- **风险点**: 如果 `content_sources` 数量很大（100+ 频道），单次可能超时
- **解法**: 分批处理，每次 cron 只处理一批 sources（用 DB 记录上次处理到哪个），或者用 Durable Objects 做长任务

### 网络请求数
- YouTube RSS: 每个频道 1 请求
- YouTube API: 每个频道 1-2 请求（search + videos.list）
- DB: 每个 source ~3 查询（读 source、查重、插入 job、更新 cursor）
- 30 个频道 ≈ ~150 请求/次，5 分钟一次 → 完全在 Workers 限制内

### 幂等性
- 现有逻辑已有去重（检查 `processing_jobs` 是否存在同一 `source_item_id`）
- Cron 可能偶尔重复触发，去重逻辑已覆盖

### 与 VPS Worker 的关系
- Scheduler 只负责**发现**新视频并创建 `processing_jobs`
- VPS 上的 Worker 负责**消费** jobs（下载、转录、embedding）
- 两者通过 `processing_jobs` 表解耦，互不影响

## Migration Checklist

- [ ] 在 `wrangler.toml` 添加 `[triggers] crons`
- [ ] 修改 `api/src/index.ts` 导出 `scheduled` handler
- [ ] 新建 `api/src/scheduled/discovery.ts` — 主调度逻辑
- [ ] 新建 `api/src/services/youtube.ts` — YouTube API/RSS client
- [ ] 新建 `api/src/services/pexels.ts` — Pexels client
- [ ] 新建 `api/src/services/pixabay.ts` — Pixabay client
- [ ] 新建 `api/src/services/llm-filter.ts` — Gemini 语义过滤（可选）
- [ ] R2 avatar mirroring 用 binding 方式重写
- [ ] 写单测（mock fetch + mock DB）
- [ ] staging 部署验证（`*/10 * * * *`，检查 `processing_jobs` 是否正常写入）
- [ ] production 部署（`*/5 * * * *`）
- [ ] 确认 VPS worker 能正常消费 scheduler 创建的 jobs
- [ ] 删除 Python 版 `workers/scheduler.py`（确认稳定后）

## Estimated Scope

- 新增 ~5 个 TypeScript 文件，~800-1000 行
- 修改 2 个现有文件（`index.ts`、`wrangler.toml`）
- 核心逻辑是 Python → TypeScript 的直接翻译，无架构变更
- 最终删除 `workers/scheduler.py`（~1088 行）
