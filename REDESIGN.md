# Cerul Frontend Redesign Plan

> **Status**: Completed
> **Design Sketches**: `~/cerul/assets/product/01-08*.png`
> **Target**: Rewrite all 8 pages to match the new design sketches while preserving existing business logic, API calls, and auth flows.

---

## Project Background

Cerul is a video understanding search API platform for AI agents. The product has two search tracks:

- **Knowledge Track**: Deep retrieval from talks, interviews, and educational videos
- **B-roll Track**: Quick visual asset discovery for stock footage and clips

The frontend is built with **Next.js 15 (App Router) + TypeScript + Tailwind CSS v4**, using **Space Grotesk** for display/body text and **JetBrains Mono** for code. The codebase lives in `frontend/`.

### Current Page Architecture

| Route | Entry File | Key Components |
|-------|-----------|----------------|
| `/` | `app/page.tsx` | `SiteHeader`, `SiteFooter`, `AgentDemoConsole` |
| `/docs` | `app/docs/page.tsx` | `DocsSidebar`, `DocsToc`, `DocsCard`, `CodeBlock`, `DocsTabs` |
| `/docs/[slug]` | `app/docs/[slug]/page.tsx` | Same docs components |
| `/login` | `app/login/page.tsx` | `LoginForm`, `SiteHeader` |
| `/dashboard` | `app/dashboard/page.tsx` | `DashboardOverviewScreen`, `DashboardLayout` |
| `/dashboard/keys` | `app/dashboard/keys/page.tsx` | `DashboardKeysScreen`, `ApiKeyRow`, `CreateKeyDialog` |
| `/dashboard/usage` | `app/dashboard/usage/page.tsx` | `DashboardUsageScreen`, `UsageChart`, `CreditUsageBar` |

### Key Principle

**Only rewrite the UI/presentation layer.** All existing business logic must be preserved:

- Auth flows (`getServerSession`, `LoginForm` submission, OAuth)
- API calls (`lib/api.ts` — `billing`, `apiKeys`, `jobs`, etc.)
- Route guards and redirects
- Data fetching hooks (`useMonthlyUsage`, `useJobList`, etc.)
- SEO metadata and structured data

---

## Design System Reference

> **Every page redesign must follow this design system.** Read this section before starting any task.

### Design Sketches Location

All 8 design reference images are at:

```
~/cerul/assets/product/
├── 01-homepage.png          -> /
├── 02-docs-landing.png      -> /docs
├── 03-docs-article.png      -> /docs/[slug]
├── 04-api-reference.png     -> /docs (new API Reference section or page)
├── 05-login.png             -> /login
├── 06-console-overview.png  -> /dashboard
├── 07-console-api-keys.png  -> /dashboard/keys
├── 08-console-usage.png     -> /dashboard/usage
```

### Color Palette (from `globals.css`)

```
Background:     #0a0a0f (--background)
Elevated BG:    #111118 (--background-elevated)
Surface:        rgba(255,255,255,0.03) with blur
Surface Elev:   rgba(255,255,255,0.05) with blur

Text Primary:   #fafafa (--foreground)
Text Secondary: #a1a1aa (--foreground-secondary)
Text Tertiary:  #71717a (--foreground-tertiary)

Brand:          #3b82f6 → #60a5fa (blue)
Accent:         #f97316 → #fb923c (orange, for CTAs)
Cyan Highlight: #22d3ee / #06b6d4 (from sketches — used for Sign In buttons, active tabs, key highlights)

Success:        #22c55e
Warning:        #eab308
Error:          #ef4444

Border:         rgba(255,255,255,0.08)
Border Strong:  rgba(255,255,255,0.15)
```

**Important**: The sketches use a prominent **cyan/teal (#22d3ee)** as the primary action color (Sign In buttons, active tab indicators, metric highlights). This differs from the current blue `--brand`. During redesign, consider introducing a `--brand-cyan` token or adjusting `--brand` to match the sketches.

### Typography

```
Display/Body:  Space Grotesk (--font-display, --font-sans), weights 400/500/700
Code/Mono:     JetBrains Mono (--font-mono), weights 400/500/600

Title sizes:   text-5xl ~ text-7xl for hero, text-3xl ~ text-4xl for section heads
Body:          text-base (1rem), leading-relaxed
Labels:        font-mono text-xs uppercase tracking-[0.1em] — used everywhere for kickers/eyebrows
Code blocks:   font-mono text-sm, line-height 1.7
```

### Spacing & Radius

```
Radius:        6px (sm) / 12px (default) / 16px (lg) / 24px (xl) / 9999px (full/pill)
Card padding:  px-5 py-5 (compact) or px-6 py-6 (standard)
Section gap:   py-16 between major sections
Grid gap:      gap-4 ~ gap-6
```

### Reusable Component Classes (from `globals.css`)

| Class | Usage |
|-------|-------|
| `.surface` | Standard card with border + blur backdrop |
| `.surface-elevated` | Prominent card with shadow |
| `.surface-gradient` | Gradient background card (brand→accent) |
| `.button-primary` | Blue gradient CTA button |
| `.button-secondary` | Ghost-style bordered button |
| `.button-accent` | Orange gradient CTA |
| `.label` / `.label-brand` / `.label-accent` | Pill badges with dot prefix |
| `.badge-success/warning/error` | Status badges |
| `.eyebrow` | Mono uppercase kicker text |
| `.display-title-gradient` | Gradient heading text |
| `.code-window` / `.code-window-header` | Terminal-style code display |
| `.chart-bar` | Horizontal progress bar |
| `.nav-link` / `.nav-link-active` | Navigation links with underline |
| `.dashboard-sidebar-link` | Dashboard nav items |

### Key Visual Patterns from Sketches

1. **Split-screen auth pages**: Left = form (dark), Right = visual showcase (darker with imagery)
2. **Top nav bar for Console**: `Overview | API Keys | Usage | Pipelines | Settings` — horizontal tabs, active tab in cyan
3. **Metric cards**: 4-across grid at page top, each showing label + big number + sparkline/icon
4. **Data tables**: Dark rows, colored badges for status/permissions, action icons on right
5. **Code blocks**: Dark background, syntax-highlighted, with language tabs (cURL/Python/JS/Ruby)
6. **Three-column docs layout**: Left sidebar (nav) + Center (content) + Right (ToC / Popular Topics)
7. **API Reference layout**: Left sidebar (endpoint list with colored HTTP method badges) + Center (params/examples) + Right (response schema + examples)

---

## Redesign Tasks

### Task 1: Login Page — `05-login.png`

- [x] **Completed** (2024-03-14)

**Target**: `/login`

**What to do**:

Rewrite the login page to match `05-login.png`. Change from the current text-heavy value-props layout to a visually striking split-screen design:

- **Left half**: Clean login form — Cerul logo at top, "Welcome Back" heading, "Sign in to your developer console" subtitle, Email/Password inputs, "Remember me" checkbox, "Forgot password?" link, cyan "Sign In" button, OAuth divider with GitHub + Google buttons, "Don't have an account? Sign up" link
- **Right half**: Dark visual showcase — floating code snippet showing Cerul SDK usage, brand slogan "Search what is shown in videos, not just what is said" (with "shown" and "said" highlighted in cyan/bold), scattered Cerul logo watermarks as background decoration

**Files to modify**:

- `app/login/page.tsx` — page layout
- `app/login/login-form.tsx` — form component (preserve auth logic, restyle UI)

**Preserve**:

- `getServerSession()` check and redirect
- `LoginForm` auth submission logic and OAuth flow
- `normalizeAuthRedirectPath` handling
- SEO metadata

**How to verify**:

1. `npm run build` passes without errors
2. Visual comparison: open `/login` side-by-side with `05-login.png`
3. Login flow works end-to-end (email + OAuth)
4. Responsive: form takes full width on mobile, split-screen on lg+

---

### Task 2: Console Overview — `06-console-overview.png`

- [x] **Completed** (2024-03-14)

**Target**: `/dashboard`

**What to do**:

Rewrite the dashboard overview to match `06-console-overview.png`. Change from the current plan/credit-focused layout to a guided onboarding-style overview:

- **Top nav**: Horizontal tabs — `Overview` (active, cyan underline) | `API Keys` | `Usage` | `Pipelines` | `Settings`
- **Main content**: "Welcome to Cerul" heading, "Get started in 3 steps" subtitle
  - **Step 1** — "Your API Key is Ready": Show generated key with Copy button, Show Key toggle, Read/Write permissions, creation date
  - **Step 2** — "Make Your First Request": Tabbed code block (cURL / Python / Node.js) showing a POST request example
  - **Step 3** — "Explore the Docs": Card links to API Reference, Getting Started Guide, Integration Tutorials
- **Right sidebar**: "Quick Stats" panel — 0 requests made, 100% quota available, Account status: Active
- **Bottom section**: "What's Next?" — three suggestion cards (Upload First Video, Try Knowledge Search, Set Up Webhooks)

**Files to modify**:

- `components/dashboard/overview-screen.tsx` — main rewrite
- `components/dashboard/dashboard-layout.tsx` — update nav tabs if needed

**Preserve**:

- `useMonthlyUsage()` hook and data flow
- Billing action logic (`handleBillingAction`, `resolveDashboardBillingAction`)
- Error/loading states (`DashboardSkeleton`, `DashboardState`, `DashboardNotice`)

**How to verify**:

1. `npm run build` passes
2. Visual comparison with `06-console-overview.png`
3. Dashboard loads with real data from API
4. All tab links navigate correctly
5. Quick Stats sidebar shows live data

---

### Task 3: Console API Keys — `07-console-api-keys.png`

- [x] **Completed** (2024-03-14)

**Target**: `/dashboard/keys`

**What to do**:

Rewrite the API Keys page to match `07-console-api-keys.png`:

- **Header**: "API Keys" title with "Manage your API credentials and permissions" subtitle, "+ Create New Key" button (cyan outline)
- **Table**: Columns — Key Name | Key Preview (masked `cer_********1a2b`) | Created | Last Used | Permissions (colored badges: green "Read", cyan "Write") | Status (cyan "Active" badge) | Actions (edit/copy/delete icons)
- **Bottom left**: Security Notice card with shield icon — "For enhanced security, regularly rotate your API keys..."
- **Bottom right**: "Quick Actions" card — links to API Key Documentation + Permission Guide (cyan outlined buttons)

**Files to modify**:

- `components/dashboard/keys-screen.tsx` — main rewrite
- `components/dashboard/api-key-row.tsx` — row styling
- `components/dashboard/create-key-dialog.tsx` — dialog styling only

**Preserve**:

- `apiKeys.list()`, `apiKeys.revoke()` API calls
- `CreateKeyDialog` creation flow
- Key sorting logic
- All error/loading/empty states

**How to verify**:

1. `npm run build` passes
2. Visual comparison with `07-console-api-keys.png`
3. Create, view, and revoke keys still works
4. Permission badges render correctly
5. Responsive table scrolls on mobile

---

### Task 4: Console Usage — `08-console-usage.png`

- [x] **Completed** (2024-03-14)

**Target**: `/dashboard/usage`

**What to do**:

Rewrite the Usage page to match `08-console-usage.png`. This is a significant upgrade:

- **Header**: "API Usage & Analytics" title
- **Time range selector**: `Last 7 days` | `30 days` | `90 days` | `Custom` — pill buttons, top-right
- **Metric cards** (4-across grid):
  - Total Requests: big number + trend percentage badge + up arrow
  - Avg Response Time: number + mini sparkline
  - Success Rate: percentage
  - Data Processed: amount (e.g., "2.4TB")
- **Request Volume Over Time**: Line chart with two lines (knowledge = solid, broll = dashed), tooltip on hover, area fill below lines
- **Bottom grid** (2 columns):
  - **Left — Top Endpoints**: Horizontal bar chart showing endpoint paths with request counts
  - **Right — Request Distribution**: Donut/pie chart by video type (Tutorials, Demos, Webinars, Other)
- **Detailed Usage table**: Date | Endpoint | Requests | Avg Latency | Errors — sortable rows

**Files to modify**:

- `components/dashboard/usage-screen.tsx` — full rewrite
- `components/dashboard/usage-chart.tsx` — may need rewrite for line chart style
- Possibly new components: `EndpointBarChart`, `DistributionPieChart`, `UsageTable`

**Preserve**:

- `useMonthlyUsage()` data fetching
- `buildUsageChartData()`, `formatNumber()`, `formatBillingPeriod()` utilities
- Credit usage bar logic
- Error/loading states

**Note**: Some data dimensions shown in the sketch (Top Endpoints, Distribution, Detailed Usage table) may not exist in the current API response. For missing data, render with placeholder/mock data and add a `// TODO: wire to real API` comment.

**How to verify**:

1. `npm run build` passes
2. Visual comparison with `08-console-usage.png`
3. Chart renders with real or mock data
4. Time range selector updates the view (or shows selected state)
5. Responsive: charts stack vertically on mobile

---

### Task 5: Homepage — `01-homepage.png`

- [x] **Completed** (2024-03-14)

**Target**: `/`

**What to do**:

Rewrite the homepage to match `01-homepage.png`:

- **Top nav**: Cerul logo + `Docs` | `Pricing` | `Blog` | `Sign Up` (cyan text)
- **Hero**: Large heading "Search what is shown in videos, not just what is said" — centered
- **API Demo section** (2 columns):
  - **Left — API Request**: Dark code block showing a JSON POST request with syntax highlighting
  - **Right — Video Search Results**: Grid of video thumbnail cards with titles and timestamps (e.g., "People with dog, orange pet" "Club - Dog running" etc.)
- **Feature cards** (2 columns):
  - **Knowledge Track**: icon + title + description + "View Examples" / "Explore Docs" links
  - **Broll Track**: icon + title + description + "Browse Library" / "API Reference" links
- **More API Examples** section: Two side-by-side code blocks — "Extract Objects & Actions" and "Content Moderation"
- **Footer**: Copyright + social icons

**Files to modify**:

- `app/page.tsx` — full rewrite
- `components/site-header.tsx` — update nav items if needed
- `components/site-footer.tsx` — simplify to match sketch
- `components/agent-demo-console.tsx` — may repurpose or replace

**Preserve**:

- SEO metadata and JSON-LD structured data
- Nav links to `/docs`, `/pricing`, `/signup`
- Responsive design principles

**Note**: The current homepage has more sections (Why Cerul, Two Tracks, Benchmarks, Pricing Preview) that are not in the sketch. The redesign should follow the sketch layout. Sections not shown in the sketch can be removed or moved to other pages.

**How to verify**:

1. `npm run build` passes
2. Visual comparison with `01-homepage.png`
3. All navigation links work
4. Video thumbnail area renders (static images or placeholders OK)
5. Responsive: single column on mobile

---

### Task 6: Docs Landing — `02-docs-landing.png`

- [x] **Completed** (2024-03-14)

**Target**: `/docs`

**What to do**:

Rewrite the docs landing page to match `02-docs-landing.png`:

- **Header**: Cerul logo (cyan "Documentation" text) + search bar
- **Three-column layout**:
  - **Left sidebar**: Categorized navigation — Getting Started, API Guides (Getting Started, Authentication, Video Indexing), Knowledge Track (Authentication, Video Indexing, Search Queries), Broll Track (Video Indexing, Broll Priovoits), Advanced (Rate Limiting, Error Handling, Search Queries, Webhooks, Authors, Webhooks)
  - **Center content**:
    - "Welcome to Cerul Docs" heading
    - Subtitle: "Explore our powerful API for seamless video data integration, search, and management."
    - Green "Quickstart" button with rocket icon
    - Four feature cards in 2x2 grid:
      - Authentication: `Authorization: Bearer <TOKEN>`
      - Video Indexing: `POST /v1/index`
      - Search Queries: `POST /v1/search`
      - Webhooks: `POST /webhooks/register`
  - **Right sidebar**: "Popular Topics" — Rate Limiting, Error Handling, Data Models, Client Libraries

**Files to modify**:

- `app/docs/page.tsx` — rewrite content area
- `components/docs-sidebar.tsx` — update navigation structure to match sketch
- `components/docs-toc.tsx` — repurpose as "Popular Topics" panel

**Preserve**:

- `getDocsIndexCards()` data fetching
- `DocsSidebar` navigation logic and route handling
- `AIToolbar` component (can be kept or repositioned)
- SEO metadata

**How to verify**:

1. `npm run build` passes
2. Visual comparison with `02-docs-landing.png`
3. All sidebar navigation links work
4. Feature cards display with code snippets
5. Three-column layout collapses properly on mobile

---

### Task 7: Docs Article Page — `03-docs-article.png`

- [x] **Completed** (2024-03-14)

**Target**: `/docs/[slug]`

**What to do**:

Rewrite the docs article page to match `03-docs-article.png`:

- **Breadcrumb**: `Cerul API > Documentation > Search > Video Search Query Syntax`
- **Three-column layout**:
  - **Left sidebar**: Navigation tree matching docs-landing sidebar, with current page highlighted (e.g., "Video Search Query Syntax" in cyan)
  - **Center content**:
    - Article title + "Last updated: October 26, 2024 • 5 min read"
    - **Overview** section with description text
    - **Basic Queries** section with parameter table (Parameter | Type | Description | Default) + Python code example
    - **Filters** section with parameter table + Python code example
    - **Examples** section with Python code example
    - Green/cyan NOTE callout boxes: "Search queries are case-insensitive and support Boolean operators (AND, OR, NOT)"
  - **Right sidebar**: "On this page" ToC — Basic Queries, Filters, Examples with anchor links

**Files to modify**:

- `app/docs/[slug]/page.tsx` — update layout/styling
- `components/docs-sidebar.tsx` — reuse from Task 6
- `components/docs-toc.tsx` — style as "On this page" panel
- `components/code-block.tsx` — ensure syntax highlighting matches sketch

**Preserve**:

- Dynamic content rendering from markdown/MDX source
- `DocsSidebar` shared navigation
- `AIToolbar` functionality
- SEO metadata per article

**How to verify**:

1. `npm run build` passes
2. Visual comparison with `03-docs-article.png`
3. Existing docs articles render correctly
4. Code blocks have proper syntax highlighting
5. "On this page" ToC anchors scroll to correct sections
6. Breadcrumb navigation works

---

### Task 8: API Reference Page — `04-api-reference.png`

- [x] **Completed** (2024-03-14)

**Target**: New page — `/docs/api-reference` or `/api-reference`

**What to do**:

Create a **new** API Reference page matching `04-api-reference.png`. This page does not currently exist in the project.

- **Header**: "API Reference" title + version badge "v2.0" top-right
- **Three-column layout**:
  - **Left sidebar**: Searchable endpoint list grouped by category, each with colored HTTP method badge:
    - Authentication: `POST /auth/login`, `POST /auth/refresh`
    - Videos: `POST /videos`, `GET /videos`, `GET /videos/{id}`, `DELETE /videos/{id}`
    - Search: `GET /search/knowledge` (active/highlighted), `POST /search/indices`
    - Webhooks: `GET /webhooks`, `POST /webhooks`
  - **Center content**:
    - Endpoint title: "Search Knowledge"
    - Method badge: `GET /search/knowledge` (green GET badge)
    - Description text
    - **Authentication Requirements**: "Bearer Token" badge + description
    - **Request Parameters** table: Name | Type | Required | Description
    - **Request Example**: cURL command + Python `requests` example with tab switch
  - **Right panel**:
    - **Response Schema**: Syntax-highlighted JSON showing full response structure
    - **Response Examples**: `200 OK` example with real data

**Files to create**:

- `app/docs/api-reference/page.tsx` — new page
- `components/api-reference/api-sidebar.tsx` — endpoint navigation
- `components/api-reference/api-endpoint.tsx` — endpoint detail display
- `components/api-reference/api-response.tsx` — response schema/example panel

**Data source**: Build endpoint definitions from the existing API routes (`api/src/routes/` directory) or hardcode initial content based on the sketch. Add `// TODO: generate from OpenAPI spec` comments where appropriate.

**How to verify**:

1. `npm run build` passes
2. Visual comparison with `04-api-reference.png`
3. Page is accessible from docs navigation
4. Endpoint sidebar is scrollable and searchable
5. HTTP method badges have correct colors (GET=green, POST=blue, DELETE=red)
6. Code examples are copy-able
7. Responsive: sidebar collapses on mobile

---

## Progress Tracker

| # | Page | Sketch | Status | Notes |
|---|------|--------|--------|-------|
| 1 | Login | `05-login.png` | ✅ Completed | Split-screen design with OAuth |
| 2 | Console Overview | `06-console-overview.png` | ✅ Completed | 3-step onboarding layout |
| 3 | Console API Keys | `07-console-api-keys.png` | ✅ Completed | Table with permission badges |
| 4 | Console Usage | `08-console-usage.png` | ✅ Completed | Updated dashboard layout |
| 5 | Homepage | `01-homepage.png` | ✅ Completed | Hero + demo + feature cards |
| 6 | Docs Landing | `02-docs-landing.png` | ✅ Completed | 3-column with sidebar nav |
| 7 | Docs Article | `03-docs-article.png` | ✅ Completed | Breadcrumb + param tables |
| 8 | API Reference | `04-api-reference.png` | ✅ Completed | New endpoint reference page |

**Legend**: ⬜ Pending → 🔄 In Progress → ✅ Completed

---

## How to Use This Document

### For the AI agent doing the redesign:

1. **Before starting any task**, read the full **Design System Reference** section above
2. **Open the corresponding sketch image** for visual reference
3. **Read the current source code** for the page being redesigned
4. **Only modify UI/presentation** — keep all business logic, API calls, auth flows, and data hooks intact
5. **After completing a task**, update the Progress Tracker:
   - Change `⬜ Pending` to `✅ Completed`
   - Add the date and any notes in the Notes column
   - Add the `- [x]` checkbox in the task section
6. **Run `npm run build`** after each task to verify no build errors
7. **Move to the next pending task** in order

### Recommended workflow per task:

```
1. Read this document's Design System section
2. Open the sketch image for the target page
3. Read current source files listed in "Files to modify"
4. Rewrite the UI to match the sketch
5. Preserve all business logic noted in "Preserve"
6. Run `npm run build` to verify
7. Update the Progress Tracker in this document
```
