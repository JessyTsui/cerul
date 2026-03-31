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

SDK 和 MCP 使用独立 public repo，主产品代码在 private repo 中。

```
cerul-ai/                          ← GitHub Organization
  cerul              ← public  | 产品首页：README、OpenAPI spec、示例、changelog、issue tracker
  cerul-api          ← private | API + workers + db + frontend（核心业务代码）
  cerul-js           ← public  | TypeScript SDK → npm: cerul
  cerul-python       ← public  | Python SDK → PyPI: cerul
  cerul-mcp          ← public  | MCP Server → npm: @cerul/mcp
```

### 仓库迁移步骤

1. 创建 GitHub Organization `cerul-ai`
2. Transfer `JessyTsui/cerul` → `cerul-ai/cerul`（保留 star、fork、issue，旧 URL 自动 301 重定向）
3. 将 `cerul-ai/cerul` 设为 private，或拆分为 public 首页 + private `cerul-api`
4. 新建 `cerul-js`、`cerul-python`、`cerul-mcp` 三个 public repo

### 各 repo 职责

| Repo | 可见性 | 内容 |
|------|--------|------|
| `cerul` | public | README（产品介绍 + SDK/MCP 链接）、OpenAPI spec、示例代码、changelog、issue tracker |
| `cerul-api` | private | api/、frontend/、workers/、db/、skills/、config/ |
| `cerul-js` | public | TypeScript SDK 源码、package.json、README |
| `cerul-python` | public | Python SDK 源码、pyproject.toml、README |
| `cerul-mcp` | public | MCP Server 源码、smithery.yaml、README |

---

## 需要发布的包

| 包名 | 注册表 | 来源 repo | 作用 |
|------|--------|-----------|------|
| `cerul` | npm | cerul-js | TypeScript SDK（核心） |
| `cerul` | PyPI | cerul-python | Python SDK（核心） |
| `@cerul/mcp` | npm | cerul-mcp | MCP Server |
| `@cerul/ai-sdk` | npm | cerul-js | Vercel AI SDK tool provider |

发布顺序：核心 SDK（TS + Python 并行）→ MCP Server + AI SDK 集成。

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
