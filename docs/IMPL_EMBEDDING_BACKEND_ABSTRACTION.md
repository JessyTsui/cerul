# Implementation: Embedding 后端抽象 + OpenAI Compatible 支持

> **给 Codex 的实现指令文档**
> 实现后不切换默认后端，仍然用 Gemini。只是让代码支持通过环境变量无缝切换。
>
> 注：下面的文件路径已经按当前 monorepo 结构更新，worker 侧 embedding 实现在 `workers/common/embedding/*`，API 侧 provider 分派在 `api/src/services/embedding.ts`。

---

## 背景

当前系统的 embedding 硬编码使用 Gemini Embedding 2 API。我们测试发现 Qwen3-VL-Embedding-2B 在图片搜索上比 Gemini 强 30%+，文字搜索持平。为了未来能无缝切换到自建的 Qwen embedding 服务（通过 vLLM 部署，暴露 OpenAI 兼容接口），需要把 embedding 后端抽象化，支持通过环境变量一键切换。

目标：改一个 `EMBEDDING_BACKEND` 环境变量就能在 Gemini API 和自建 OpenAI compatible 服务之间切换，pipeline、search、所有调用方完全不感知。

---

## 1. 环境变量设计

**文件：`.env.example`**

新增：

```bash
# Embedding backend: "gemini" (default) or "openai_compatible"
EMBEDDING_BACKEND=gemini

# --- Gemini (used when EMBEDDING_BACKEND=gemini) ---
# GEMINI_API_KEY=xxx (already exists)

# --- OpenAI Compatible (used when EMBEDDING_BACKEND=openai_compatible) ---
# For self-hosted Qwen3-VL-Embedding via vLLM or similar
# EMBEDDING_OPENAI_BASE_URL=https://your-gpu-server:8080/v1
# EMBEDDING_OPENAI_API_KEY=your-key
# EMBEDDING_OPENAI_MODEL=qwen3-vl-embedding-2b
# EMBEDDING_DIMENSION=2048
```

默认值保持 `gemini`，不影响现有部署。

---

## 2. EmbeddingBackend 接口规范

**文件：`workers/common/embedding/base.py`**（如果不存在就新建）

确保 `EmbeddingBackend` 基类/协议有以下方法：

```python
class EmbeddingBackend(Protocol):
    @property
    def name(self) -> str: ...

    def dimension(self) -> int: ...

    def embed_text(self, text: str) -> list[float]:
        """索引时 embed 文档文本 (RETRIEVAL_DOCUMENT)"""
        ...

    def embed_query(self, text: str) -> list[float]:
        """搜索时 embed 查询文本 (RETRIEVAL_QUERY)"""
        ...

    def embed_multimodal(
        self,
        text: str,
        *,
        image_paths: Sequence[str | Path] | None = None,
    ) -> list[float]:
        """索引时 embed 文本+图片 (RETRIEVAL_DOCUMENT)"""
        ...

    def embed_query_with_image(
        self,
        text: str | None = None,
        *,
        image_path: str | Path | None = None,
    ) -> list[float]:
        """搜索时 embed 查询文本+图片 (RETRIEVAL_QUERY)"""
        ...
```

现有的 `GeminiEmbeddingBackend` 已经实现了这些方法，确认接口一致即可。

---

## 3. 新增 OpenAI Compatible Embedding Backend

**新文件：`workers/common/embedding/openai_compatible.py`**

```python
"""
OpenAI-compatible embedding backend.
Works with any service that implements the /v1/embeddings endpoint,
including vLLM, faster-whisper-server, TEI, etc.

Supports multimodal input if the underlying model supports it
(e.g., Qwen3-VL-Embedding via vLLM).
"""
import base64
import os
from pathlib import Path
from typing import Any, Sequence

import httpx


class OpenAICompatibleEmbeddingBackend:
    def __init__(
        self,
        *,
        base_url: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
        output_dimension: int | None = None,
    ) -> None:
        self._base_url = (
            base_url
            or os.getenv("EMBEDDING_OPENAI_BASE_URL", "").strip()
        ).rstrip("/")
        self._api_key = (
            api_key
            or os.getenv("EMBEDDING_OPENAI_API_KEY", "").strip()
            or "no-key"
        )
        self._model = (
            model
            or os.getenv("EMBEDDING_OPENAI_MODEL", "").strip()
            or "default"
        )
        self._output_dimension = int(
            output_dimension
            or os.getenv("EMBEDDING_DIMENSION", "2048")
        )
        if not self._base_url:
            raise ValueError(
                "EMBEDDING_OPENAI_BASE_URL is required for openai_compatible backend."
            )

    @property
    def name(self) -> str:
        return f"openai_compatible:{self._model}"

    def dimension(self) -> int:
        return self._output_dimension

    def embed_text(self, text: str) -> list[float]:
        return self._embed(text=text)

    def embed_query(self, text: str) -> list[float]:
        return self._embed(text=text)

    def embed_multimodal(
        self,
        text: str,
        *,
        image_paths: Sequence[str | Path] | None = None,
    ) -> list[float]:
        return self._embed(text=text, image_paths=image_paths)

    def embed_query_with_image(
        self,
        text: str | None = None,
        *,
        image_path: str | Path | None = None,
    ) -> list[float]:
        paths = [image_path] if image_path else None
        return self._embed(text=text, image_paths=paths)

    def _embed(
        self,
        *,
        text: str | None = None,
        image_paths: Sequence[str | Path] | None = None,
    ) -> list[float]:
        """
        Call /v1/embeddings endpoint.

        For text-only: standard OpenAI format.
        For multimodal: send input as a list of content parts
        (same format as OpenAI vision / vLLM multimodal embeddings).
        """
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

        # Build input
        if image_paths and any(image_paths):
            # Multimodal: build content parts array
            input_parts = []
            if text and text.strip():
                input_parts.append({"type": "text", "text": text.strip()})
            for img_path in (image_paths or []):
                if img_path is None:
                    continue
                resolved = Path(img_path)
                if not resolved.exists():
                    continue
                b64 = base64.b64encode(resolved.read_bytes()).decode("utf-8")
                mime = self._guess_mime(resolved)
                input_parts.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime};base64,{b64}"},
                })
            if not input_parts:
                raise ValueError("No valid input provided.")
            embedding_input = input_parts
        else:
            # Text-only: standard string input
            embedding_input = (text or "").strip()
            if not embedding_input:
                raise ValueError("text must not be empty.")

        payload: dict[str, Any] = {
            "model": self._model,
            "input": embedding_input,
        }
        if self._output_dimension:
            payload["dimensions"] = self._output_dimension

        proxy = os.getenv("HTTPS_PROXY") or os.getenv("HTTP_PROXY") or None
        with httpx.Client(timeout=60.0, proxy=proxy) as client:
            response = client.post(
                f"{self._base_url}/embeddings",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()

        data = response.json()
        embedding = data["data"][0]["embedding"]
        return [float(v) for v in embedding]

    @staticmethod
    def _guess_mime(path: Path) -> str:
        return {
            ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".png": "image/png", ".webp": "image/webp",
        }.get(path.suffix.lower(), "image/jpeg")
```

---

## 4. 工厂函数

**文件：`workers/common/embedding/__init__.py`**

新增工厂函数：

```python
import os

def create_embedding_backend(
    *,
    output_dimension: int | None = None,
) -> EmbeddingBackend:
    """
    Create embedding backend based on EMBEDDING_BACKEND env var.
    - "gemini" (default): uses Gemini Embedding 2 API
    - "openai_compatible": uses any OpenAI-compatible /v1/embeddings endpoint
    """
    backend_type = os.getenv("EMBEDDING_BACKEND", "gemini").strip().lower()

    if backend_type == "openai_compatible":
        from .openai_compatible import OpenAICompatibleEmbeddingBackend
        return OpenAICompatibleEmbeddingBackend(
            output_dimension=output_dimension,
        )

    # Default: Gemini
    from .gemini import GeminiEmbeddingBackend
    dim = int(output_dimension or os.getenv("EMBEDDING_DIMENSION", "3072"))
    return GeminiEmbeddingBackend(output_dimension=dim)
```

---

## 5. 替换硬编码的 GeminiEmbeddingBackend

在以下文件中，把直接 `import GeminiEmbeddingBackend` 并实例化的地方，改成用 `create_embedding_backend()`：

**文件列表：**

- `workers/common/embedding/__init__.py` — `create_embedding_backend()` 的工厂入口
- `api/src/services/embedding.ts` — API 侧 embedding client 的 provider 分派
- `workers/unified/pipeline.py` — UnifiedIndexingPipeline.__init__ 中的 `GeminiEmbeddingBackend(output_dimension=...)`
- `workers/knowledge/pipeline.py` — KnowledgeIndexingPipeline 中创建 embedding backend 的地方

**改法示例：**

```python
# Before:
from backend.app.embedding.gemini import GeminiEmbeddingBackend
self._embedding_backend = embedding_backend or GeminiEmbeddingBackend(
    output_dimension=DEFAULT_UNIFIED_EMBEDDING_DIMENSION
)

# After:
from backend.app.embedding import create_embedding_backend
self._embedding_backend = embedding_backend or create_embedding_backend(
    output_dimension=DEFAULT_UNIFIED_EMBEDDING_DIMENSION,
)
```

注意：维度现在也可以通过 `EMBEDDING_DIMENSION` 环境变量控制，不再硬编码 3072。

**搜索所有文件中的 `GeminiEmbeddingBackend(` 实例化调用，全部替换为 `create_embedding_backend(`。** 但保留 `GeminiEmbeddingBackend` 类定义本身不动。

---

## 6. 维度配置

**文件：`config/base.yaml`**

当前 embedding dimension 在 yaml 里：

```yaml
embedding:
  dimension: 768  # 这个值可能被代码覆盖了
```

确保代码中读取维度的优先级是：
1. `EMBEDDING_DIMENSION` 环境变量（最高优先）
2. `config/base.yaml` 中的配置
3. 默认值（gemini=3072, openai_compatible=2048）

---

## 7. 数据库维度兼容

**不改数据库 schema。** 当前 `VECTOR(3072)` 保持不变。

未来切换到 Qwen（2048D）时需要：
1. 修改 migration 的维度
2. 重新索引所有视频

这不在本次实现范围内。

---

## 8. 测试

### 新增测试

**文件：`workers/tests/test_openai_compatible_embedding.py`**（新建）

```python
def test_create_embedding_backend_default_is_gemini():
    """不设 EMBEDDING_BACKEND 时默认返回 Gemini"""
    backend = create_embedding_backend()
    assert "gemini" in backend.name.lower()

def test_create_embedding_backend_openai_compatible():
    """设 EMBEDDING_BACKEND=openai_compatible 时返回 OpenAI compatible"""
    os.environ["EMBEDDING_BACKEND"] = "openai_compatible"
    os.environ["EMBEDDING_OPENAI_BASE_URL"] = "http://localhost:9999/v1"
    backend = create_embedding_backend()
    assert "openai_compatible" in backend.name
    # cleanup
    del os.environ["EMBEDDING_BACKEND"]
    del os.environ["EMBEDDING_OPENAI_BASE_URL"]

def test_openai_compatible_dimension():
    """OpenAI compatible backend 使用配置的维度"""
    os.environ["EMBEDDING_BACKEND"] = "openai_compatible"
    os.environ["EMBEDDING_OPENAI_BASE_URL"] = "http://localhost:9999/v1"
    os.environ["EMBEDDING_DIMENSION"] = "2048"
    backend = create_embedding_backend()
    assert backend.dimension() == 2048
    # cleanup
```

### 回归测试

- `pytest workers/tests -q` 全部通过
- `npm --prefix api run check` 全部通过
- 启动服务（`./rebuild.sh --fast`），搜索功能正常（默认仍用 Gemini）

---

## 不改什么

- 不改默认行为（默认仍是 Gemini）
- 不改数据库 schema
- 不重新索引
- 不改前端
- 不部署 Qwen 服务（那是外部的事）

---

## GPU 服务器部署 Qwen 参考（备忘）

以后在 GPU 服务器上用 vLLM 一行启动：

```bash
pip install vllm
vllm serve Qwen/Qwen3-VL-Embedding-2B \
  --task embed \
  --port 8080 \
  --dtype float16 \
  --max-model-len 8192
```

暴露的接口完全兼容 OpenAI `/v1/embeddings`，cerul 这边配置：

```bash
EMBEDDING_BACKEND=openai_compatible
EMBEDDING_OPENAI_BASE_URL=http://your-gpu-server:8080/v1
EMBEDDING_OPENAI_MODEL=Qwen/Qwen3-VL-Embedding-2B
EMBEDDING_DIMENSION=2048
```

支持的 GPU：T4 (16GB) 即可，推荐 L4 (24GB)。
