# Knowledge Worker Pipeline — Handoff Notes

## 目标

将 YouTube 技术/AI 访谈、大会演讲、产品发布会视频嵌入多模态向量数据库，供语义搜索使用。
Pipeline track = `knowledge`，DB = `processing_jobs` 表。

---

## Pipeline 流程（现有代码骨架）

```
FetchKnowledgeMetadataStep
  → FetchKnowledgeCaptionsStep      # yt-dlp 抓字幕，成功则跳过 Whisper
  → DownloadKnowledgeVideoStep      # yt-dlp 下载视频
  → TranscribeKnowledgeVideoStep    # Whisper API 转录（★ 需改造）
  → DetectKnowledgeScenesStep       # Whisper segments 归并成 scenes
  → AnalyzeKnowledgeFramesStep      # 关键帧提取 + LLM 标注（★ 需改造）
  → SegmentKnowledgeTranscriptStep  # scene → embedding 用的 segment
  → EmbedKnowledgeSegmentsStep      # Gemini multimodal embedding（★ 需改造）
  → StoreKnowledgeSegmentsStep      # 写 knowledge_segments（pgvector）
  → MarkKnowledgeJobCompletedStep
```

关键文件：
- `workers/knowledge/runtime.py` — 所有 runtime 实现
- `workers/knowledge/pipeline.py` — 组装 pipeline
- `workers/knowledge/steps/` — 各 step 实现
- `workers/knowledge/repository.py` — DB 写入（asyncpg）
- `backend/app/search/knowledge.py` — 搜索服务
- `backend/app/embedding/gemini.py` — Gemini embedding 封装（`embed_text`/`embed_image`/`embed_video` 已实现）

启动 worker：
```bash
nohup env $(cat .env | grep -v '^#' | grep -v '^$' | xargs) python -m workers.worker > /tmp/worker.log 2>&1 &
```

---

## 已修复的问题

1. **proxy**：`api.openai.com` 直连超时，必须走 `YTDLP_PROXY`，传入 `httpx.Client(proxy=proxy_url)`
2. **httpx 0.28.x 兼容**：`data=[list]+files=dict` 报错，改为 `data=dict+files=dict`
3. **m4a moov atom 腐化**：ffmpeg 被 kill 后 m4a 损坏，改为输出 `.mp3`
4. **asyncio + httpx**：不能用 `AsyncClient`，改为同步 `Client` + `asyncio.to_thread()`
5. **runtime.py 语法损坏**：已恢复，`import workers.knowledge.runtime` 验证通过

---

## 待实现：完整架构设计

### 一、Whisper 转录切片（TranscribeKnowledgeVideoStep）

**问题**：Whisper API 对超长音频返回 400 或超时（实测：>约1小时的完整文件被拒）。
**正确做法**：在静音处切片，每块约 10 分钟，并发请求。

```
完整 mp3
  ↓
ffmpeg silencedetect 找静音点
  (-af "silencedetect=noise=-30dB:d=0.5")
  ↓
在最近的静音点处切，每块控制在 ~600 秒（10 分钟）
  ↓
asyncio.gather(*[call_whisper(chunk, offset) for chunk, offset in chunks])
  并发上传，建议 Semaphore(3) 控制并发数
  ↓
合并所有 chunk 结果，时间戳 += chunk_start_offset
  ↓
完整带时间戳转录 [{start, end, text}, ...]
```

代码位置：`runtime.py` → `OpenAICompatibleTranscriber._transcribe_with_chunking()`
当前实现是错误的（机械 1 小时切割），需替换。

---

### 二、关键帧提取 + LLM 标注（AnalyzeKnowledgeFramesStep）

**目标**：只在"画面有信息增量"时才做图像 embedding，跳过纯人物说话的帧。

#### Step 1：ffmpeg 场景变化帧提取
```bash
ffmpeg -ss {start} -to {end} -i video.mp4 \
  -vf "select='gt(scene,0.25)',scale=640:360" \
  -vsync vfr /tmp/frames/frame_%03d.jpg
# 同时保底提取 segment 中间时间点的 1 帧
```

#### Step 2：感知哈希去重（imagehash 库）
```python
# pHash 距离 < 8 视为重复，保留代表帧
unique_frames = deduplicate_by_phash(candidate_frames, threshold=8)
```

#### Step 3：启发式判断帧是否有信息增量
```python
def is_informative(img_path) -> bool:
    # 使用 OpenCV 检测：
    # 肤色占比 > 45% 且边缘密度 < 4% → 说话人特写，无增量
    # 否则 → 可能有幻灯片/图表/代码
    skin_ratio = detect_skin_ratio(img)      # HSV 范围检测
    edge_ratio = detect_edge_density(img)    # Canny 边缘
    return not (skin_ratio > 0.45 and edge_ratio < 0.04)
```

#### Step 4：Gemini Flash 标注（仅对 informative 帧调用）
```python
ANNOTATION_PROMPT = """
这是一张技术演讲/访谈的截图。请输出JSON：
{
  "description": "1-2句话描述画面内容",
  "text_content": "图中所有可见文字（标题/数字/列表/代码，逐字提取）",
  "visual_type": "slide|chart|diagram|code|product_demo|whiteboard|other",
  "key_entities": ["模型名", "产品名", "指标名", "公司名", ...]
}
"""
# 调用 Gemini Flash（gemini-2.0-flash）
# 成本：约 $0.00002/张，可忽略
```

#### Step 5：决策
```
无 informative 帧 → 该 segment 仅做文字 embedding
有 informative 帧 → 取最多 4 张 + Gemini Flash 标注
```

---

### 三、多模态 Embedding（EmbedKnowledgeSegmentsStep）

#### Gemini Embedding 2 限制（gemini-embedding-2-preview）
| 输入 | 限制 |
|------|------|
| 文字 | 8,192 tokens |
| 图片 | 最多 **6 张**（PNG/JPEG） |
| 视频 | 最多 **128 秒**（无音频）/ 80 秒（含音频）|
| 输出维度 | 默认 **3072**，支持 MRL 截断 |

**结论：使用"文字 + 关键帧图片"方案（方案A），不传视频片段。**
原因：访谈类视频主要信息在语音+幻灯片，视频片段的动态信息价值有限且传输成本高。

#### Embedding 调用逻辑

```python
def build_embedding_text(segment, annotation=None):
    parts = [segment["title"], segment["transcript_text"]]
    if annotation:
        if annotation.get("description"):
            parts.append(f"[画面内容：{annotation['description']}]")
        if annotation.get("text_content"):
            parts.append(f"[画面文字：{annotation['text_content']}]")
        if annotation.get("key_entities"):
            parts.append(f"[关键词：{', '.join(annotation['key_entities'])}]")
    return "\n".join(p for p in parts if p)

# 有视觉信息的 segment
contents = [
    types.Part.from_text(build_embedding_text(segment, annotation)),
    types.Part.from_bytes(data=frame1_bytes, mime_type="image/jpeg"),
    types.Part.from_bytes(data=frame2_bytes, mime_type="image/jpeg"),  # 可选
]

# 纯说话的 segment
contents = [types.Part.from_text(build_embedding_text(segment))]

# 统一调用，返回 3072 维向量
response = client.models.embed_content(
    model="gemini-embedding-2-preview",
    contents=contents,
    config=types.EmbedContentConfig(
        task_type="RETRIEVAL_DOCUMENT",
        output_dimensionality=3072,
    )
)
```

**关键**：纯文字 embedding 和文字+图片 embedding 在同一向量空间，搜索时完全兼容。

#### DB 字段调整（knowledge_segments 表新增）
```sql
ALTER TABLE knowledge_segments
  ADD COLUMN has_visual_embedding  BOOLEAN  DEFAULT FALSE,
  ADD COLUMN visual_type           TEXT,                    -- slide/chart/diagram/...
  ADD COLUMN visual_description    TEXT,                    -- Gemini Flash 生成的描述
  ADD COLUMN visual_text_content   TEXT,                    -- OCR式文字提取
  ADD COLUMN visual_entities       TEXT[];                  -- 关键实体列表
```

---

### 四、搜索流程（现有代码基本正确）

```
用户 query（纯文字）
  ↓
GeminiEmbeddingBackend.embed_query()  ← RETRIEVAL_QUERY 任务类型
  ↓ 3072维向量
pgvector 余弦相似度：
  SELECT ... ORDER BY embedding <=> $query_vector LIMIT 50
  ↓
LLMReranker（精排，可读取 transcript_text + visual_text_content）
  ↓
MMR 多样性筛选（避免同一视频占据所有结果）
  ↓
返回 KnowledgeResult（含 timestamp_start/end，可跳转到视频对应位置）
```

**为什么文字 query 能命中文字+图片 embedding？**
Gemini Embedding 2 的训练目标是让"描述某概念的文字"和"该概念的视觉呈现"在同一空间里邻近。纯文字 query 向量 vs 文字+图片 document 向量，余弦相似度完全有效。

---

### 五、目前 HeuristicFrameAnalyzer 的问题

`runtime.py` 中的 `HeuristicFrameAnalyzer.analyze_scene()` 是**占位实现**，并未提取真实视频帧，只生成 `"Speaker X is on screen discussing Y."` 这样的假文字。整个 `embed_image()`/`embed_video()` 接口虽然在 `GeminiEmbeddingBackend` 里已实现，但**完全未接入 embedding pipeline**。

这是当前最大的待实现功能。

---

## 前期测试视频推荐

### 适合的内容类型（优先级排序）

| 类型 | 特点 | 视觉信息价值 |
|------|------|-------------|
| AI 研究者访谈（长篇）| 深度技术讨论，偶有白板/图表 | 中 |
| AI 大会演讲（NeurIPS/ICML/Google I/O）| 大量幻灯片，benchmark 表格 | 高 |
| AI 产品发布会（OpenAI/Google/Anthropic）| 产品 demo 截图，功能幻灯片 | 高 |
| 技术教程/讲解视频 | 代码、架构图 | 高 |

### 推荐 YouTube 频道 & 具体视频

#### 深度访谈（Lex Fridman Podcast）
频道：`@lexfridman`
适合的访谈对象（技术密度高，常有白板/图表）：
- Sam Altman（OpenAI）
- Demis Hassabis（Google DeepMind）
- Ilya Sutskever（OpenAI/SSI）
- Yann LeCun（Meta AI）← 已在队列中 `SGzMElJ11Cc`
- Geoffrey Hinton
- Andrej Karpathy
- George Hotz
- Stephen Wolfram ← 已在队列中 `flXrLGPY3SU`

#### 深度访谈（Dwarkesh Patel Podcast）
频道：`@DwarkeshPatel`
内容质量极高，技术深度强：
- Francois Chollet
- Leopold Aschenbrenner
- Demis Hassabis
- John Carmack

#### AI 大会演讲
- **NeurIPS/ICML 官方频道**：`@NeurIPSConference`，`@icmlconference`
- **Google DeepMind**：`@GoogleDeepMind`
  - Gemini 技术演讲，AlphaFold 介绍
- **Stanford HAI**：`@StanfordHAI`
  - 学术向，演讲者多为顶级研究员

#### AI 产品发布会（幻灯片密集，视觉信息价值最高）
- **OpenAI 官方**：`@OpenAI`
  - GPT-4 发布、Sora 发布、DevDay 演讲
- **Google 官方**：`@Google`
  - Google I/O 2024/2025，Gemini 发布
- **Anthropic**：访谈类为主，无官方发布会频道
- **Microsoft**：`@Microsoft`
  - Build 大会，Copilot 产品演示

#### 技术讲解（高密度幻灯片/代码）
- **Andrej Karpathy**：`@AndrejKarpathy`
  - "Let's build GPT"，"Neural Networks: Zero to Hero" 系列
  - 代码+白板密度极高，视觉 embedding 价值最大
- **3Blue1Brown**：`@3blue1brown`
  - 神经网络可视化，数学动画（但版权需注意，CC license 请确认）

### 前期测试建议（10-20 个视频）

**第一批（5 个）：验证 pipeline 基础流程**
优先选 30-60 分钟的视频，避免超长视频影响调试效率：
1. Andrej Karpathy 的技术讲解（代码密集，视觉信息多，容易验证 frame detection）
2. Dwarkesh × Francois Chollet（ARC-AGI，技术密度高）
3. Google I/O 某个 AI 主题演讲（幻灯片密集，验证 slide 标注）
4. Lex × Andrej Karpathy（偏技术，偶有白板）
5. 任意一个 NeurIPS 演讲（纯幻灯片形式，极端测试视觉标注）

**第二批（10-15 个）：扩大覆盖**
混入长视频（1.5-3 小时），验证切片 + 并发转录。

### 注意事项
- YouTube 视频均需确认 **Creative Commons 或官方允许使用** 的 license
- Lex Fridman Podcast 标注为 CC BY 4.0，可商用
- Google/OpenAI 官方发布视频通常允许嵌入和引用，但严格商用需确认
- 优先找有官方字幕的视频（跳过 Whisper，处理快几十倍）
