# Cerul.ai

Cerul.ai 是一个面向 AI agents 的视频理解搜索 API。

项目当前处于早期搭建阶段，目标是先把公开视频搜索的基础能力跑通，再逐步扩展到更完整的视频理解与检索能力。

## Scope

- `broll`: 用免费素材做低成本的视觉搜索 showcase
- `knowledge`: 面向演讲、播客、发布会等知识类视频的主线搜索能力

## Repo Layout

```text
apps/
  web/        Next.js app
  api/        FastAPI service
core/         Shared Python modules
workers/      Indexing pipelines and job workers
config/       YAML config files
scripts/      Local scripts and bootstrap helpers
training/     Model training experiments
sdk/          Client SDKs
mcp/          MCP server
```

## Status

- 文档骨架已建立
- 目录结构已初始化
- 代码实现尚未开始

## Local Workspace

建议本地按下面的方式组织：

- `~/Cerul/Cerul.ai`: 开源 repo
- `~/Cerul/private`: 私有策略、研究、pitch、历史材料
