# Cerul 任务审计与收尾计划

本文档最初用于规划 2025-03-11 时点的剩余任务。随着多轮开发推进，大部分任务已经落地；当前版本改为记录真实状态、剩余验收项和收尾优先级。

---

## 当前结论

- 已完成主干任务：`T01 T02 T03 T04 T06 T07 T08 T09 T10 T12 T13 T14 T16 T17 T18`
- 仍需收口：`T05 T11 T15`
- 其中 `T05` 已有可运行 pipeline，并在当前分支补上“字幕优先，ASR 兜底”的默认链路；剩余工作是更大规模真实视频联调与质量验证。
- `T11` 与 `T15` 的主要缺口都不在代码骨架，而在真实环境跑通与验收。

---

## 任务总览

| ID | 任务 | 依赖 | 当前状态 | 说明 |
|----|------|------|----------|------|
| T01 | Gemini Embedding 迁移 | 无 | Done | Gemini 768 维向量已落到 backend 与 workers |
| T02 | Better Auth 集成 | 无 | Done | Dashboard session 认证已接入 |
| T03 | 配置管理系统 | 无 | Done | 三层配置系统已落地 |
| T04 | Stub DB 清理 | 无 | Done | 已切换到真实数据库路径 |
| T05 | Knowledge Pipeline 实现 | T01 | Partial | 基础 pipeline 已实现；当前分支补上字幕优先 + ASR fallback，仍需真实视频批量验证 |
| T06 | YouTube 数据客户端 | 无 | Done | YouTube client 与测试已在仓库 |
| T07 | 查询向量生成 | T01 | Done | 搜索 query 已走真实 embedding |
| T08 | Knowledge 搜索答案生成 | T05, T07 | Done | rerank 与答案生成模块已实现 |
| T09 | Scheduler 自动化 | T05 | Done | `processing_jobs` 与 scheduler 已实现 |
| T10 | Worker 重试机制 | T05 | Done | worker retry 与 job 状态处理已实现 |
| T11 | B-roll 扩量至 10 万条 | T01, T07 | Partial | 脚本和查询集已具备，仍需真实规模入库证明 |
| T12 | Pixabay 集成 | 无 | Done | Pixabay source 已接入 |
| T13 | Search Demo 页面 | T07 | Done | Search Demo 已落地 |
| T14 | Pipelines Dashboard 页面 | T09 | Done | Pipelines Dashboard 已落地 |
| T15 | Stripe 端到端验证 | T02 | Needs validation | 代码路径已在仓库，真实 test-mode 验收仍待完成 |
| T16 | Docs 内容页面 | 无 | Done | Docs 页面已实现 |
| T17 | Codex/Claude Agent Skill | 无 | Done | `skills/cerul-api/SKILL.md` 已完成 |
| T18 | 速率限制增强 | 无 | Done | 速率限制增强已实现 |

---

## 历史任务简报

以下小节保留原始任务定义，用于回看背景、目的和验收口径；当前是否已完成以上表状态为准。

### T01: Gemini Embedding 迁移

**背景**
当前代码使用 CLIP ViT-B/32（512 维）做 B-roll embedding，ARCHITECTURE 规划中 Knowledge 使用 text-embedding-3-small（1536 维）。决策已改为统一使用 Gemini Embedding 2（`gemini-embedding-2-preview`），768 维，原生支持文本、图片、视频、音频的统一向量空间。

**目的**
将 embedding 层从 CLIP 替换为 Gemini Embedding 2，统一两条产品线的向量维度为 768。

**改动范围**
- `backend/app/embedding/gemini.py` — 新建，实现 `GeminiEmbeddingBackend`，调用 `google-genai` SDK
- `backend/app/embedding/base.py` — 更新 protocol，新增 `embed_video()` 方法
- `backend/app/embedding/clip.py` — 删除或标记弃用
- `db/migrations/002_embedding_768.sql` — 将 `broll_assets.embedding` 从 `VECTOR(512)` 改为 `VECTOR(768)`，将 `knowledge_segments.embedding` 从 `VECTOR(1536)` 改为 `VECTOR(768)`，重建 IVFFlat 索引
- `workers/broll/steps/embed.py` — 改用 `GeminiEmbeddingBackend`
- `workers/requirements.txt` — 添加 `google-genai`
- `.env.example` — 添加 `GEMINI_API_KEY`

**测试方式**
1. 单元测试：mock Gemini API，验证 `embed_text()` / `embed_image()` 返回 768 维向量
2. 集成测试：用真实 API Key 调用 Gemini，确认返回值类型和维度
3. 运行 migration 对测试数据库，确认 schema 变更生效
4. 运行 `seed_broll.py` 确认端到端 embedding 入库正常

**预期效果**
- 所有 embedding 统一为 768 维
- 移除 `open-clip-torch` 依赖，无需本地 GPU
- B-roll 和 Knowledge 共享同一个向量空间

---

### T02: Better Auth 集成

**背景**
当前 session 认证是 stub 实现（`backend/app/auth/session.py` 直接从 header/cookie 读 user_id），前端 Login/Signup 页面的表单已存在但未连接后端。需要接入 Better Auth 实现真正的用户注册、登录和会话管理。

**目的**
让用户能通过邮箱注册登录，Dashboard 使用真实 session 鉴权。

**改动范围**
- `backend/app/auth/session.py` — 替换 stub，集成 Better Auth session 验证
- `frontend/lib/auth.ts` — 接入 Better Auth client SDK
- `frontend/app/login/page.tsx` — 连接真实登录 API
- `frontend/app/signup/page.tsx` — 连接真实注册 API
- `frontend/app/dashboard/layout.tsx` — 添加 session guard，未登录跳转 login
- `backend/requirements.txt` — 如需新增依赖

**测试方式**
1. 注册新用户 → 自动跳转 Dashboard
2. 登出 → 重新登录 → session 有效
3. 未登录访问 /dashboard → 跳转 /login
4. Dashboard 所有 API 调用使用真实 session

**预期效果**
- 完整的注册/登录流程
- Dashboard 受 session 保护
- 移除 auth/session.py 中的 STUB 注释

---

### T03: 配置管理系统

**背景**
`config/` 目录下有 `base.yaml`（包含 MMR lambda 等参数），但 `development.yaml` 和 `production.yaml` 是空的占位文件。后端没有统一的配置加载模块，各处直接读环境变量。

**目的**
实现 ARCHITECTURE.md 12 节描述的三层配置系统：`base.yaml` + 环境文件 + 环境变量覆盖。

**改动范围**
- `backend/app/config/settings.py` — 新建，实现 `Settings` 类和 `load_settings()` / `get_settings()` 单例
- `config/development.yaml` — 填入开发环境默认值
- `config/production.yaml` — 填入生产环境默认值
- 后端各模块逐步改为从 `get_settings()` 读取配置

**测试方式**
1. 不同 `CERUL_ENV` 值加载不同配置文件
2. 环境变量能覆盖 yaml 中的值
3. Schema 校验：缺少必填字段时启动报错

**预期效果**
- 统一配置入口，不再散落 `os.getenv()` 调用
- 开发/生产环境参数分离

---

### T04: Stub DB 清理

**背景**
`backend/app/db/stub.py` 是一个 285 行的内存 mock 数据库，用于无 `DATABASE_URL` 时的开发测试。`backend/app/auth/api_key.py` 中有 `_build_stub_auth_context` 等 stub 分支。这些代码增加了维护负担，且容易遮蔽真实 bug。

**目的**
移除 stub DB 和相关分支，确保所有代码路径都走真实数据库。提供 docker-compose 或脚本快速启动本地 PostgreSQL 替代。

**改动范围**
- `backend/app/db/stub.py` — 删除
- `backend/app/auth/api_key.py` — 移除 stub 分支
- `backend/app/db/connection.py` — 移除 stub 回退逻辑
- `docker-compose.yml` 或 `scripts/dev-db.sh` — 新建，提供本地 Postgres + pgvector 容器
- `backend/tests/conftest.py` — 用 test fixtures 替代 stub

**测试方式**
1. 不设 `DATABASE_URL` 时启动报错而非静默用 stub
2. `docker compose up db` 启动本地数据库
3. 全部现有测试依然通过（改为使用 test fixtures）

**预期效果**
- 代码路径单一，无 if-stub-else-real 分支
- 本地开发使用 docker-compose 启动真实 Postgres

---

### T05: Knowledge Pipeline 实现

**当前状态（2026-03-12）**
基础 pipeline、YouTube metadata、search/answer integration 已经落地。当前分支进一步补上了“字幕优先，ASR 兜底”的默认 transcript 链路，以及对 YouTube 下载的 `yt-dlp` fallback。剩余工作主要是真实视频批量联调、质量评估，以及将默认 heuristic scene/frame 分析继续升级。

**背景**
`workers/knowledge/` 目录不存在。ARCHITECTURE.md 10.4 节设计了 9 步 Knowledge pipeline：从 YouTube 元数据获取 → 下载 → ASR → 场景检测 → 帧理解 → 分段 → embedding → 入库 → 标记完成。

**目的**
实现 Knowledge 视频的完整入库 pipeline，将 YouTube 演讲/访谈视频处理为可搜索的 segment 索引。

**依赖**
- T01（Gemini Embedding）：embedding step 需要 `GeminiEmbeddingBackend`

**改动范围**
- `workers/knowledge/pipeline.py` — 新建，定义 KnowledgeIndexingPipeline
- `workers/knowledge/steps/fetch_metadata.py` — 获取 YouTube 视频元数据
- `workers/knowledge/steps/download.py` — 下载视频文件
- `workers/knowledge/steps/asr.py` — 调用 Whisper API 转录
- `workers/knowledge/steps/scene_detect.py` — 场景切换检测，提取关键帧
- `workers/knowledge/steps/frame_analyze.py` — 调用 GPT-4o 理解关键帧内容
- `workers/knowledge/steps/segment.py` — 合并转录+帧理解，生成 segment
- `workers/knowledge/steps/embed.py` — 用 Gemini Embedding 2 生成 segment 向量
- `workers/knowledge/steps/store.py` — 写入 knowledge_videos + knowledge_segments
- `scripts/seed_knowledge.py` — 新建，种子脚本

**测试方式**
1. 单元测试：每个 step 独立测试（mock 外部 API）
2. 集成测试：用一条短视频跑完整 pipeline
3. 检查 knowledge_segments 表中生成的 segment 数据完整性

**预期效果**
- 能将 YouTube 视频处理为结构化 segment 并写入数据库
- 每个 step 支持单步重跑

---

### T06: YouTube 数据客户端

**背景**
B-roll 已有 Pexels/Pixabay 客户端，Knowledge pipeline 需要 YouTube 数据获取能力。

**目的**
实现 YouTube Data API v3 客户端，支持视频元数据获取和频道搜索。

**改动范围**
- `workers/common/sources/youtube.py` — 新建，实现 `YouTubeClient`
- `workers/requirements.txt` — 添加依赖（如需要）
- `.env.example` — 确认 `YOUTUBE_API_KEY` 已存在

**测试方式**
1. 单元测试：mock API 响应，验证解析逻辑
2. 集成测试：用真实 API Key 获取一条已知视频的元数据

**预期效果**
- `YouTubeClient.get_video_metadata(video_id)` 返回标准化元数据
- `YouTubeClient.search_channel_videos(channel_id)` 返回视频列表

---

### T07: 查询向量生成

**背景**
当前搜索时 query 向量使用 `build_placeholder_vector()` 生成确定性假向量，不做真实 embedding。搜索结果质量依赖于 query 和 document 在同一向量空间中的真实相似度计算。

**目的**
搜索时用 Gemini Embedding 2 将用户 query 文本转为 768 维向量，替代 placeholder。

**依赖**
- T01（Gemini Embedding）：需要 `GeminiEmbeddingBackend` 可用

**改动范围**
- `backend/app/search/broll.py` — 搜索前调用 `embed_text(query)` 生成真实向量
- `backend/app/search/knowledge.py` — 同上
- `backend/app/search/base.py` — 移除或保留 `build_placeholder_vector()` 仅作测试用

**测试方式**
1. 发起搜索请求，确认使用真实向量（日志中打印向量维度）
2. 对已入库的 B-roll 数据执行搜索，确认返回结果按相关性排序
3. 比较 placeholder 向量和真实向量的搜索结果差异

**预期效果**
- 搜索返回真正相关的结果，而不是随机数据
- query 和 document 在同一个 Gemini embedding 空间内匹配

---

### T08: Knowledge 搜索答案生成

**背景**
`backend/app/search/knowledge.py` 中 `_placeholder_answer()` 生成假答案文本。需要用 LLM 基于检索到的 segment 内容生成真实答案。

**目的**
当 `include_answer=true` 时，用 LLM 基于 top-K segment 的 transcript 和 visual description 生成综合答案。

**依赖**
- T05（Knowledge Pipeline）：需要数据库中有真实 segment 数据
- T07（查询向量）：需要能检索到相关 segment

**改动范围**
- `backend/app/search/knowledge.py` — 替换 `_placeholder_answer()` 为 LLM 调用
- `backend/app/search/answer.py` — 新建，答案生成模块
- `backend/app/search/rerank.py` — 新建，LLM rerank 模块

**测试方式**
1. 发起 `include_answer=true` 的搜索，确认返回真实答案
2. 答案引用了检索到的 segment 内容
3. `include_answer=false` 时不产生 LLM 调用开销

**预期效果**
- Knowledge 搜索能返回基于视频内容的智能答案
- 答案附带 timestamp citation

---

### T09: Scheduler 自动化

**背景**
ARCHITECTURE.md 10.5 节设计了三层架构中的「内容发现层」。当前入库靠手动运行 seed 脚本，没有自动发现新内容并投递 job 的调度器。

**目的**
实现定时任务，自动发现新视频/素材并创建 processing_jobs。

**依赖**
- T05（Knowledge Pipeline）：scheduler 需要知道要投递什么类型的 job

**改动范围**
- `workers/scheduler.py` — 实现，定时扫描 `content_sources` 表，创建 `processing_jobs`
- `workers/common/sources/` — 可能需要扩展各 client 的 pagination 支持

**测试方式**
1. 向 `content_sources` 添加一条记录，scheduler 自动创建对应 job
2. 重复运行不会创建重复 job
3. `sync_cursor` 正确更新

**预期效果**
- 新增内容源后自动开始入库
- 支持 cron 或常驻进程模式

---

### T10: Worker 重试机制

**背景**
`workers/worker.py` 需要从 `processing_jobs` 表中抢任务执行 pipeline，支持失败重试。当前没有完整的 worker 轮询实现。

**目的**
实现 ARCHITECTURE.md 10.6 节的 job state machine。

**依赖**
- T05（Knowledge Pipeline）：需要有 pipeline 可执行

**改动范围**
- `workers/worker.py` — 实现 `SELECT ... FOR UPDATE SKIP LOCKED` 抢任务、执行 pipeline、更新状态
- 支持 `max_attempts` 重试和指数退避

**测试方式**
1. 创建 pending job，worker 自动拾取并执行
2. 模拟 step 失败，确认 `attempts` 递增、状态变为 `retrying`
3. 超过 `max_attempts` 后标记 `failed`

**预期效果**
- Worker 持续轮询执行任务
- 失败自动重试，最终标记失败

---

### T11: B-roll 扩量至 10 万条

**当前状态（2026-03-12）**
批量 seed 脚本和查询集已经在仓库中，但仓库本身不能证明已经完成 10 万条真实入库。当前主要缺口是执行一次真实大规模导入，并对召回质量和索引性能做结果留痕。

**背景**
当前 B-roll 数据量有限，ARCHITECTURE.md 规划 MVP 阶段需 10 万条素材来验证搜索体验。

**目的**
批量抓取并入库 10 万条 B-roll 素材。

**依赖**
- T01（Gemini Embedding）：embedding 维度必须已迁移
- T07（查询向量）：扩量后需要能验证搜索效果

**改动范围**
- `scripts/seed_broll.py` — 扩展为支持批量查询列表和断点续传
- `scripts/broll_queries.txt` — 新建，预定义的搜索关键词列表

**测试方式**
1. 运行批量 seed 脚本，确认入库数量
2. 搜索各类关键词确认覆盖度
3. IVFFlat 索引在大数据量下性能可接受

**预期效果**
- broll_assets 表中有 10 万+ 条记录
- 搜索体验明显优于素材站的关键词搜索

---

### T12: Pixabay 集成完善

**背景**
`workers/common/sources/pixabay.py` 已有基础客户端，但 B-roll pipeline 的 discover step 中 Pixabay 的调用和响应解析可能未完全对齐。

**目的**
确保 Pixabay 作为 B-roll 数据源与 Pexels 同等可用。

**改动范围**
- `workers/common/sources/pixabay.py` — 完善 API 交互
- `workers/broll/steps/discover.py` — 确认 Pixabay 源集成正常
- `workers/broll/steps/fetch.py` — 确认 Pixabay 元数据标准化正确

**测试方式**
1. 用 Pixabay API Key 运行 seed 脚本，确认能发现并入库素材
2. 比较 Pexels 和 Pixabay 来源的数据格式一致性

**预期效果**
- B-roll 同时从 Pexels 和 Pixabay 两个源抓取素材

---

### T13: Search Demo 页面

**背景**
`frontend/app/search/` 存在但需要实现真正的搜索体验页面。这是对外展示 Cerul 能力的核心页面。

**目的**
实现公开的搜索 Demo 页面，用户无需登录即可体验 B-roll 搜索。

**依赖**
- T07（查询向量）：搜索需要返回真实结果

**改动范围**
- `frontend/app/search/page.tsx` — 实现搜索页面
- `frontend/components/search/` — 搜索组件（搜索框、结果卡片、筛选器）

**测试方式**
1. 输入查询词，确认返回相关 B-roll 结果
2. 结果卡片展示预览图、时长、来源
3. 筛选器（来源、时长范围）正常工作
4. 页面静态壳先加载，搜索结果异步渲染

**预期效果**
- 直观展示 Cerul 的视频搜索能力
- 页面加载快，搜索体验流畅

---

### T14: Pipelines Dashboard 页面

**背景**
`frontend/app/dashboard/pipelines/page.tsx` 是占位页面，没有真实内容。

**目的**
展示 processing_jobs 的状态和 pipeline 执行情况。

**依赖**
- T09（Scheduler）：需要有 job 数据可展示

**改动范围**
- `frontend/app/dashboard/pipelines/page.tsx` — 实现
- `frontend/components/dashboard/pipelines-screen.tsx` — 新建
- `backend/app/routers/dashboard.py` — 添加 job 查询接口

**测试方式**
1. 页面展示 processing_jobs 列表及状态
2. 能看到各 step 的执行情况

**预期效果**
- Dashboard 中可监控 pipeline 运行状态

---

### T15: Stripe 端到端验证

**当前状态（2026-03-12）**
Stripe service、Dashboard settings 和 webhook 代码都已在仓库，但真实 Stripe test-mode 的闭环验收还未完成。当前优先级低于搜索与 ingestion 主线，因此保留为待验证项。

**背景**
Stripe 集成代码已写好（checkout、portal、webhook），但需要在真实 Stripe 测试环境中验证完整流程。

**目的**
确保付费升级流程完整可用。

**依赖**
- T02（Better Auth）：需要真实用户 session 来触发 checkout

**改动范围**
- `backend/app/billing/stripe_service.py` — 修复可能的边界问题
- `frontend/app/dashboard/settings/page.tsx` — 确保升级/管理按钮正确工作

**测试方式**
1. Free 用户 → 点击 Upgrade → Stripe Checkout → 回调 → tier 变为 pro
2. Pro 用户 → Manage Subscription → Portal → 取消 → tier 变回 free
3. Webhook 幂等：重复发送同一事件不会重复处理

**预期效果**
- 完整的 Free → Pro 升级和降级流程

---

### T16: Docs 内容页面

**背景**
`frontend/app/docs/` 需要展示 API 文档，供开发者查阅。

**目的**
创建 API 文档页面，覆盖认证、搜索、用量等核心接口。

**改动范围**
- `frontend/app/docs/page.tsx` — 文档首页
- `frontend/app/docs/[slug]/page.tsx` — 文档子页面
- 文档内容文件（MDX 或直接写 TSX）

**测试方式**
1. 页面可正常渲染
2. SEO metadata 正确（可索引，有 canonical）
3. 代码示例可复制

**预期效果**
- 开发者能自助查阅 API 接入方式

---

### T17: Codex/Claude Agent Skill

**背景**
ARCHITECTURE.md 规划了 installable agent skill，让 Codex/Claude 等 AI agent 直接通过 skill file 接入 Cerul API。

**目的**
编写 SKILL.md，使 AI agent 能通过安装 skill 来调用 Cerul 搜索 API。

**改动范围**
- `skills/cerul-api/SKILL.md` — 新建或完善

**测试方式**
1. 在 Claude Code 中安装 skill，验证能调用搜索 API
2. 检查 skill 描述是否覆盖主要 use case

**预期效果**
- AI agent 可通过 skill 直接使用 Cerul

---

### T18: 速率限制增强

**背景**
当前速率限制在 `api_key.py` 中用数据库查询实现（查最近 1 秒内请求数），属于进程内方案。高并发或多实例部署时需要更可靠的方案。

**目的**
抽取独立的 `RateLimiter` 接口，MVP 用进程内 token bucket，预留 Redis 替换接口。

**改动范围**
- `backend/app/middleware/rate_limit.py` — 新建，实现 `RateLimiter` 接口和 token bucket
- `backend/app/auth/api_key.py` — 改用 `RateLimiter` 接口

**测试方式**
1. 连续请求超过速率限制返回 429
2. 等待 1 秒后可继续请求
3. 不同 API Key 有独立的速率窗口

**预期效果**
- 速率限制逻辑独立可替换
- 接口清晰，后续可无缝切换 Redis 实现

---

## 启动计划

以下是按轮次组织的并行启动计划。每一轮中的任务之间**没有依赖关系**，可以同时开多个 worktree 并行开发。下一轮的任务依赖上一轮的成果，必须等上一轮合并后再启动。

### 第 1 轮：基础设施（4 个 worktree）

| Worktree | 任务 | 简述 |
|----------|------|------|
| wt-1 | **T01** Gemini Embedding 迁移 | 替换 CLIP → Gemini，统一 768 维 |
| wt-2 | **T02** Better Auth 集成 | 真实用户注册/登录/session |
| wt-3 | **T03** 配置管理系统 | 三层配置加载 |
| wt-4 | **T04** Stub DB 清理 | 移除内存 mock，统一走真实 DB |

**合并顺序**：T03 → T04 → T01 → T02（建议，但因为改动范围不重叠，冲突概率低）

**本轮完成标志**：
- Gemini embedding 可用，CLIP 移除
- 用户能注册登录，Dashboard session 鉴权生效
- 后端配置统一从 yaml + env 加载
- 无 stub 代码残留

---

### 第 2 轮：核心能力（5 个 worktree）

| Worktree | 任务 | 简述 |
|----------|------|------|
| wt-1 | **T05** Knowledge Pipeline | 9 步视频处理 pipeline |
| wt-2 | **T06** YouTube 数据客户端 | YouTube Data API 封装 |
| wt-3 | **T07** 查询向量生成 | 搜索时用 Gemini embed query |
| wt-4 | **T12** Pixabay 集成完善 | 双数据源对齐 |
| wt-5 | **T18** 速率限制增强 | 抽取独立 RateLimiter |

> T06 和 T05 虽然有关联（T05 的 fetch_metadata step 会用到 YouTube 客户端），但可以并行开发：T06 先独立实现客户端，T05 的 fetch_metadata step 先用简化版或 mock，合并后对接。

**合并顺序**：T06 → T18 → T12 → T07 → T05

**本轮完成标志**：
- Knowledge pipeline 能处理 YouTube 视频
- B-roll 搜索返回真实相关结果
- Pixabay 素材可正常入库
- 速率限制架构清晰可扩展

---

### 第 3 轮：自动化与内容（4 个 worktree）

| Worktree | 任务 | 简述 |
|----------|------|------|
| wt-1 | **T08** Knowledge 搜索答案生成 | LLM 生成答案 + rerank |
| wt-2 | **T09** Scheduler 自动化 | 自动发现内容并投递 job |
| wt-3 | **T10** Worker 重试机制 | job 轮询 + 失败重试 |
| wt-4 | **T11** B-roll 扩量 10 万条 | 批量入库素材 |

**合并顺序**：T09 → T10 → T08 → T11

**本轮完成标志**：
- Knowledge 搜索能返回 LLM 生成的答案
- 新增内容源后自动开始处理
- Worker 故障自动恢复
- B-roll 数据量达到 10 万级别

---

### 第 4 轮：前端与生态（5 个 worktree）

| Worktree | 任务 | 简述 |
|----------|------|------|
| wt-1 | **T13** Search Demo 页面 | 公开搜索体验页 |
| wt-2 | **T14** Pipelines Dashboard | Pipeline 状态监控 |
| wt-3 | **T15** Stripe 端到端验证 | 付费流程完整可用 |
| wt-4 | **T16** Docs 内容页面 | API 文档 |
| wt-5 | **T17** Codex/Claude Agent Skill | AI agent 接入 |

**合并顺序**：无强依赖，可任意顺序合并

**本轮完成标志**：
- 外部用户可以通过 Demo 体验搜索
- 开发者可以查阅文档并接入 API
- 付费升级流程端到端可用
- AI agent 可通过 skill 调用 Cerul

---

## 依赖关系图

```
第 1 轮（并行）          第 2 轮（并行）          第 3 轮（并行）          第 4 轮（并行）
─────────────          ─────────────          ─────────────          ─────────────

T01 Gemini ─────────┬── T05 Knowledge ────┬── T08 答案生成          T13 Search Demo
                    ├── T07 查询向量 ──────┤                        T14 Pipelines
                    │                      ├── T09 Scheduler         T15 Stripe E2E
T02 Better Auth ────│──────────────────────│── T15 Stripe E2E       T16 Docs
                    │                      ├── T10 Worker 重试       T17 Skill
T03 配置管理         ├── T12 Pixabay        └── T11 B-roll 扩量
                    ├── T18 速率限制
T04 Stub 清理       └── T06 YouTube
```
