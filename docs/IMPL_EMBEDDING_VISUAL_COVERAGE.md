# Implementation: Embedding 全覆盖视觉信号（2帧/unit）

> **给 Codex 的实现指令文档**
> 改完后需要重新索引现有视频。

---

## 背景

当前图片搜索效果不好：用户用视频截图搜索，即使搜到了正确的片段，分数也很低（0.318）。

根因：text_only 路由的 scene 对应的 speech unit，embedding 是纯文字生成的，没有任何视觉信号。图片查询向量和纯文字向量在 Gemini Embedding 2 的 3072D 空间里天然距离远。

数据库验证：这个视频 40 个 speech unit 中有 21 个（52%）是纯文字 embedding，完全没有图片参与。

解决方案：让所有 retrieval unit 的 embedding 都包含 2 帧图片，保证图片搜索时有视觉信号可匹配。

成本影响：每个 60 分钟视频 embedding 费用从 $0.005 → $0.011，增加 $0.006，可忽略。

---

## 具体改动

### 1. 新增帧截取工具函数

**文件：`workers/knowledge/steps/embed.py`**

新增一个函数，用 ffmpeg 按时间戳截帧：

```python
import asyncio
import tempfile
from pathlib import Path

async def extract_frame_at_timestamp(
    video_path: str | Path,
    timestamp_seconds: float,
    output_path: Path,
) -> Path | None:
    """用 ffmpeg 在指定时间戳截取一帧。返回输出路径，失败返回 None。"""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-loglevel", "error",
            "-ss", f"{timestamp_seconds:.3f}",
            "-i", str(video_path),
            "-frames:v", "1", "-q:v", "2", "-y",
            str(output_path),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(proc.communicate(), timeout=15.0)
    except (FileNotFoundError, asyncio.TimeoutError):
        return None
    if proc.returncode != 0 or not output_path.exists():
        return None
    return output_path
```

### 2. 计算 embedding 帧时间戳

新增函数，计算每个 segment 应该截帧的时间点：

```python
def compute_embedding_frame_timestamps(
    timestamp_start: float,
    timestamp_end: float,
) -> list[float]:
    """返回 1-2 个时间戳用于 embedding 帧截取。"""
    duration = timestamp_end - timestamp_start
    if duration <= 0:
        return []
    if duration < 10:
        # 太短，只取 1 帧（正中间）
        return [timestamp_start + duration * 0.5]
    # 取 1/3 和 2/3 处
    return [
        timestamp_start + duration * 0.33,
        timestamp_start + duration * 0.67,
    ]
```

### 3. 修改 EmbedKnowledgeSegmentsStep

**文件：`workers/knowledge/steps/embed.py`**

当前逻辑：
- 有 `frame_paths` → 调 `embed_multimodal(text, image_paths=frame_paths)`
- 没有 `frame_paths` → 调 `embed_text(text)`

改为：
- 有 `frame_paths` → 调 `embed_multimodal(text, image_paths=frame_paths[:2])`（最多取 2 帧）
- **没有 `frame_paths` → 用 ffmpeg 按 1/3 和 2/3 时间戳截 2 帧 → 调 `embed_multimodal(text, image_paths=截取的帧)`**
- ffmpeg 截帧失败 → fallback 到 `embed_text(text)`（不报错）

关键：需要从 `context.data` 获取 `video_path`（下载步骤已保存）。

修改 `_process` 方法中的 `embed_segment` 函数：

```python
async def embed_segment(segment):
    segment_index = int(segment["segment_index"])
    payload = self._build_embedding_payload(segment)
    frame_paths = [
        str(p) for p in (segment.get("frame_paths") or [])
        if str(p).strip()
    ]

    # 如果没有 frame_paths，用 ffmpeg 截帧补全
    temp_frame_paths = []
    if not frame_paths and video_path:
        timestamps = compute_embedding_frame_timestamps(
            float(segment.get("timestamp_start") or 0),
            float(segment.get("timestamp_end") or 0),
        )
        for i, ts in enumerate(timestamps):
            output = temp_dir / f"embed_frame_{segment_index}_{i}.jpg"
            result = await extract_frame_at_timestamp(video_path, ts, output)
            if result:
                temp_frame_paths.append(str(result))
        frame_paths = temp_frame_paths

    try:
        async with semaphore:
            embed_multimodal = getattr(embedding_backend, "embed_multimodal", None)
            if frame_paths and callable(embed_multimodal):
                vector = list(await asyncio.to_thread(
                    embed_multimodal, payload,
                    image_paths=frame_paths[:2],  # 最多 2 帧
                ))
                has_visual_embedding = True
            else:
                vector = list(await asyncio.to_thread(
                    embedding_backend.embed_text, payload,
                ))
                has_visual_embedding = False
    except Exception as exc:
        return segment_index, None, str(exc), None
    finally:
        # 清理临时截帧
        for p in temp_frame_paths:
            Path(p).unlink(missing_ok=True)

    ...
```

注意事项：
- `video_path` 从 `context.data.get("video_path")` 获取
- 截帧输出到临时目录，embedding 完成后立即清理
- 截帧失败（ffmpeg 不可用、视频已删除等）静默 fallback 到纯文字 embedding

### 4. 对已有 frame_paths 也限制最多 2 帧

当前 `embed_multimodal` 最多支持 6 帧，但为了保持一致性和控制成本，统一限制 `image_paths=frame_paths[:2]`。

### 5. Unified pipeline 同样处理

**文件：`workers/unified/pipeline.py`**

在 `_build_units_from_knowledge_segments` 中，对 visual unit 的 `_resolve_visual_unit_embedding` 同样确保最多传 2 帧。当前已经有 `[:6]` 的限制，改为 `[:2]`。

---

## 不改什么

- 不改 scene 路由逻辑（text_only/embed_only/annotate 保持不变）
- 不改帧标注逻辑（Gemini Flash 标注仍然只对 annotate 路由）
- 不改数据库 schema
- 不改搜索逻辑

---

## 验证

1. `pytest workers/tests -q` 全部通过
2. `pytest backend/tests -q` 全部通过
3. 重新索引一个视频，检查数据库：
```sql
SELECT unit_type, count(*),
       count(*) FILTER (WHERE visual_desc IS NOT NULL) as with_visual
FROM retrieval_units ru
JOIN videos v ON v.id = ru.video_id
WHERE v.source_video_id = 'LCEmiRjPEtQ'
GROUP BY unit_type;
```
确认所有 speech unit 都参与了 multimodal embedding（可以通过日志或 artifacts 确认）

4. 用之前的截图重新搜索：
```bash
curl "http://127.0.0.1:8000/v1/search" \
  -H "Authorization: Bearer cerul_sk_..." \
  -H "Content-Type: application/json" \
  -d '{"image": {"url": "https://dubrify-1304425019.cos.ap-hongkong.myqcloud.com/123321.png"}, "max_results": 5}'
```
预期：第一条结果的 score 应该从 0.318 提升到 0.5+
