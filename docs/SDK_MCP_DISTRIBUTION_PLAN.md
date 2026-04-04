# Cerul SDK / MCP / Distribution Plan

Cerul 目前是纯 REST API（curl / fetch 调用），没有发布任何包。
本文档规划从 REST API 到完整开发者分发体系的所有工作。

---

## 设计决策记录

以下决策已确认，所有实现必须遵守：

| 决策 | 结论 |
|------|------|
| `unit_type` 字段 | **不暴露给用户**，仅内部使用。SDK/MCP/文档中不出现此字段 |
| Index 端点 | **不对外开放**。SDK 和 MCP 不暴露 index 相关方法，仅提供 search + usage |
| 自动重试 | SDK **默认不自动重试**，提供 `retry` 选项让用户可选开启 |
| Node 最低版本 | **18+**（原生 fetch） |
| Python 最低版本 | **3.9+** |
| 发版策略 | **Lockstep release** — 所有包同时发版 |
| MCP 第一版范围 | search（含完整 filters）+ usage。不含图片搜索 |
| SDK 体验层 | 第一版加 `timeout` 配置。其他（分页迭代器、自定义 User-Agent 等）等有用户反馈再加 |
| 前端文档 `unit_type` | 需要从 `frontend/lib/docs.ts` 中删除相关描述 |

---

## 仓库结构

主产品代码全部保留在 `cerul` 这个 repo 中（公开）。SDK 和 MCP 使用独立 public repo；`cerul-search` 暂不单独拆 repo，先在 `cerul` 主仓库内作为可自部署子项目孵化。

```
cerul-ai/                          ← GitHub Organization
  cerul              ← public  | 主仓库：API + workers + db + frontend + docs（全部产品代码）
  cerul-js           ← public  | TypeScript SDK → npm: cerul
  cerul-python       ← public  | Python SDK → PyPI: cerul
  cerul-mcp          ← public  | MCP Server → npm: @cerul/mcp
```

### 仓库迁移步骤

1. 创建 GitHub Organization `cerul-ai`
2. Transfer `JessyTsui/cerul` → `cerul-ai/cerul`（保留 star、fork、issue，旧 URL 自动 301 重定向）
3. 新建 `cerul-js`、`cerul-python`、`cerul-mcp` 三个 public repo
4. 在 `cerul` 主仓库中新增 `cerul-search/` 子目录，作为可自部署 OSS 版本的孵化入口

### 各 repo 职责

| Repo | 可见性 | 内容 |
|------|--------|------|
| `cerul` | public | 主仓库：api/、frontend/、workers/、db/、docs/、OpenAPI spec、README、`cerul-search/` 子项目 |
| `cerul-js` | public | TypeScript SDK 源码、package.json、README |
| `cerul-python` | public | Python SDK 源码、pyproject.toml、README |
| `cerul-mcp` | public | MCP Server 源码、smithery.yaml、README |

---

## 需要发布的包

| 包名 | 注册表 | 来源 repo | 作用 |
|------|--------|-----------|------|
| `cerul-search` | PyPI | cerul（`cerul-search/` 子目录） | 可自部署的视频知识搜索 CLI |
| `cerul` | npm | cerul-js | TypeScript SDK（核心） |
| `cerul` | PyPI | cerul-python | Python SDK（核心） |
| `@cerul/mcp` | npm | cerul-mcp | MCP Server |
| `@cerul/ai-sdk` | npm | cerul-js | Vercel AI SDK tool provider |

发布顺序：`cerul-search` MVP → 核心 SDK（TS + Python 并行）→ MCP Server + AI SDK 集成。

---

## 一、公开 API 契约

在写 SDK 之前，必须先冻结对外暴露的 API 契约。以下是第一版 SDK 覆盖的全部公开接口。

### 1.1 公开端点（第一版）

| 端点 | 说明 |
|------|------|
| `POST /v1/search` | 搜索已索引视频 |
| `GET /v1/usage` | 查看用量和配额 |

Index 端点（POST/GET/DELETE /v1/index）暂不对外，SDK 和 MCP 中不暴露。

### 1.2 SearchRequest

```typescript
{
  query: string                       // 必填，最长 400 字符
  max_results?: number                // 1-50，默认 10
  ranking_mode?: "embedding" | "rerank"  // 默认 "embedding"
  include_answer?: boolean            // 默认 false，消耗 2 credits
  filters?: {
    speaker?: string
    published_after?: string          // YYYY-MM-DD
    min_duration?: number             // 秒
    max_duration?: number             // 秒
    source?: string
  }
}
```

> 注意：`image` 参数（图片搜索）第一版 SDK/MCP 不暴露，后续版本添加。

### 1.3 SearchResponse

```typescript
{
  results: Array<{
    id: string
    score: number                     // 0.0-1.0
    rerank_score?: number | null
    url: string                       // tracking redirect URL
    title: string
    snippet: string
    thumbnail_url?: string | null
    keyframe_url?: string | null
    duration: number                  // 秒
    source: string
    speaker?: string | null
    timestamp_start?: number | null   // 秒
    timestamp_end?: number | null     // 秒
  }>
  answer?: string | null              // 仅 include_answer=true 时返回
  credits_used: number
  credits_remaining: number
  request_id: string                  // req_<24-hex-chars>
}
```

> `unit_type` 不在公开契约中，不出现在 SDK 类型定义里。

### 1.4 UsageResponse

```typescript
{
  tier: string                        // "free" | "pro" | "monthly" | "enterprise"
  period_start: string                // YYYY-MM-DD
  period_end: string                  // YYYY-MM-DD
  credits_limit: number
  credits_used: number
  credits_remaining: number
  rate_limit_per_sec: number
  api_keys_active: number
}
```

### 1.5 错误模型

所有错误返回统一格式：

```typescript
{
  error: {
    code: string                      // 见下表
    message: string
  }
}
```

| HTTP Status | code | SDK 行为 | 可重试 |
|-------------|------|---------|--------|
| 400 | `invalid_request` | 抛 CerulError | 否 |
| 401 | `unauthorized` | 抛 CerulError | 否 |
| 403 | `forbidden` | 抛 CerulError | 否 |
| 404 | `not_found` | 抛 CerulError | 否 |
| 422 | `invalid_request` | 抛 CerulError | 否 |
| 429 | `rate_limited` | 抛 CerulError（若开启 retry 则按 `Retry-After` 头重试） | 是 |
| 500+ | `api_error` | 抛 CerulError（若开启 retry 则指数退避重试） | 是 |

SDK 的 `CerulError` 包含 `status`、`code`、`message`、`requestId` 字段。

---

## 二、TypeScript SDK (`cerul` on npm)

### 2.1 Repo: `cerul-ai/cerul-js`

```
cerul-js/
  src/
    index.ts          # 导出入口
    client.ts         # 工厂函数 + 所有方法
    types.ts          # SearchRequest, SearchResponse, UsageResponse 等
    errors.ts         # CerulError 类
  package.json
  tsconfig.json
  README.md
  LICENSE
```

### 2.2 API 设计

```typescript
import { cerul } from 'cerul'

// 初始化
const client = cerul({ apiKey: 'cerul_sk_...' })
// 或自动读 CERUL_API_KEY 环境变量
const client = cerul()

// 可选配置
const client = cerul({
  apiKey: 'cerul_sk_...',
  baseUrl: 'https://api.cerul.ai',   // 默认值
  timeout: 30_000,                    // 毫秒，默认 30s
  retry: false,                       // 是否自动重试 429/5xx，默认 false
})

// 搜索
const { results, answer, credits_remaining } = await client.search({
  query: 'Sam Altman on AI video tools',
  max_results: 5,
  include_answer: true,
  filters: { speaker: 'Sam Altman' },
})

// 查看用量
const usage = await client.usage()
console.log(`${usage.credits_used}/${usage.credits_limit}`)
```

### 2.3 实现要点

- **零外部依赖** — 使用原生 `fetch`（Node 18+ / Bun / Deno / CF Workers 都内置）
- **工厂函数** 而非 class（tree-shaking 友好）
- **API key 解析优先级**：参数 > `CERUL_API_KEY` 环境变量 > 抛错
- **timeout**：使用 `AbortController` + `setTimeout` 实现
- **retry**：429 读 `Retry-After` 头，5xx 指数退避，最多 3 次
- **类型全导出**：`SearchRequest`, `SearchResponse`, `SearchResult`, `UsageResponse`, `CerulError`
- **User-Agent**：自动设置 `cerul-js/{version}`

### 2.4 package.json

```json
{
  "name": "cerul",
  "version": "0.1.0",
  "description": "Official TypeScript SDK for the Cerul video search API",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "keywords": ["cerul", "video-search", "ai-agent", "api", "mcp", "video"],
  "license": "MIT",
  "engines": { "node": ">=18" },
  "repository": { "type": "git", "url": "https://github.com/cerul-ai/cerul-js" },
  "homepage": "https://cerul.ai",
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

### 2.5 发布流程

```bash
# 一次性准备
npm adduser                          # 注册/登录 npm 账号

# 每次发版
npm run build                        # tsc 编译 src/ → dist/
npm publish --access public          # 上传到 npm

# 后续更新
npm version patch                    # 0.1.0 → 0.1.1
npm publish
git push --tags
```

---

## 三、Python SDK (`cerul` on PyPI)

### 3.1 Repo: `cerul-ai/cerul-python`

```
cerul-python/
  cerul/
    __init__.py       # 导出 Cerul, AsyncCerul, 类型, CerulError
    client.py         # 同步 + 异步客户端
    types.py          # dataclass 定义
    errors.py         # CerulError
  pyproject.toml
  README.md
  LICENSE
```

### 3.2 API 设计

```python
from cerul import Cerul

# 初始化（自动读 CERUL_API_KEY）
client = Cerul()

# 可选配置
client = Cerul(
    api_key="cerul_sk_...",
    base_url="https://api.cerul.ai",  # 默认值
    timeout=30.0,                      # 秒，默认 30
    retry=False,                       # 默认不重试
)

# 搜索
result = client.search(
    query="Sam Altman on AI video tools",
    max_results=5,
    include_answer=True,
    filters={"speaker": "Sam Altman"},
)
for r in result.results:
    print(f"{r.title} (score: {r.score})")

# 异步版本
from cerul import AsyncCerul
async_client = AsyncCerul()
result = await async_client.search(query="...")

# 用量
usage = client.usage()
print(f"{usage.credits_used}/{usage.credits_limit}")
```

### 3.3 实现要点

- **依赖**：`httpx>=0.27`（同步 + 异步统一）
- **两个类**：`Cerul`（同步）、`AsyncCerul`（异步）
- **返回类型**：`dataclass`，不依赖 pydantic
- **Python 3.9+**
- **User-Agent**：自动设置 `cerul-python/{version}`

### 3.4 pyproject.toml

```toml
[project]
name = "cerul"
version = "0.1.0"
description = "Official Python SDK for the Cerul video search API"
requires-python = ">=3.9"
dependencies = ["httpx>=0.27"]
license = "MIT"
readme = "README.md"
keywords = ["cerul", "video-search", "ai-agent", "api"]

[project.urls]
Homepage = "https://cerul.ai"
Documentation = "https://cerul.ai/docs"
Repository = "https://github.com/cerul-ai/cerul-python"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

### 3.5 发布流程

```bash
# 一次性准备
pip install build twine
# 在 pypi.org 注册账号，创建 API token

# 每次发版
python -m build                      # 生成 dist/*.whl + dist/*.tar.gz
twine upload dist/*                  # 上传到 PyPI

# 后续更新：改 pyproject.toml version → build → upload
git tag v0.1.1 && git push --tags
```

---

## 四、MCP Server (`@cerul/mcp`)

### 4.1 Repo: `cerul-ai/cerul-mcp`

```
cerul-mcp/
  src/
    index.ts          # MCP server 入口 + tool 注册
  package.json
  tsconfig.json
  smithery.yaml
  README.md
  LICENSE
```

### 4.2 注册的 Tools（第一版）

| Tool 名 | 对应端点 | 描述 |
|---------|---------|------|
| `cerul_search` | POST /v1/search | 搜索已索引视频的视觉内容、语音、文本 |
| `cerul_usage` | GET /v1/usage | 查看 API 用量和配额 |

第一版仅暴露 search 和 usage。Index 端点不对外开放。

### 4.3 cerul_search Tool Schema

```typescript
server.tool(
  'cerul_search',
  'Search indexed videos for visual content (slides, charts, code), speech, and text. Returns timestamped results with relevance scores and source URLs.',
  {
    query: {
      type: 'string',
      description: 'Natural language search query (max 400 chars)',
    },
    max_results: {
      type: 'number',
      description: 'Maximum number of results to return (1-50, default 5)',
    },
    include_answer: {
      type: 'boolean',
      description: 'Whether to include an AI-generated summary answer (costs 2 credits instead of 1)',
    },
    speaker: {
      type: 'string',
      description: 'Filter results by speaker name',
    },
    published_after: {
      type: 'string',
      description: 'Filter videos published after this date (YYYY-MM-DD)',
    },
    source: {
      type: 'string',
      description: 'Filter by video source (e.g. "youtube")',
    },
  },
  async ({ query, max_results, include_answer, speaker, published_after, source }) => {
    const result = await client.search({
      query,
      max_results: max_results ?? 5,
      include_answer: include_answer ?? false,
      filters: {
        ...(speaker && { speaker }),
        ...(published_after && { published_after }),
        ...(source && { source }),
      },
    })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)
```

### 4.4 package.json

```json
{
  "name": "@cerul/mcp",
  "version": "0.1.0",
  "description": "MCP server for Cerul video search API — search visual content in videos from AI agents",
  "type": "module",
  "main": "./dist/index.js",
  "bin": { "cerul-mcp": "./dist/index.js" },
  "files": ["dist"],
  "license": "MIT",
  "engines": { "node": ">=18" },
  "repository": { "type": "git", "url": "https://github.com/cerul-ai/cerul-mcp" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "cerul": "^0.1.0"
  },
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

### 4.5 用户使用方式

**Claude Code：**
```bash
claude mcp add cerul -- npx @cerul/mcp
# 设置环境变量 CERUL_API_KEY
```

**Cursor / Windsurf / Cline（mcp.json）：**
```json
{
  "mcpServers": {
    "cerul": {
      "command": "npx",
      "args": ["@cerul/mcp"],
      "env": { "CERUL_API_KEY": "cerul_sk_..." }
    }
  }
}
```

### 4.6 分发渠道

发布后注册到以下 MCP 目录：

| 平台 | 操作 |
|------|------|
| [Smithery](https://smithery.ai) | 包中添加 `smithery.yaml`，提交注册 |
| [mcp.so](https://mcp.so) | 提交链接 |
| [glama.ai/mcp](https://glama.ai/mcp) | 提交注册 |
| [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | 提交 PR |

### 4.7 smithery.yaml

```yaml
startCommand:
  type: stdio
  configSchema:
    type: object
    properties:
      cerulApiKey:
        type: string
        description: "Cerul API key (cerul_sk_...)"
    required: ["cerulApiKey"]
  commandFunction:
    |-
    (config) => ({
      command: 'npx',
      args: ['@cerul/mcp'],
      env: { CERUL_API_KEY: config.cerulApiKey }
    })
```

---

## 五、Agent Skills（已有，需更新）

### 5.1 现状

`skills/cerul-api/SKILL.md` 已存在，供 Claude Code / Codex 通过 curl/fetch 直接调用 API。

### 5.2 与 MCP 的关系

| | Skill | MCP Server |
|-|-------|------------|
| 工作原理 | Agent 读文档后自己写 HTTP 请求 | Agent 调用结构化 tool，MCP Server 执行 |
| 优点 | 零安装 | 标准化，所有 MCP 客户端通用 |
| 适用场景 | 快速试用 | 正式集成 |

两者共存不冲突。

### 5.3 更新内容

SDK 发布后更新 SKILL.md：
- 推荐 MCP Server 作为首选集成方式
- 移除 index 相关端点（不对外开放）
- 添加 `pip install cerul` / `npm install cerul` 的 SDK 示例

---

## 六、OpenAPI Spec

### 6.1 位置

```
cerul-ai/cerul/openapi.yaml          # public repo 中
```

### 6.2 覆盖范围（第一版）

仅覆盖公开端点：
- `POST /v1/search`
- `GET /v1/usage`

### 6.3 生成方式

先手写，后续考虑从 Hono zod schema 自动生成。

### 6.4 用途

- cerul.ai/docs 页面嵌入 Scalar 文档
- Agent 平台直接导入作为 tool 定义
- 第三方工具自动生成客户端

---

## 七、Vercel AI SDK 集成 (`@cerul/ai-sdk`)

### 7.1 位置

`@cerul/ai-sdk` 作为 `cerul-js` repo 中的第二个导出发布，或作为独立包。
建议放在 `cerul-js` repo 的 `ai-sdk/` 目录下，共享构建工具。

### 7.2 使用方式

```typescript
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { cerulTools } from '@cerul/ai-sdk'

const result = await generateText({
  model: openai('gpt-4o'),
  tools: cerulTools({ apiKey: 'cerul_sk_...' }),
  prompt: 'Find videos where Sam Altman talks about AGI timeline',
})
```

### 7.3 实现要点

- 依赖 `cerul`（核心 SDK）+ `ai`（Vercel AI SDK，peerDependency）
- 导出 `cerulTools()` 工厂函数，返回包含 `cerul_search` tool 的对象
- tool 的 parameters 用 zod schema 定义（AI SDK 要求）

### 7.4 package.json

```json
{
  "name": "@cerul/ai-sdk",
  "version": "0.1.0",
  "description": "Cerul video search tools for Vercel AI SDK",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "license": "MIT",
  "repository": { "type": "git", "url": "https://github.com/cerul-ai/cerul-js" },
  "dependencies": { "cerul": "^0.1.0", "zod": "^3.0.0" },
  "peerDependencies": { "ai": ">=3.0.0" }
}
```

---

## 八、后续计划（第一版之后）

以下内容明确不在第一版范围内，根据用户反馈按需添加：

| 功能 | 触发条件 |
|------|---------|
| 图片搜索（`image` 参数） | API 端图片搜索稳定后 |
| Index 端点开放 | 产品策略决定对外开放时 |
| 自定义 fetch/httpx client | 用户需要代理或自定义 TLS 时 |
| 分页迭代器 | 有分页场景的公开端点时 |
| 自动 SDK 生成（Stainless 等） | 端点数量 > 10 时考虑 |

---

## 八、发布 Checklist

### 前置：API 契约清理

- [ ] 从 `frontend/lib/docs.ts` 删除 `unit_type` 相关描述
- [ ] 确认 SearchResponse 字段与上方契约一致
- [ ] 确认 index 端点的认证中间件不允许普通用户调用（或从文档中移除）

### cerul-search（主仓库内子项目）

- [ ] 在 `cerul` repo 中创建 `cerul-search/` 子目录
- [ ] 搭建 `pyproject.toml` + CLI 入口，支持 `pip install cerul-search`
- [ ] 优先复用现有 worker / pipeline / embedding / search 逻辑，避免复制实现
- [ ] 选定本地存储方案（v1 计划使用 ChromaDB）
- [ ] 写独立 README，确保普通用户可按文档自行部署
- [ ] 本地跑通：index → search → list / stats 基础流程
- [ ] 验证它作为单独子项目时的目录边界，便于未来按需拆 repo

### TypeScript SDK（`cerul-ai/cerul-js` → npm: `cerul`）

- [ ] 创建 `cerul-ai/cerul-js` public repo
- [ ] 实现 `client.ts`（工厂函数 + search/usage）
- [ ] 实现 `types.ts`（公开契约类型）
- [ ] 实现 `errors.ts`（CerulError，含 status/code/message/requestId）
- [ ] 实现 timeout（AbortController）
- [ ] 实现可选 retry（429 读 Retry-After，5xx 指数退避）
- [ ] 写 README（< 10 行 quickstart）
- [ ] 本地测试（调用真实 API）
- [ ] `npm publish --access public`

### Python SDK（`cerul-ai/cerul-python` → PyPI: `cerul`）

- [ ] 创建 `cerul-ai/cerul-python` public repo
- [ ] 实现 `client.py`（Cerul 同步 + AsyncCerul 异步）
- [ ] 实现 `types.py`（dataclass）
- [ ] 实现 `errors.py`
- [ ] 实现 timeout + 可选 retry
- [ ] 写 README
- [ ] 本地测试
- [ ] `twine upload dist/*`

### MCP Server（`cerul-ai/cerul-mcp` → npm: `@cerul/mcp`）

- [ ] 创建 `cerul-ai/cerul-mcp` public repo
- [ ] 实现 MCP server，注册 cerul_search + cerul_usage 两个 tools
- [ ] cerul_search 覆盖完整 filters（speaker, published_after, source, min/max_duration）
- [ ] 添加 `bin` 入口（`cerul-mcp` 命令）
- [ ] 写 `smithery.yaml`
- [ ] 本地测试（MCP inspector 调试）
- [ ] `npm publish --access public`
- [ ] 注册到 Smithery、mcp.so、glama.ai
- [ ] 提交 PR 到 awesome-mcp-servers

### OpenAPI Spec

- [ ] 在 `cerul-ai/cerul` repo 中手写 `openapi.yaml`
- [ ] 覆盖 POST /v1/search + GET /v1/usage
- [ ] 在 cerul.ai/docs 嵌入 Scalar

### Skill 更新

- [ ] 更新 `skills/cerul-api/SKILL.md`，移除 index 端点，添加 SDK/MCP 信息

### AI SDK 集成（`cerul-ai/cerul-js` → npm: `@cerul/ai-sdk`）

- [ ] 在 `cerul-js` repo 中创建 `ai-sdk/` 目录
- [ ] 实现 `cerulTools()` 工厂函数
- [ ] 用 zod 定义 tool parameters schema
- [ ] 写 README + 使用示例
- [ ] `npm publish --access public`

### 分发注册

- [ ] npm: `cerul`, `@cerul/mcp`, `@cerul/ai-sdk`
- [ ] PyPI: `cerul`
- [ ] Smithery、mcp.so、glama.ai MCP 目录
- [ ] awesome-mcp-servers GitHub PR
- [ ] `cerul-ai/cerul` README 添加所有包的链接

---

## 九、发布工程

### 第一版：手动发布

每个 repo 独立发版，手动执行 build + publish。
版本号 lockstep：所有包保持同一版本号（0.1.0 → 0.1.1 → ...）。

```bash
# TS SDK
cd cerul-js && npm version patch && npm run build && npm publish

# Python SDK
cd cerul-python  # 改 pyproject.toml version
python -m build && twine upload dist/*

# MCP
cd cerul-mcp && npm version patch && npm run build && npm publish

# 所有 repo 打 tag
git tag v0.1.1 && git push --tags
```

### 后续：GitHub Actions 自动发布

当手动发版流程稳定后，为每个 repo 添加 CI：
- 触发条件：push tag `v*`
- 步骤：build → test → publish（npm/PyPI Trusted Publishing）
- changelog 自动生成

### 版本兼容矩阵

| 包 | 支持的 API 版本 | 运行时要求 |
|----|----------------|-----------|
| `cerul` (npm) | v1 | Node 18+, Bun, Deno, CF Workers |
| `cerul` (PyPI) | v1 | Python 3.9+ |
| `@cerul/mcp` | v1 | Node 18+（通过 npx 运行） |

API 增加 v2 时，SDK 发 major version（1.x → 2.x）。

---

## 十、cerul-search — 开源视频知识搜索引擎

### 定位

> Semantic search over video knowledge. Find any moment by what was said, shown, or presented.

`cerul-search` 是 Cerul 主仓库中的一个可自部署子项目，用户可以在本地或自己的机器上部署，对自己的视频做语义搜索。它是 cerul.ai SaaS 的开源轻量版本，承担开源社区获客和品牌积累的角色。

### 仓库策略

当前阶段不单独拆 `cerul-search` repo，而是在 `cerul` 主仓库中以逻辑独立、仓库不独立的方式孵化：

- **代码位置**：放在主仓库顶层子目录 `cerul-search/`
- **工程目标**：做成一个自包含的 Python CLI / 可自部署项目
- **实现策略**：尽量复用现有 Cerul 的 worker、pipeline、embedding 和搜索逻辑，避免过早复制代码
- **品牌策略**：先验证安装体验、README、CLI 可用性，再决定是否未来拆成单独 repo

这样做的原因：

- 现有核心技术已经成熟，先复用主仓库能力更快出 MVP
- 过早拆 repo 会增加同步和维护成本
- 先把产品打磨到能独立传播，再拆 repo 更划算

未来只有在下面条件满足时，再考虑拆出 `cerul-ai/cerul-search`：

- README 和安装体验已经足够自解释，不依赖主仓库其他文档
- 配置、存储、运行方式已经稳定
- 发布节奏开始和主仓库明显不同
- 有明确的社区增长需求，需要把 star、issue、目录收录集中到单独 repo

### 与 SentrySearch 的差异

SentrySearch（2600+ star）做的是纯视觉搜索（dashcam 帧 → embedding），不理解语音。cerul-search 的核心差异是**多模态知识搜索**：视觉 + 语音 + 幻灯片文字。

| 能力 | SentrySearch | cerul-search |
|---|---|---|
| 视觉内容搜索 | 有（核心能力） | 有 |
| 语音/演讲搜索 | **没有** | **有（ASR + transcript embedding）** |
| PPT/幻灯片文字搜索 | 没有 | 有（keyframe 分析） |
| 场景分割 | 固定 30 秒 chunk | **FFmpeg 智能分割（画面变化 + 静音边界）** |
| 返回 transcript | 没有 | **有（带时间戳逐句文本）** |
| Embedding 后端 | Gemini / Qwen3-VL | Gemini Embedding 2（v1），Qwen-VL（v2 计划） |

一句话：SentrySearch 搜"你看到了什么"，cerul-search 搜"他说了什么、讲了什么、展示了什么"。

### CLI 设计

```bash
pip install cerul-search

# 索引视频
cerul-search index video.mp4
cerul-search index ./lectures/
cerul-search index "https://youtube.com/watch?v=..."

# 搜索
cerul-search search "how does attention mechanism work"
cerul-search search "gradient descent explanation" --max-results 5 --show-transcript

# 管理
cerul-search list
cerul-search stats
cerul-search remove video.mp4
cerul-search reset
```

### 搜索结果输出

```
$ cerul-search search "transformer attention explained"

Found 3 results:

[1] Score: 0.847  |  lecture_01.mp4  |  14:32 - 16:45
    "So the key insight of attention is that instead of compressing
     the entire input into a fixed-size vector, we allow the decoder
     to look back at all encoder hidden states..."

[2] Score: 0.791  |  talk_stanford.mp4  |  28:10 - 30:22
    "Multi-head attention lets the model jointly attend to information
     from different representation subspaces..."

[3] Score: 0.734  |  podcast_ep12.mp4  |  45:01 - 46:18
    "The way I think about self-attention is like a lookup table
     where every token gets to ask every other token..."
```

### 索引 Pipeline

```
Input video
  │
  ├── FFmpeg 场景检测 + 静音检测 ──→ 智能分割片段（10-120 秒，每段一个完整话题）
  │
  ├── ASR（可配置）──────────────→ 带时间戳的逐句 transcript
  │
  ├── Keyframe 提取 ────────────→ 每段 1-2 张代表帧
  │
  └── Embedding ────────────────→ 文本向量 + 视觉向量
                                     │
                                     ▼
                               ChromaDB（本地向量存储）
                                     │
                                     ▼
                          文本查询 → embedding → 向量搜索 → 排序返回
```

**1. 场景分割（FFmpeg）**
- `ffmpeg -filter:v "select='gt(scene,0.3)'"` 做视觉场景变化检测
- 结合 `silencedetect` 做语音边界感知
- 产出可变长片段（10-120 秒），每段是一个完整的"知识点"

**2. ASR — 语音转文字**
- 通过环境变量配置，兼容任何 OpenAI `/v1/audio/transcriptions` 接口
- 产出每段的带时间戳 transcript

**3. Keyframe 提取（FFmpeg）**
- 每段提取 1-2 张代表帧
- 用于视觉 embedding 和搜索结果展示

**4. Embedding**
- 文本 embedding：embed 每段的 transcript 文本
- 视觉 embedding：embed keyframe（Gemini Embedding 2 多模态）
- 搜索时按 transcript 相似度 + 视觉相似度加权排序

**5. 存储**
- ChromaDB（本地，零配置）

### 配置方案

所有配置通过环境变量或 `.env` 文件：

```bash
# ── ASR 配置 ───────────────────────────────────────
# 兼容任何 OpenAI Whisper 接口。通过 API_BASE + API_KEY + MODEL 指定。

# Groq（推荐，速度快，有免费额度）
ASR_API_BASE=https://api.groq.com/openai/v1
ASR_API_KEY=gsk_...
ASR_MODEL=whisper-large-v3-turbo

# OpenAI Whisper
# ASR_API_BASE=https://api.openai.com/v1
# ASR_API_KEY=sk-...
# ASR_MODEL=whisper-1

# 本地 whisper（通过 whisper.cpp server 等）
# ASR_API_BASE=http://localhost:8080/v1
# ASR_API_KEY=not-needed
# ASR_MODEL=default

# ── Embedding 配置 ─────────────────────────────────
EMBEDDING_BACKEND=gemini
GEMINI_API_KEY=AIza...

# ── 场景检测配置 ───────────────────────────────────
SCENE_THRESHOLD=0.3          # 场景变化灵敏度（0.0-1.0，越低分段越多）
MIN_SEGMENT_DURATION=10      # 最短片段时长（秒）
MAX_SEGMENT_DURATION=120     # 最长片段时长（秒）
```

#### ASR 兼容性矩阵

| Provider | ASR_API_BASE | Model | 费用 | 速度 |
|---|---|---|---|---|
| Groq | `https://api.groq.com/openai/v1` | `whisper-large-v3-turbo` | 免费额度 / $0.04/hr | 极快 |
| OpenAI | `https://api.openai.com/v1` | `whisper-1` | $0.006/min | 快 |
| Deepgram | `https://api.deepgram.com/v1` | `nova-2` | $0.0043/min | 快 |
| 本地 | `http://localhost:8080/v1` | 任意 | 免费 | 取决于硬件 |

### 项目结构

```
cerul/
  ...
  cerul-search/
    README.md
    pyproject.toml             # 包配置（pip / uv 可安装）
    cerul_search/
      __init__.py
      cli.py                   # Click CLI 入口
      indexer/
        pipeline.py            # 编排：分割 → ASR → embedding → 存储
        scene_detect.py        # FFmpeg 场景 + 静音检测
        asr.py                 # OpenAI 兼容 ASR 客户端
        keyframe.py            # FFmpeg keyframe 提取
      embedding/
        gemini.py              # Gemini Embedding 2 客户端
        base.py                # 抽象 embedding 接口（为 v2 后端预留）
      search/
        engine.py              # 查询 → embed → 向量搜索 → 排序
      storage/
        chromadb.py            # ChromaDB 封装
      config.py                # 环境变量加载
    tests/
```

实现上优先复用主仓库已有能力，尤其是：

- `workers/common/` 中的共享 pipeline 抽象和 runtime helpers
- 已有的 embedding backend 抽象
- 已有的视频切分、索引、检索经验和测试用例模式

但 `cerul-search/` 自己需要保持完整的安装、运行、README 和 CLI 入口，确保它以后即使拆 repo 也能平滑迁移。

### Phase 2（v2 计划）

- **Qwen-VL embedding 后端**：本地替代 Gemini，消费级 GPU 可运行
  - 包含部署指南（Docker + CUDA）
  - 支持 Apple Silicon（Metal）加速
- **批量索引**：大型视频库的并行处理
- **增量索引**：添加新视频不需要重建整个索引
- **导出**：搜索结果导出为裁剪后的视频片段（FFmpeg）

### 与 cerul.ai SaaS 的关系

| | cerul-search | cerul.ai |
|---|---|---|
| 部署 | 自托管 | 云端 API |
| 内容 | 用户自己的视频 | 预索引的公开知识视频 |
| 规模 | 单机 | 分布式 |
| 费用 | 免费（+ ASR/embedding API 费用） | Credit 计费 |
| 维护 | 用户自行管理 | 我们管理 |

用户转化漏斗：
1. 开发者在 GitHub 发现 cerul-search → star
2. 索引自己的视频，体验搜索质量
3. 需要搜索公开知识内容（演讲、教程等）
4. 发现 cerul.ai 已预索引 → 注册 API

### 发布优先级

```
Phase 1: 在 `cerul` 主仓库内孵化 cerul-search MVP（CLI + Gemini + Groq ASR）
Phase 2: cerul-js + cerul-python SDK
Phase 3: cerul-mcp MCP Server
Phase 4: cerul-search v2（Qwen-VL 本地后端）
Phase 5: 视社区增长情况决定是否拆分为独立 `cerul-search` repo
```

`cerul-search` 仍然优先于 SDK 发布，因为它是获取开源社区关注的主力。区别只是当前阶段不急着拆独立 repo，而是先在主仓库中把产品和分发体验打磨成熟。SDK 面向的是已经决定用 cerul.ai API 的开发者，转化路径更短但受众更窄。
