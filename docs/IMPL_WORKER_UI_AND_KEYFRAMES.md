# Implementation: Worker Job 管理界面 + 关键帧截图

> **给 Codex 的实现指令文档**
> 请按顺序逐步实现以下内容，每步完成后跑相关测试确认通过。

---

## 背景

我们即将进入冷启动阶段，计划批量索引几千条视频。当前系统有两个问题需要在大规模跑量之前解决：

1. **Job 管理能力不足**：现在 admin 面板只展示 20 个活跃 job 和 8 个最近完成的 job，看不到失败的 job 列表，也没有手动重试的能力。批量跑视频时必然会有失败（API 超时、网络问题等），需要能在界面上一眼看到哪些失败了、为什么失败、一键重试，而不是去数据库里手动改状态。同时，每个完成的 job 应该显示总耗时，方便我们监控 pipeline 性能和判断优化是否生效。

2. **搜索结果缺少关键帧截图**：目前搜索返回的 `keyframe_url` 实际上是视频封面图（`thumbnail_url`），所有片段都显示同一张图。用户搜到一个视频的某个 20 分钟处的片段，看到的却是视频封面而不是那个时间点的实际画面，这对搜索体验和 agent 集成都不好。我们需要在 pipeline 处理过程中，把每个片段的关键帧截图上传到对象存储（Cloudflare R2），让搜索结果返回真正对应那个时间点的画面。

---

## Part 1: Worker Job 管理界面改进

### 1.1 后端：新增重试 API

**文件：`backend/app/admin/service.py`**

新增函数：

```python
async def retry_job(db, job_id: str) -> dict | None:
    """Reset a failed job to pending so the worker picks it up again."""
    row = await db.fetchrow(
        """
        UPDATE processing_jobs
        SET status = 'pending',
            attempts = 0,
            error_message = NULL,
            locked_by = NULL,
            locked_at = NULL,
            next_retry_at = NULL,
            updated_at = NOW()
        WHERE id = $1::uuid AND status = 'failed'
        RETURNING id
        """,
        job_id,
    )
    return dict(row) if row else None
```

**文件：`backend/app/routers/admin.py`**

新增端点（复用现有 admin 权限校验模式）：

```python
@router.post("/admin/jobs/{job_id}/retry")
async def retry_failed_job(job_id: str, ...):
    result = await retry_job(db, job_id)
    if result is None:
        raise HTTPException(404, "Job not found or not in failed state")
    return {"ok": True, "job_id": job_id}
```

### 1.2 后端：增强 worker/live 返回数据

**文件：`backend/app/admin/models.py`**

- `AdminWorkerJob` 新增字段：`total_duration_ms: int | None = None`
- `AdminWorkerLiveResponse` 新增字段：`failedJobs: list[AdminWorkerJob] = []`

**文件：`backend/app/admin/service.py` → `fetch_worker_live()`**

在现有函数中增加：

1. 查询最近 50 个 failed jobs（按 updated_at DESC）：
```sql
SELECT pj.*, v.title as video_title,
       EXTRACT(EPOCH FROM (pj.completed_at - pj.started_at)) * 1000 AS total_duration_ms
FROM processing_jobs pj
LEFT JOIN videos v ON v.id::text = pj.input_payload->>'video_id'
WHERE pj.status = 'failed'
ORDER BY pj.updated_at DESC
LIMIT 50
```

2. 为每个 failed job 获取 steps（复用现有逻辑）

3. 对 completed jobs 也计算 `total_duration_ms`（同上公式）

4. 将 failed jobs 放入 response 的 `failedJobs` 字段

### 1.3 前端：admin-api.ts

**文件：`frontend/lib/admin-api.ts`**

新增：
```typescript
export async function retryJob(jobId: string): Promise<{ ok: boolean }> {
  const res = await adminFetch(`/admin/jobs/${jobId}/retry`, { method: "POST" });
  if (!res.ok) throw new Error(`Retry failed: ${res.status}`);
  return res.json();
}
```

更新 `AdminWorkerJob` 类型新增 `totalDurationMs?: number`。
更新 `AdminWorkerLive` 类型新增 `failedJobs: AdminWorkerJob[]`。

### 1.4 前端：worker-live-panel.tsx

**文件：`frontend/components/admin/worker-live-panel.tsx`**

改进点：

1. **Completed jobs 显示耗时**：在每个 completed job 卡片上显示 `totalDurationMs` 格式化为 "Xm Ys"

2. **新增 Failed Jobs 区域**（在 Recently Completed 之后）：
   - 标题 "Failed Jobs" + 数量 badge
   - 列表显示每个 failed job：
     - 左侧：title（或 video_id 截断）、error_message 前 80 字符、失败时间（relative）、"attempt X/Y"
     - 右侧：**"Retry" 按钮**（红色/橙色风格）
   - Retry 按钮点击后：
     - 调用 `retryJob(jobId)`
     - 按钮变为 "Retrying..." 禁用状态
     - 下一次 4 秒自动刷新后 job 从 failed 移到 active 区域
   - 可展开显示完整 error 和 step 详情（复用现有展开逻辑）

3. **Queue Summary**：确认 failed 数量已显示（当前 `queue.failed` 已有数据，确认 UI 渲染了）

---

## Part 2: 关键帧截图存储（Cloudflare R2）

### 2.1 环境变量

**文件：`.env.example`**

新增：
```
# Cloudflare R2 (keyframe storage)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=cerul-cdn
R2_PUBLIC_URL=https://cdn.cerul.ai
```

**文件：`backend/app/config/settings.py`**

在 Settings 中新增 R2 配置（从环境变量读取）：
```python
class R2Settings:
    account_id: str = ""
    access_key_id: str = ""
    secret_access_key: str = ""
    bucket_name: str = "cerul-cdn"
    public_url: str = ""
```

### 2.2 帧上传模块

**新建文件：`workers/common/storage.py`**

```python
"""Cloudflare R2 frame uploader using boto3 S3-compatible API."""

import asyncio
import os
from pathlib import Path

DEFAULT_R2_CONCURRENCY = 10

class R2FrameUploader:
    def __init__(self):
        self._account_id = os.getenv("R2_ACCOUNT_ID", "").strip()
        self._access_key_id = os.getenv("R2_ACCESS_KEY_ID", "").strip()
        self._secret_access_key = os.getenv("R2_SECRET_ACCESS_KEY", "").strip()
        self._bucket_name = os.getenv("R2_BUCKET_NAME", "cerul-cdn").strip()
        self._public_url = os.getenv("R2_PUBLIC_URL", "").strip().rstrip("/")
        self._client = None

    def available(self) -> bool:
        return bool(self._account_id and self._access_key_id and self._secret_access_key)

    def _get_client(self):
        if self._client is None:
            import boto3
            self._client = boto3.client(
                "s3",
                endpoint_url=f"https://{self._account_id}.r2.cloudflarestorage.com",
                aws_access_key_id=self._access_key_id,
                aws_secret_access_key=self._secret_access_key,
                region_name="auto",
            )
        return self._client

    def upload_frame_sync(self, video_id: str, frame_index: int, frame_path: Path) -> str:
        """Upload a single frame to R2. Returns public URL."""
        key = f"frames/{video_id}/{frame_index:03d}.jpg"
        client = self._get_client()
        with open(frame_path, "rb") as f:
            client.put_object(
                Bucket=self._bucket_name,
                Key=key,
                Body=f,
                ContentType="image/jpeg",
                CacheControl="public, max-age=31536000",
            )
        return f"{self._public_url}/{key}"

    async def upload_frame(self, video_id: str, frame_index: int, frame_path: Path) -> str:
        return await asyncio.to_thread(self.upload_frame_sync, video_id, frame_index, frame_path)

    async def upload_frames_batch(
        self,
        video_id: str,
        frame_entries: list[tuple[int, Path]],  # [(frame_index, frame_path), ...]
        max_concurrency: int = DEFAULT_R2_CONCURRENCY,
    ) -> dict[int, str]:
        """Upload multiple frames concurrently. Returns {frame_index: url}."""
        if not self.available() or not frame_entries:
            return {}

        semaphore = asyncio.Semaphore(max_concurrency)
        results: dict[int, str] = {}

        async def upload_one(frame_index: int, frame_path: Path):
            async with semaphore:
                url = await self.upload_frame(video_id, frame_index, frame_path)
                results[frame_index] = url

        await asyncio.gather(
            *(upload_one(idx, path) for idx, path in frame_entries),
            return_exceptions=True,
        )
        return results
```

**文件：`workers/requirements.txt`**

新增：`boto3`

### 2.3 Pipeline 集成

**文件：`workers/unified/pipeline.py`**

1. 在 `UnifiedIndexingPipeline.__init__` 中新增：
```python
from workers.common.storage import R2FrameUploader
self._frame_uploader = R2FrameUploader()
```

2. 在 `_build_units_from_knowledge_segments` 方法中，构建 unit 之前，上传帧：

```python
# 收集所有 scene 的第一帧
frame_entries = []  # [(scene_index, Path), ...]
for segment in stored_segments:
    frame_paths = segment.get("frame_paths") or []
    if frame_paths:
        first_frame = Path(str(frame_paths[0]))
        if first_frame.exists():
            frame_entries.append((int(segment["segment_index"]), first_frame))

# 批量上传到 R2
uploaded_urls = {}
if self._frame_uploader.available() and frame_entries:
    video_id = str(stored_video["id"])
    uploaded_urls = await self._frame_uploader.upload_frames_batch(video_id, frame_entries)
```

3. 在构建每个 unit 时，设置 `keyframe_url`：

```python
# speech unit 和 visual unit:
segment_index = int(segment["segment_index"])
keyframe_url = uploaded_urls.get(segment_index) or stored_video.get("thumbnail_url")

# summary unit:
keyframe_url = stored_video.get("thumbnail_url")  # 保持用封面图
```

4. 同样修改 `_build_units_from_visual_scene` 方法（b-roll 路径），用相同逻辑上传帧。

### 2.4 帧选择策略

- **speech unit**：取对应 segment 的 `frame_paths[0]`（该时间段的第一帧 informative frame）
- **visual unit**：取对应 scene 的 `frame_paths[0]`
- **summary unit**：保持用 `thumbnail_url`（视频封面）
- **fallback**：如果 R2 未配置或上传失败，用 `thumbnail_url`

---

## 验证步骤

完成后请依次验证：

1. `pytest backend/tests -q` 全部通过
2. `pytest workers/tests -q` 全部通过
3. 启动本地服务 (`./rebuild.sh --fast`)
4. 访问 admin 页面，确认：
   - Failed Jobs 区域显示失败任务
   - 点击 Retry 按钮后 job 变为 pending
   - Completed jobs 显示耗时
5. 如果配了 R2 环境变量：
   - 索引一个新视频
   - 搜索后确认 `keyframe_url` 是 R2 URL 而非 thumbnail
6. 如果没配 R2：
   - 索引一个新视频
   - 确认 `keyframe_url` fallback 到 `thumbnail_url`，无报错
