# Cerul Unified Pipeline Design

> **Status**: Proposed
> **Date**: 2026-03-21
> **Goal**: 统一 index 和 search 接口，去掉用户侧的分类概念，实现 "index any video, search with one query" 的产品体验。

---

## 1. 设计原则

1. **对外只有两个接口**：`POST /v1/index` 和 `POST /v1/search`，用户不需要选 broll/knowledge/short/long
2. **不分类，分段**：同一个视频自动产出多种 retrieval unit（summary / speech / visual），不做硬标签
3. **标签不参与 embedding**：视频属性（duration、source）放 metadata，embedding 只放内容语义
4. **Tracking URL 默认直跳**：API 返回 `cerul.ai/v/{id}`，默认 302 直接跳原始视频（零摩擦），Cerul 网站内走详情页（两层漏斗）
5. **统一 3072D embedding 空间**：所有 retrieval unit 使用同一个 embedding 模型和维度，旧数据一次性重索引
6. **召回多样性保护**：搜索时对单视频和单 unit_type 做配额限制，防止长视频 speech units 淹没其他结果
7. **用户数据隔离**：用户通过 API 索引的视频仅对该用户可见，系统库视频对所有人可见

---

## 2. 实施范围

**一步到位，不分阶段。** 当前没有外部用户在使用旧 API，不存在 breaking change 问题。

### 本次实施内容

- 新建 `videos`, `retrieval_units`, `video_access`, `tracking_links`, `tracking_events` 五张表
- 新建统一 `IndexingPipeline`（复用现有 step 逻辑）
- 新建 `UnifiedSearchService`，替代 `BrollSearchService` + `KnowledgeSearchService`
- `POST /v1/search` 移除 `search_type` 必填字段
- 上线 `POST /v1/index` + `GET /v1/index/{video_id}`
- 上线 `GET /v/{short_id}` tracking redirect + `GET /v/{short_id}/detail` 详情页
- 旧数据迁移到新表（broll 需要 3072D 重新 embedding）
- 下线旧的 search service 和旧表
- Summary unit 使用 LLM 生成摘要（pipeline 里已经在调 Gemini Flash，顺手做）

### 需要同步更新的地方

- [ ] `SearchRequest` model — 移除 `search_type`，合并 filters
- [ ] API docs（`docs/api-reference.md`）
- [ ] README.md 中的 API 示例
- [ ] Frontend search demo（`/search` 页面）
- [ ] Agent skill definition（SKILL.md / MCP skill）
- [ ] billing `calculate_credit_cost()` — search 统一 1 credit，index 免费
- [ ] `query_logs` 表 — `search_type` 字段移除 CHECK constraint 或改为 nullable
- [ ] `usage_events` 表 — 同上
- [ ] `processing_jobs` 表 — `track` 字段的 CHECK constraint 从 `('broll', 'knowledge')` 改为 `('broll', 'knowledge', 'unified')` 或直接移除
- [ ] Dashboard usage 页面 — 去掉按 search_type 分类的统计

### 后续优化（有数据后再做）

| 优化项 | 触发条件 | 做什么 |
|--------|---------|--------|
| Reranker 调优 | 1000+ 带点击的 query | 用点击数据评估 NDCG，调 prompt |
| Embedding fine-tune | 5000+ 带点击的 query | 在 embedding 上加 projection layer |
| Query rewriting | 发现大量 "无交互" query | 训练 query rewriter 改善召回 |
| Hybrid segment | 用户反馈需要 | 合并同一时间窗的 speech + visual unit |
| Creator dashboard | 流量数据积累到有意义 | 给创作者展示导流数据 |

---

## 3. 数据模型

### 3.1 新表：`videos`（统一视频元数据）

替代现有的 `knowledge_videos` 和 `broll_assets` 中的元数据部分。

```sql
CREATE TABLE videos (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source            TEXT NOT NULL,                 -- 'youtube', 'pexels', 'pixabay', 'upload'
    source_video_id   TEXT NOT NULL,                 -- 原始平台 ID
    source_url        TEXT,                          -- 原始 URL
    video_url         TEXT NOT NULL,                 -- 可播放 URL
    thumbnail_url     TEXT,
    title             TEXT NOT NULL,
    description       TEXT NOT NULL DEFAULT '',
    speaker           TEXT,                          -- nullable, 有就存
    published_at      TIMESTAMPTZ,
    duration_seconds  INTEGER CHECK (duration_seconds >= 0),
    license           TEXT,
    creator           TEXT,
    has_captions      BOOLEAN NOT NULL DEFAULT FALSE,
    metadata          JSONB NOT NULL DEFAULT '{}'::JSONB,  -- 扩展字段
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source, source_video_id)
);

CREATE INDEX idx_videos_source_published ON videos (source, published_at DESC);
CREATE INDEX idx_videos_duration ON videos (duration_seconds);
```

### 3.2 新表：`retrieval_units`（统一检索单元）

替代现有的 `knowledge_segments` 和 `broll_assets` 中的 embedding 部分。

```sql
CREATE TABLE retrieval_units (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id          UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    unit_type         TEXT NOT NULL CHECK (unit_type IN ('summary', 'speech', 'visual')),
    unit_index        INTEGER NOT NULL DEFAULT 0 CHECK (unit_index >= 0),
    timestamp_start   DOUBLE PRECISION,              -- nullable（summary 没有时间戳）
    timestamp_end     DOUBLE PRECISION,
    content_text      TEXT NOT NULL,                  -- 用于生成 embedding 的完整文本
    transcript        TEXT,                           -- 原始转录（speech unit）
    visual_desc       TEXT,                           -- 视觉描述（visual unit）
    visual_type       TEXT,                           -- 'slide', 'chart', 'code', 'demo', 'scene' 等
    keyframe_url      TEXT,                           -- 关键帧图片 URL (R2/S3)
    embedding         VECTOR(3072) NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (video_id, unit_type, unit_index)
);

CREATE INDEX idx_ru_video ON retrieval_units (video_id);
CREATE INDEX idx_ru_unit_type ON retrieval_units (unit_type);
CREATE INDEX idx_ru_embedding ON retrieval_units
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

### 3.3 新表：`tracking_links`（点击追踪短链）

```sql
CREATE TABLE tracking_links (
    short_id          TEXT PRIMARY KEY,              -- 8 字符随机 ID
    request_id        TEXT NOT NULL,                 -- 关联到哪次 search
    result_rank       SMALLINT NOT NULL,             -- 在 top-N 中排第几
    unit_id           UUID NOT NULL REFERENCES retrieval_units(id) ON DELETE CASCADE,
    video_id          UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    target_url        TEXT NOT NULL,                 -- outbound 跳转目标 URL（含时间戳）
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tl_request ON tracking_links (request_id);
```

### 3.4 新表：`tracking_events`（追踪事件）

```sql
CREATE TABLE tracking_events (
    id                BIGSERIAL PRIMARY KEY,
    short_id          TEXT NOT NULL REFERENCES tracking_links(short_id),
    event_type        TEXT NOT NULL CHECK (event_type IN ('redirect', 'page_view', 'outbound_click')),
    request_id        TEXT,                          -- 冗余存储，方便查询
    result_rank       SMALLINT,                      -- 冗余存储
    unit_id           UUID,
    video_id          UUID,
    occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    referrer          TEXT,
    user_agent        TEXT,
    ip_hash           TEXT                           -- hash 后的 IP，不存原始 IP
);

CREATE INDEX idx_te_short ON tracking_events (short_id);
CREATE INDEX idx_te_request ON tracking_events (request_id);
CREATE INDEX idx_te_video_time ON tracking_events (video_id, occurred_at DESC);
CREATE INDEX idx_te_event_type ON tracking_events (event_type, occurred_at DESC);
```

event_type 说明：
- `redirect`：API 用户通过 `/v/{short_id}` 直接 302 跳转（最常见）
- `page_view`：通过 `/v/{short_id}/detail` 访问详情页（Cerul 网站内使用）
- `outbound_click`：从详情页点击跳转到原始视频

### 3.5 与现有表的关系

```
现有表                      新表                        迁移策略
─────────────────────────  ────────────────────────    ──────────────────────
knowledge_videos           → videos                    数据迁移，字段兼容
broll_assets (元数据部分)   → videos                    数据迁移
knowledge_segments         → retrieval_units (speech)   3072D 已兼容，直接迁移
broll_assets (embedding)   → retrieval_units (visual)   需 3072D 重新 embedding
(不存在)                   → video_access               新建，系统库视频 owner_id=NULL
(不存在)                   → tracking_links             新建
(不存在)                   → tracking_events            新建
```

迁移完成后下线旧表和旧 search service。

### 3.6 数据隔离模型

```
数据来源 1: 系统 scheduler 自动索引
  → owner_id = NULL
  → 所有用户搜索时都能看到

数据来源 2: 用户通过 POST /v1/index 提交
  → owner_id = 该用户的 user_id
  → 仅该用户搜索时可见
```

搜索时的 WHERE 条件：
```sql
WHERE (ru.owner_id IS NULL OR ru.owner_id = $current_user_id)
```

**重复提交的隔离规则：**

- 用户 A index 了 `youtube.com/watch?v=abc`，owner_id = A
- 用户 B 也 index 同一个 URL → 不会重复处理视频，但会创建一条新的 owner 关联，让 B 也能搜到
- 系统 scheduler 索引了同一个 URL → owner_id = NULL，所有人可见
- 同一个视频可以有多个 owner（包括 NULL），retrieval_units 不重复，通过关联表管理

为了支持一个视频多个 owner，需要一张关联表：

```sql
CREATE TABLE video_access (
    video_id          UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    owner_id          TEXT REFERENCES user_profiles(id),  -- NULL = 公共
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (video_id, COALESCE(owner_id, '__public__'))
);

CREATE INDEX idx_va_owner ON video_access (owner_id);
```

搜索 SQL 改为：

```sql
JOIN video_access va ON va.video_id = ru.video_id
WHERE (va.owner_id IS NULL OR va.owner_id = $current_user_id)
```

这样 `videos` 和 `retrieval_units` 表不需要 `owner_id` 列，隔离逻辑全在 `video_access` 里。

---

## 4. 统一 Index Pipeline

### 4.1 API 设计

**提交索引：**

```
POST /v1/index
Authorization: Bearer cerul_sk_xxx

{
  "url": "https://www.youtube.com/watch?v=abc123"
}

Response 202:
{
  "video_id": "uuid-xxx",
  "status": "processing",
  "request_id": "req_xxx"
}
```

**查询状态：**

```
GET /v1/index/{video_id}
Authorization: Bearer cerul_sk_xxx

Response 200 (处理中):
{
  "video_id": "uuid-xxx",
  "status": "processing",
  "title": "Sam Altman on AGI",
  "current_step": "TranscribeStep",
  "steps_completed": 4,
  "steps_total": 11,
  "created_at": "2026-03-21T10:00:00Z"
}

Response 200 (完成):
{
  "video_id": "uuid-xxx",
  "status": "completed",
  "title": "Sam Altman on AGI",
  "duration": 7200,
  "units_created": 28,
  "created_at": "2026-03-21T10:00:00Z",
  "completed_at": "2026-03-21T10:03:45Z"
}

Response 200 (失败):
{
  "video_id": "uuid-xxx",
  "status": "failed",
  "error": "Video is private or unavailable",
  "created_at": "2026-03-21T10:00:00Z",
  "failed_at": "2026-03-21T10:00:12Z"
}
```

**规则：**

| 规则 | 说明 |
|------|------|
| 认证 | 需要 API key，和 search 用同一个 |
| 计费 | 免费，不消耗 credit |
| 速率限制 | 每个 API key 10 次/分钟（防滥用，不是计费手段） |
| 重复提交 | 同一个 URL 再次提交：如果视频已存在，只创建新的 video_access 关联（让该用户也能搜到），不重新跑 pipeline |
| 强制重索引 | `POST /v1/index { "url": "...", "force": true }` 删除旧数据重新处理 |
| 最大时长 | 4 小时（超过的视频拒绝，返回 422） |
| 支持的 URL | YouTube (`youtube.com/watch`, `youtu.be`, `youtube.com/shorts`), Pexels, Pixabay, 直接 `.mp4/.webm` URL |
| 不支持的 URL | 返回 `422 { "error": "Unsupported URL format" }` |
| 私密/不可用视频 | pipeline 在 FetchMetadataStep 失败，status 变为 `failed`，error 说明原因 |

**典型使用方式（agent 集成）：**

```python
# 1. 提交索引
resp = cerul.index("https://youtube.com/watch?v=abc")
video_id = resp["video_id"]

# 2. 轮询等待完成（通常 1-5 分钟）
while True:
    status = cerul.get_index_status(video_id)
    if status["status"] in ("completed", "failed"):
        break
    time.sleep(10)

# 3. 搜索（索引完成后即可搜到）
results = cerul.search("what did they say about AGI")
```

**列出已索引视频：**

```
GET /v1/index?page=1&per_page=20
Authorization: Bearer cerul_sk_xxx

Response 200:
{
  "videos": [
    { "video_id": "uuid-xxx", "title": "...", "status": "completed", "units_created": 28, "created_at": "..." },
    ...
  ],
  "total": 42,
  "page": 1,
  "per_page": 20
}
```

只返回该用户自己索引的视频（owner_id = 当前用户），不包含系统库。

**删除已索引视频：**

```
DELETE /v1/index/{video_id}
Authorization: Bearer cerul_sk_xxx

Response 200:
{ "deleted": true }
```

只删除该用户对这个视频的 access 关联。如果这是最后一个 owner 且不是系统库视频，则同时删除视频数据和 retrieval units。如果其他用户也关联了同一视频，则数据保留。

**索引配额：**

| Tier | 最大索引视频数 |
|------|--------------|
| Free | 50 |
| Builder | 500 |
| Pro | 5,000 |
| Enterprise | 自定义 |

### 4.2 Pipeline 流程

```
index(url)
  │
  ├─ Step 1: ResolveSourceStep
  │   解析 URL → 判断来源 (youtube / pexels / pixabay / direct)
  │   输出: source, source_video_id
  │
  ├─ Step 2: FetchMetadataStep
  │   调用对应平台 API 拿元数据
  │   输出: title, description, duration, speaker, published_at, thumbnail_url
  │   检查去重: 如果 (source, source_video_id) 已存在 → 跳过或更新
  │
  ├─ Step 3: FetchCaptionsStep
  │   尝试获取字幕 (YouTube 自带字幕 / 平台提供的描述)
  │   有字幕 → data["captions"] = transcript text
  │   无字幕 → 继续，后面用 ASR
  │
  ├─ Step 4: DownloadVideoStep
  │   下载视频到临时目录
  │   短视频 (< 60s) 或 stock footage → 可选只下载预览帧而非全视频
  │
  ├─ Step 5: TranscribeStep
  │   如果 Step 3 已有字幕 → 跳过
  │   否则用 ASR 转录（模型可配置，当前默认 OpenAI compatible transcriber）
  │   输出: data["transcript_segments"] = [{text, start, end}, ...]
  │
  ├─ Step 6: ExtractKeyframesStep
  │   用 ffmpeg scene detection 抽取关键帧
  │   perceptual hash 去重
  │   过滤 talking head (skin ratio > 45%, edge density < 4%)
  │   短视频: 3-5 帧
  │   长视频: 按 scene change 抽帧，通常 15-30 帧
  │   输出: data["keyframes"] = [{path, timestamp, ...}, ...]
  │
  ├─ Step 7: DescribeFramesStep
  │   对每个关键帧调用视觉模型生成描述（模型可配置，当前使用 Gemini Flash）
  │   批量处理: 10 帧/batch
  │   输出: data["frame_descriptions"] = [{timestamp, description, visual_type, text_content}, ...]
  │
  ├─ Step 7.5: UploadKeyframesStep
  │   将关键帧上传到对象存储 (Cloudflare R2 / S3)
  │   路径: cdn.cerul.ai/frames/{video_id}/{frame_index}.jpg
  │   JPEG 压缩, 质量 85, 长边不超过 1280px
  │   输出: data["keyframe_urls"] = [{timestamp, url}, ...]
  │
  ├─ Step 8: BuildRetrievalUnitsStep
  │   根据前面的数据自动生成 retrieval units:
  │
  │   8a. Summary unit (必定产出 1 个)
  │       content_text = "{title}. {llm_generated_summary}"
  │       用 Gemini Flash 基于 transcript + frame descriptions 生成 2-3 句摘要
  │       如果没有 transcript 也没有 frame descriptions: fallback 到 "{title}. {description}"
  │
  │   8b. Speech units (有字幕/ASR 时产出)
  │       按 transcript 分段 (基于 ASR segments 或 scene boundary)
  │       每个 segment 的 content_text =
  │         "{video_title}. {speaker}: '{transcript_text}'"
  │       典型: 长视频 10-30 个 speech units
  │
  │   8c. Visual units (有关键帧描述时产出)
  │       每个有意义的关键帧生成一个 visual unit
  │       content_text = "{video_title}. {frame_description}"
  │       如果帧上有 OCR 文本: 追加 "Visible text: {ocr_text}"
  │       典型: 短素材 3-5 个, 长视频 10-20 个
  │
  │   输出: data["units"] = [{unit_type, content_text, timestamp_start, ...}, ...]
  │
  ├─ Step 9: EmbedUnitsStep
  │   对每个 unit 的 content_text 调用 embedding 模型
  │   模型和维度可配置（当前: Gemini Embedding 2, 3072D, task_type=RETRIEVAL_DOCUMENT）
  │   批量处理
  │
  ├─ Step 10: PersistStep
  │   事务写入:
  │     1. UPSERT videos 表
  │     2. INSERT video_access (owner_id = 调用者 user_id，系统 scheduler 则 NULL)
  │     3. INSERT retrieval_units 表 (ON CONFLICT 更新)
  │
  └─ Step 11: MarkCompletedStep
      更新 processing_jobs 状态
```

### 4.3 不同视频类型的自然表现

不需要显式分类。同一条 pipeline 处理不同视频时，产出的 unit 分布自然不同：

| 视频类型 | summary | speech units | visual units | 原因 |
|---------|---------|-------------|-------------|------|
| 60 分钟技术演讲 | 1 | 20-30 | 10-15 | 大量字幕 + 有 slide |
| 5 分钟 YouTube short | 1 | 3-5 | 2-3 | 短字幕 + 少量关键帧 |
| 15 秒 Pexels 素材 | 1 | 0 | 3-5 | 无语音，纯视觉 |
| 30 分钟访谈 | 1 | 15-25 | 3-5 | 大量字幕，talking head 被过滤 |
| 产品 Demo 视频 | 1 | 5-10 | 10-20 | 有讲解 + 大量 UI 截图 |

**这就是为什么不需要分类：** 视频内容本身决定了它产出什么类型的 unit，而 embedding 空间会自动让不同类型的 query 匹配到对应的 unit。

### 4.4 成本估算

模型名仅为示意，实际使用配置中指定的模型。

```
每个视频的 index 成本：

固定成本:
  - Embedding (summary):                        ~$0.001
  - Video metadata API call:                    免费

可变成本（取决于视频长度和内容）:

  30 分钟 YouTube 知识视频:
    - ASR (或免费 YouTube 字幕):                  ~$0.10
    - 关键帧视觉描述 (15帧 × vision model):      ~$0.01
    - 关键帧存储 (15帧 × ~80KB, R2):             ~$0.00002
    - Embedding (25 units):                     ~$0.005
    - 总计:                                     ~$0.12

  15 秒 Pexels 素材:
    - 无 ASR:                                   $0
    - 关键帧视觉描述 (3帧 × vision model):       ~$0.002
    - 关键帧存储 (3帧 × ~80KB, R2):              ~$0.000004
    - Embedding (4 units):                      ~$0.001
    - 总计:                                     ~$0.003

  5 分钟 YouTube Short:
    - YouTube 字幕:                              免费
    - 关键帧视觉描述 (5帧 × vision model):       ~$0.003
    - 关键帧存储 (5帧 × ~80KB, R2):              ~$0.000007
    - Embedding (8 units):                      ~$0.002
    - 总计:                                     ~$0.005

关键帧存储月度成本 (Cloudflare R2):
  10,000 视频 × 15 帧/视频 × 80KB/帧 ≈ 12 GB → ~$0.18/月
  100,000 视频 ≈ 120 GB → ~$1.80/月
```

---

## 5. 统一 Search 接口

### 5.1 请求

```
POST /v1/search
{
  "query": "Sam Altman 怎么看 AGI",
  "max_results": 5,
  "include_answer": true,
  "filters": {                           // 全部可选
    "speaker": "Sam Altman",
    "published_after": "2024-01-01",
    "min_duration": 60,
    "max_duration": 3600,
    "source": "youtube"
  }
}
```

**没有 `search_type` 字段。** 用户只发 query，系统搜全部。

filters 是所有可选字段的合集，不再区分 BrollFilters / KnowledgeFilters。

### 5.2 搜索流程

```
search(query)
  │
  ├─ 1. 生成 query embedding
  │     embedding 模型可配置（当前: Gemini Embedding 2, 3072D, task_type=RETRIEVAL_QUERY）
  │
  ├─ 2. 分层召回（防止长视频 speech units 淹没）
  │     而非一次全量查询，按以下策略召回：
  │
  │     a. 按 unit_type 分配配额:
  │        summary: max_results 个
  │        speech:  max_results * 2 个
  │        visual:  max_results * 2 个
  │
  │     b. 每个 unit_type 内，per-video 最多取 3 个 unit
  │        防止单个 60 分钟视频的 30 个 speech unit 占满召回池
  │
  │     c. 合并为一个候选池（通常 max_results * 5 个）
  │
  │     注: 旧表数据迁移完成前，同时查旧表，结果一起合并
  │
  ├─ 3. Rerank（可配置，当前: OpenAI compatible reranker）
  │     对候选池做 pointwise scoring
  │
  ├─ 4. MMR 去重
  │     防止同一视频的多个 segment 霸占最终结果
  │     同时考虑 embedding 多样性
  │
  ├─ 5. 生成 tracking link
  │     为每个结果创建 tracking_links 记录
  │     short_id = 8 字符随机字符串
  │     url 默认为直跳链接 /v/{short_id}（302 到原视频）
  │
  ├─ 6. (可选) 生成 answer
  │     如果 include_answer=true
  │     用 top segments 的 content 让 LLM 生成引用式回答
  │
  └─ 7. 返回结果
```

### 5.3 SQL 查询模板（单个 unit_type 的召回）

```sql
SELECT
    ru.id::text AS unit_id,
    ru.unit_type,
    ru.content_text,
    ru.transcript,
    ru.visual_desc,
    ru.timestamp_start,
    ru.timestamp_end,
    ru.embedding::text AS embedding,
    1 - (ru.embedding <=> $1::vector) AS score,
    v.id::text AS video_id,
    v.title,
    v.description,
    v.source,
    v.source_url,
    v.video_url,
    v.thumbnail_url,
    v.duration_seconds,
    v.speaker,
    v.published_at,
    v.license,
    v.creator,
    ROW_NUMBER() OVER (PARTITION BY ru.video_id ORDER BY ru.embedding <=> $1::vector) AS video_rank
FROM retrieval_units AS ru
JOIN videos AS v ON v.id = ru.video_id
JOIN video_access AS va ON va.video_id = ru.video_id
WHERE ru.unit_type = $2
    -- 数据隔离: 只搜系统库 + 当前用户自己的视频
    AND (va.owner_id IS NULL OR va.owner_id = $3)
    -- 可选 filters
    AND ($4::text IS NULL OR v.speaker = $4)
    AND ($5::date IS NULL OR v.published_at >= $5)
    AND ($6::int  IS NULL OR v.duration_seconds >= $6)
    AND ($7::int  IS NULL OR v.duration_seconds <= $7)
    AND ($8::text IS NULL OR v.source = $8)
ORDER BY ru.embedding <=> $1::vector
LIMIT $9
```

外层再过滤 `WHERE video_rank <= 3`，然后合并三个 unit_type 的结果。

### 5.4 响应格式

```json
{
  "results": [
    {
      "id": "unit_abc123",
      "score": 0.92,
      "url": "https://cerul.ai/v/a8f3k2x",
      "title": "Sam Altman on AGI Timeline - Lex Fridman Podcast",
      "snippet": "I think AGI is coming sooner than most people expect, probably within the next few years...",
      "thumbnail_url": "https://i.ytimg.com/vi/abc/hqdefault.jpg",
      "keyframe_url": "https://cdn.cerul.ai/frames/vid_abc/f023.jpg",
      "duration": 7200,
      "source": "youtube",
      "speaker": "Sam Altman",
      "timestamp_start": 1823.5,
      "timestamp_end": 1945.2,
      "unit_type": "speech"
    },
    {
      "id": "unit_def456",
      "score": 0.87,
      "url": "https://cerul.ai/v/b9g4l3y",
      "title": "OpenAI DevDay 2024 Keynote",
      "snippet": "Slide showing AGI development roadmap with timeline visualization, labeled phases from GPT-4 to AGI",
      "thumbnail_url": "https://i.ytimg.com/vi/def/hqdefault.jpg",
      "keyframe_url": "https://cdn.cerul.ai/frames/vid_def/f008.jpg",
      "duration": 5400,
      "source": "youtube",
      "speaker": "Sam Altman",
      "timestamp_start": 423.0,
      "timestamp_end": 445.0,
      "unit_type": "visual"
    }
  ],
  "answer": "Sam Altman has consistently stated that AGI could arrive within the next few years. In his conversation with Lex Fridman [Sam Altman on AGI Timeline, 30:23-32:25], he explained...",
  "credits_used": 2,
  "credits_remaining": 998,
  "request_id": "req_abc123def456"
}
```

**关键设计决策：**

- **`url` 字段是 tracking URL**（`https://cerul.ai/v/a8f3k2x`），默认 302 直接跳到原始视频，零摩擦
- **`snippet` 字段**：speech unit 展示 transcript 摘要，visual unit 展示视觉描述
- **`unit_type` 字段**：告诉调用方这个结果是来自语音还是视觉，辅助 agent 做 UI 展示

### 5.5 Tracking 设计

**两种访问方式，适配不同场景：**

```
API 返回 url: https://cerul.ai/v/{short_id}
  │
  ├─ 方式 1: 直跳（API 用户默认行为）
  │   GET /v/{short_id}
  │   → 记录 tracking_event (event_type='redirect')
  │   → 302 重定向到 target_url (e.g. https://youtube.com/watch?v=abc&t=1823)
  │   → 用户直接看到原始视频，零摩擦
  │
  └─ 方式 2: 详情页（Cerul 网站内使用）
      GET /v/{short_id}/detail
      → 返回轻量 HTML 页面:
        - 视频缩略图 + 标题 + snippet + 时间戳
        - "Watch on YouTube" 按钮
        - Cerul 品牌 + 搜索框（引流）
      → 记录 tracking_event (event_type='page_view')
      → 用户点击按钮 → GET /v/{short_id}/go
        → 记录 tracking_event (event_type='outbound_click')
        → 302 跳原视频
```

**为什么这样设计：**

- API 用户（agent）拿到链接后传给最终用户，用户点击直接看视频，不会因为中间页而流失
- Cerul 自己的网站（search demo、SEO 落地页）走详情页路径，拿到更丰富的两层漏斗数据
- 两种路径都有 tracking，数据不丢

**性能要求:**
- `/v/{short_id}` 直跳响应: < 50ms
- `/v/{short_id}/detail` 详情页 SSR: < 200ms
- `/v/{short_id}/go` 外跳响应: < 50ms
- tracking_event 写入: fire-and-forget，不阻塞用户

**404 处理:** 如果 short_id 不存在，返回带 Cerul 品牌的 404 页面（含搜索框引流）。

---

## 6. 点击数据的应用

### 6.1 搜索质量评估（日常监控）

```sql
-- 各位置的点击率（redirect + outbound_click 都算）
SELECT
    result_rank,
    COUNT(*) AS clicks,
    COUNT(*) * 100.0 / SUM(COUNT(*)) OVER () AS pct
FROM tracking_events
WHERE event_type IN ('redirect', 'outbound_click')
  AND occurred_at > NOW() - INTERVAL '7 days'
GROUP BY result_rank
ORDER BY result_rank;

-- 无任何交互的搜索请求（结果质量差的信号）
SELECT ql.query_text, ql.result_count
FROM query_logs ql
LEFT JOIN tracking_events te ON te.request_id = ql.request_id
WHERE te.id IS NULL
  AND ql.result_count > 0
  AND ql.created_at > NOW() - INTERVAL '7 days';
```

### 6.2 隐式 relevance label（用于改进排序）

```
query: "Sam Altman AGI"
  result #1: unit_123 → 被点击（redirect）  → positive
  result #2: unit_456 → 未点击              → soft negative
  result #3: unit_789 → 被点击（redirect）  → positive
  result #4: unit_012 → 未点击              → soft negative
```

积累 500+ 条带点击的 query 后 → 评估 reranker NDCG@5
积累 1000+ 条后 → 调 rerank prompt 或换 rerank 模型
积累 5000+ 条后 → 考虑 embedding fine-tuning（在 embedding 上加 projection layer）

### 6.3 Creator analytics（商业价值）

```sql
-- 某个频道通过 Cerul 获得的总流量
SELECT
    v.creator,
    v.source,
    COUNT(*) AS total_clicks,
    COUNT(DISTINCT te.request_id) AS unique_searches
FROM tracking_events te
JOIN videos v ON v.id = te.video_id
WHERE te.event_type IN ('redirect', 'outbound_click')
GROUP BY v.creator, v.source
ORDER BY total_clicks DESC;
```

这是将来向视频创作者展示价值、开拓 B2B 收入的数据基础：
- "你的视频通过 Cerul 获得了 12,000 次播放跳转"

---

## 7. API 变更总结

### 新增端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/v1/index` | POST | 提交视频 URL 进行索引（免费，需 API key） |
| `/v1/index` | GET | 列出当前用户已索引的视频 |
| `/v1/index/{video_id}` | GET | 查询索引状态（processing / completed / failed） |
| `/v1/index/{video_id}` | DELETE | 删除用户对该视频的 access |
| `/v/{short_id}` | GET | Tracking redirect（302 直跳原视频，记录 redirect 事件） |
| `/v/{short_id}/detail` | GET | Cerul 详情页（记录 page_view，Cerul 网站内使用） |
| `/v/{short_id}/go` | GET | 从详情页外跳（记录 outbound_click，302 到原视频） |

### 修改端点

| 端点 | 变更 |
|------|------|
| `POST /v1/search` | 移除 `search_type`；统一 filters；统一 1 credit/次；响应加 `url`, `keyframe_url`, `unit_type` |

### 计费模型

| 操作 | Credit 消耗 |
|------|------------|
| `POST /v1/index` | 免费 |
| `GET /v1/index/{video_id}` | 免费 |
| `POST /v1/search` | 1 credit |
| `POST /v1/search` + `include_answer` | 2 credits |

### 响应格式变更

**Before (v1 current):**
```json
{
  "results": [{
    "id": "seg_xxx",
    "video_url": "https://youtube.com/watch?v=abc",
    "timestamp_start": 1823.5,
    "timestamp_end": 1945.2
  }]
}
```

**After (v2 unified):**
```json
{
  "results": [{
    "id": "unit_xxx",
    "url": "https://cerul.ai/v/a8f3k2x",
    "snippet": "...",
    "keyframe_url": "https://cdn.cerul.ai/frames/vid_xxx/f012.jpg",
    "unit_type": "speech",
    "timestamp_start": 1823.5,
    "timestamp_end": 1945.2
  }]
}
```

---

## 8. 后续优化（有数据后再做）

以下优化**不在初始实现范围内**，需要基于真实用户数据和点击日志来决定：

| 优化项 | 触发条件 | 做什么 |
|--------|---------|--------|
| Reranker 调优 | 1000+ 带点击的 query | 用点击数据评估 NDCG，调 prompt |
| Embedding fine-tune | 5000+ 带点击的 query | 在 embedding 上加 projection layer |
| Query rewriting | 发现大量 "无交互" query | 训练 query rewriter 改善召回 |
| Hybrid segment | 用户反馈需要 | 合并同一时间窗的 speech + visual unit |
| Creator dashboard | 流量数据积累到有意义 | 给创作者展示导流数据 |

---

## 9. 一句话总结

**不分类，分段。同一条 pipeline，一个 embedding 空间，分层召回。视频内容决定产出什么 unit，embedding 空间决定谁和谁匹配。对外只有 `index(url)` 和 `search(query)`。Tracking URL 默认直跳原视频（零摩擦），Cerul 网站内走详情页。一步到位，不分阶段。**
