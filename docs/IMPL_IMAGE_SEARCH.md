# Implementation: 图片搜索 + Snippet/Answer 修复

> **给 Codex 的实现指令文档**
> 请按顺序逐步实现。先修 snippet/answer，再加图片搜索，最后跑测试。

---

## 背景

当前搜索结果有两个问题需要解决：

1. **Visual snippet/answer 优先级错误**：visual unit 的 snippet 优先显示 OCR 文本（如 "NO PRIORS / NO-PRIORS.COM"），而不是视觉描述（如 "A man and a woman seated in a room with a fireplace"）。导致用户搜视觉场景时，结果看起来像没搜到。answer 生成同样有此问题，LLM 看到的是 OCR 文本而非场景描述。

2. **不支持图片搜索**：当前 `/v1/search` 只接受文字 query。用户需要能上传一张图片（或图片+文字）来搜索视觉相似的视频片段。当前架构的 embedding 模型（Gemini Embedding 2）已经是多模态的，索引时已经在用图片做 embedding，只需要在查询端也支持图片输入即可。

---

## Part 1: 修复 Snippet 和 Answer 优先级

### 1.1 Visual Snippet

**文件：`backend/app/search/unified.py`**

找到构建 visual unit snippet 的逻辑。当前优先取 `visual_text_content`（OCR），改为：

1. `visual_description`（视觉场景描述）
2. `visual_text_content`（OCR 文本）
3. `content_text`（兜底）

### 1.2 Answer Prompt

**文件：`backend/app/search/answer.py`**

找到构建 Visual evidence 的逻辑。当前只用 `visual_text_content`。改为同时提供两者，且 `visual_description` 在前：

```
Visual evidence:
Scene: {visual_description}
On-screen text: {visual_text_content}
```

---

## Part 2: 搜索接口支持图片输入

### 2.1 SearchRequest 模型

**文件：`backend/app/search/models.py`**

```python
class SearchImageInput(StrictModel):
    url: AnyHttpUrl | None = None
    base64: str | None = None

    @model_validator(mode="after")
    def validate_single_source(self):
        if self.url and self.base64:
            raise ValueError("Provide either 'url' or 'base64', not both.")
        if not self.url and not self.base64:
            raise ValueError("Provide 'url' or 'base64'.")
        return self


class SearchRequest(StrictModel):
    query: str | None = Field(default=None, min_length=1)  # 改为可选
    image: SearchImageInput | None = None  # 新增
    max_results: int = Field(default=10, ge=1, le=50)
    ranking_mode: Literal["embedding", "rerank"] = "embedding"
    include_summary: bool = False
    include_answer: bool = False
    filters: UnifiedFilters | None = None

    @model_validator(mode="after")
    def validate_query_or_image(self):
        if not self.query and not self.image:
            raise ValueError("At least one of 'query' or 'image' must be provided.")
        return self
```

### 2.2 图片归一化模块

**新文件：`backend/app/search/query_image.py`**

```python
"""
归一化用户传入的查询图片，支持 URL / base64 / data URI / multipart file。
"""
import asyncio
import base64
import hashlib
import os
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx

ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB


async def resolve_image_to_local(
    *,
    url: str | None = None,
    base64_str: str | None = None,
    file_bytes: bytes | None = None,
    file_content_type: str | None = None,
) -> tuple[Path, str]:
    """
    接受任意一种图片输入，返回 (本地临时文件路径, mime_type)。
    调用方负责清理临时文件。

    逻辑：
    - url: 下载到临时文件
    - base64_str: 支持 raw base64 或 data:image/xxx;base64,... 格式
    - file_bytes: 直接写入临时文件
    """
    if url:
        return await _download_image(url)
    elif base64_str:
        return _decode_base64_image(base64_str)
    elif file_bytes:
        return _save_bytes_image(file_bytes, file_content_type)
    else:
        raise ValueError("No image input provided.")


async def upload_query_image_to_r2(
    image_path: Path,
    *,
    request_id: str,
) -> str | None:
    """
    上传查询图片到 R2 留存。
    路径：query-inputs/{YYYY-MM-DD}/{request_id}/{sha256}.jpg
    R2 未配置时返回 None。
    """
    # 复用 workers/common/storage.py 的 R2 逻辑，
    # 或者用 boto3 直接上传。
    # 关键点：
    # - 读取 R2 环境变量，不可用则返回 None
    # - key 格式: query-inputs/{date}/{request_id}/{sha256}.{ext}
    # - 不返回公开 URL（这是用户隐私数据）
    # - 上传失败不阻塞搜索流程（try/except 吞掉异常，只 log）
    ...


async def _download_image(url: str) -> tuple[Path, str]:
    """下载图片 URL 到临时文件。"""
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        response = await client.get(url)
        response.raise_for_status()

    content_type = response.headers.get("content-type", "").split(";")[0].strip()
    if content_type not in ALLOWED_MIME_TYPES:
        raise ValueError(f"Unsupported image type: {content_type}")
    if len(response.content) > MAX_IMAGE_SIZE_BYTES:
        raise ValueError(f"Image too large: {len(response.content)} bytes (max {MAX_IMAGE_SIZE_BYTES})")

    ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[content_type]
    tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
    tmp.write(response.content)
    tmp.close()
    return Path(tmp.name), content_type


def _decode_base64_image(base64_str: str) -> tuple[Path, str]:
    """解码 base64 或 data URI。"""
    mime_type = "image/jpeg"  # default
    data = base64_str

    # 处理 data URI: data:image/png;base64,xxxx
    if data.startswith("data:"):
        header, _, data = data.partition(",")
        # header = "data:image/png;base64"
        mime_part = header.split(";")[0].replace("data:", "")
        if mime_part in ALLOWED_MIME_TYPES:
            mime_type = mime_part

    raw_bytes = base64.b64decode(data)
    if len(raw_bytes) > MAX_IMAGE_SIZE_BYTES:
        raise ValueError(f"Image too large: {len(raw_bytes)} bytes")

    ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}.get(mime_type, ".jpg")
    tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
    tmp.write(raw_bytes)
    tmp.close()
    return Path(tmp.name), mime_type


def _save_bytes_image(file_bytes: bytes, content_type: str | None) -> tuple[Path, str]:
    """保存 multipart 上传的 raw bytes。"""
    mime_type = (content_type or "image/jpeg").split(";")[0].strip()
    if mime_type not in ALLOWED_MIME_TYPES:
        raise ValueError(f"Unsupported image type: {mime_type}")
    if len(file_bytes) > MAX_IMAGE_SIZE_BYTES:
        raise ValueError(f"Image too large: {len(file_bytes)} bytes")

    ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}.get(mime_type, ".jpg")
    tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
    tmp.write(file_bytes)
    tmp.close()
    return Path(tmp.name), mime_type
```

### 2.3 Embedding 后端：新增查询用多模态方法

**文件：`backend/app/embedding/gemini.py`**

新增方法（和现有 `embed_multimodal` 类似，但 task_type 用 `RETRIEVAL_QUERY`）：

```python
def embed_query_with_image(
    self,
    text: str | None = None,
    *,
    image_path: str | Path | None = None,
) -> list[float]:
    """查询时用的多模态 embedding（RETRIEVAL_QUERY task type）。"""
    contents: list[Any] = []
    if text and text.strip():
        contents.append(self._build_text_part(text.strip()))
    if image_path:
        resolved_path = Path(image_path)
        if resolved_path.exists():
            contents.append(
                self._build_media_part_from_path(resolved_path, expected_mime_prefix="image/")
            )
    if not contents:
        raise ValueError("At least text or image_path must be provided.")
    return self._embed_content(contents, task_type=TASK_RETRIEVAL_QUERY)
```

同时在 `EmbeddingBackend` 基类（`backend/app/embedding/__init__.py` 或 `base.py`）中声明此方法的接口，允许 `hasattr` 检查。

### 2.4 查询向量解析

**文件：`backend/app/search/base.py`**

修改 `resolve_query_vector`，支持图片输入：

```python
async def resolve_query_vector(
    *,
    query: str | None = None,
    image_path: Path | None = None,  # 新增
    search_type: str,
    expected_dimension: int,
    embedding_backend: EmbeddingBackend,
    query_vector: Sequence[float] | None = None,
) -> list[float]:
    if query_vector is not None:
        resolved_vector = [float(v) for v in query_vector]
    elif image_path is not None:
        # 有图片：用多模态查询 embedding
        embed_fn = getattr(embedding_backend, "embed_query_with_image", None)
        if embed_fn is None:
            raise ValueError("Embedding backend does not support image queries.")
        resolved_vector = list(await asyncio.to_thread(
            embed_fn, query, image_path=image_path
        ))
    elif query:
        # 纯文字
        resolved_vector = list(await asyncio.to_thread(
            embedding_backend.embed_query, query
        ))
    else:
        raise ValueError("No query input provided.")

    if len(resolved_vector) != expected_dimension:
        raise ValueError(
            f"Query vector dimension mismatch: got {len(resolved_vector)}, expected {expected_dimension}."
        )
    return resolved_vector
```

### 2.5 UnifiedSearchService

**文件：`backend/app/search/unified.py`**

`search()` 方法新增 `image_path` 参数，传递给 `resolve_query_vector`：

```python
async def search(
    self,
    request: SearchRequest,
    *,
    user_id: str,
    request_id: str,
    query_vector: Sequence[float] | None = None,
    image_path: Path | None = None,  # 新增
) -> SearchExecution:
    resolved_query_vector = await resolve_query_vector(
        query=request.query,
        image_path=image_path,  # 传递
        search_type="unified",
        ...
    )
```

### 2.6 搜索路由

**文件：`backend/app/routers/search.py`**

支持两种 Content-Type：

**JSON 模式**（现有端点改造）：
```python
@router.post("/v1/search")
async def search_endpoint(request: SearchRequest, ...):
    image_path = None
    try:
        if request.image:
            image_path, mime_type = await resolve_image_to_local(
                url=str(request.image.url) if request.image.url else None,
                base64_str=request.image.base64,
            )

        result = await service.search(
            request,
            user_id=user_id,
            request_id=request_id,
            image_path=image_path,
        )

        # 异步上传查询图片到 R2（不阻塞响应）
        if image_path:
            asyncio.create_task(
                upload_query_image_to_r2(image_path, request_id=request_id)
            )

        return result
    finally:
        if image_path and image_path.exists():
            # 延迟清理，等 R2 上传完
            # 可以用 background task 或简单 delay
            pass
```

**Multipart 模式**（新增端点）：
```python
@router.post("/v1/search/upload")
async def search_with_upload(
    query: str | None = Form(default=None),
    max_results: int = Form(default=10),
    include_answer: bool = Form(default=False),
    ranking_mode: str = Form(default="embedding"),
    image_file: UploadFile | None = File(default=None),
    ...
):
    """支持 multipart/form-data 上传图片文件。"""
    image_path = None
    try:
        if image_file:
            file_bytes = await image_file.read()
            image_path, mime_type = await resolve_image_to_local(
                file_bytes=file_bytes,
                file_content_type=image_file.content_type,
            )

        # 构造 SearchRequest 并复用主搜索逻辑
        search_request = SearchRequest(
            query=query,
            max_results=max_results,
            include_answer=include_answer,
            ranking_mode=ranking_mode,
        )
        result = await service.search(
            search_request,
            user_id=user_id,
            request_id=request_id,
            image_path=image_path,
        )
        return result
    finally:
        if image_path and image_path.exists():
            image_path.unlink(missing_ok=True)
```

### 2.7 R2 查询图片存储

查询图片上传到 R2 的 `query-inputs/` 目录：
- Key：`query-inputs/{YYYY-MM-DD}/{request_id}/{sha256}.{ext}`
- 使用已有的 R2 配置（和帧上传共用 cerul-cdn bucket）
- 上传失败不阻塞搜索（try/except + log warning）
- 不在 API 响应中返回图片 URL
- 后续配置 R2 lifecycle rule 7 天自动删除

### 2.8 计费

不变。三种模式统一计费：
- 无 answer：1 credit
- 有 answer：2 credits

---

## 文件改动清单

| 文件 | 改动 |
|------|------|
| `backend/app/search/unified.py` | visual snippet 优先级 + search 传递 image_path |
| `backend/app/search/answer.py` | answer prompt 视觉证据优先级 |
| `backend/app/search/models.py` | query 改可选，新增 SearchImageInput + validator |
| `backend/app/search/query_image.py` | **新建** 图片归一化 + R2 上传 |
| `backend/app/embedding/gemini.py` | 新增 embed_query_with_image |
| `backend/app/search/base.py` | resolve_query_vector 支持 image_path |
| `backend/app/routers/search.py` | JSON image 处理 + multipart 端点 |
| 测试文件 | 补搜索相关测试 |

---

## 不改什么

- 数据库 schema 不动
- 不重建索引
- 不改 pipeline
- 不改检索 SQL
- 不加 visual unit 偏置
- 不做 text_only clustering

---

## 验证

1. **回归**：纯文字搜索 `{"query": "AGI"}` → 正常返回，行为不变
2. **snippet 修复**：搜视觉场景 → visual unit 的 snippet 显示场景描述而非 OCR
3. **answer 修复**：`include_answer: true` → answer 引用视觉描述
4. **纯图片搜索（base64）**：`{"image": {"base64": "/9j/4AAQ..."}}` → 返回视觉相似结果
5. **纯图片搜索（URL）**：`{"image": {"url": "https://example.com/photo.jpg"}}` → 同上
6. **图片+文字**：`{"query": "fireplace", "image": {"base64": "..."}}` → 结合两者
7. **multipart 上传**：`POST /v1/search/upload` + form data → 正常返回
8. **两个都不传**：`{}` → 返回 422
9. **大图拒绝**：>10MB 图片 → 返回 422
10. **不支持的格式**：gif/bmp → 返回 422
11. **R2 存储**：查询图片出现在 R2 的 query-inputs/ 目录
12. **R2 未配置**：搜索正常执行，只是不存查询图片
13. **测试通过**：`pytest backend/tests -q`
