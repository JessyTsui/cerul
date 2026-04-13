# GEO Audit Report: Cerul

**Audit Date:** 2026-04-14
**URL:** https://cerul.ai
**Business Type:** SaaS (Developer API)
**Pages Analyzed:** 8 (Homepage, Pricing, Docs, Search API, Usage API, API Reference, Brand, Terms/Privacy)

---

## Executive Summary

**Overall GEO Score: 38/100 (Critical)**

Cerul has a solid technical foundation with proper SSR, clean heading hierarchy, and comprehensive JSON-LD on the homepage. However, the site is largely invisible to AI systems due to zero third-party brand mentions, missing `llms.txt`, absent structured data on key pages (pricing FAQs, docs breadcrumbs), and no E-E-A-T signals (no author attribution, no team page, no publication dates). The biggest opportunity is in brand authority and AI-specific discoverability — areas where small investments can yield outsized GEO gains.

### Score Breakdown

| Category | Score | Weight | Weighted Score |
|---|---|---|---|
| AI Citability | 55/100 | 25% | 13.75 |
| Brand Authority | 11/100 | 20% | 2.20 |
| Content E-E-A-T | 25/100 | 20% | 5.00 |
| Technical GEO | 52/100 | 15% | 7.80 |
| Schema & Structured Data | 45/100 | 10% | 4.50 |
| Platform Optimization | 18/100 | 10% | 1.80 |
| **Overall GEO Score** | | | **35/100** |

---

## Critical Issues (Fix Immediately)

### 1. No `llms.txt` file
- **Impact:** AI crawlers (Claude, ChatGPT, Perplexity) have no structured entry point to understand your site
- **Location:** Missing from `/public/`
- **Fix:** Create `/public/llms.txt` with site description, key URLs, and API documentation links

### 2. Zero third-party brand mentions
- **Impact:** AI models have no external signals to validate Cerul as a trustworthy entity
- **Platforms checked:** Reddit (0), Hacker News (0), YouTube (0), Medium/Dev.to (0), Wikipedia (0), Product Hunt (0)
- **Fix:** Launch on Product Hunt, submit Show HN, seed developer community discussions

### 3. No E-E-A-T signals (author attribution, team page)
- **Impact:** AI systems cannot assess expertise or authoritativeness behind the content
- **Location:** All pages lack author bylines; no `/about` or `/team` page exists
- **Fix:** Add team/about page with founder credentials; add author attribution to docs

---

## High Priority Issues

### 4. No FAQPage schema on pricing page
- **Impact:** 5 well-structured FAQ items exist visually but are invisible to AI structured data parsers
- **Location:** `app/pricing/page.tsx` — FAQ section with 5 Q&A pairs; FAQ data in `lib/site.ts:187-213`
- **Fix:** Add FAQPage JSON-LD schema wrapping the existing FAQ content

### 5. Missing OpenGraph/Twitter metadata on docs pages
- **Impact:** Docs pages fall back to generic site-level OG tags — poor social sharing and AI crawl context
- **Location:** `app/docs/page.tsx`, `app/docs/search-api/page.tsx`, `app/docs/[slug]/page.tsx`, `app/docs/api-reference/page.tsx`
- **Fix:** Add page-specific `openGraph` and `twitter` objects to each metadata export

### 6. Sitemap missing key pages
- **Impact:** Only 4 URLs in sitemap; missing `/docs/search-api`, `/docs/api-reference`, `/brand`, `/terms`, `/privacy`
- **Location:** `app/sitemap.ts` — only maps homepage, docs index, pricing, and usage-api
- **Fix:** Add all public pages to sitemap with appropriate priorities

### 7. No BreadcrumbList schema on documentation pages
- **Impact:** Visual breadcrumbs exist (`docs/[slug]/page.tsx:71-76`) but AI systems can't parse the navigation hierarchy
- **Fix:** Add BreadcrumbList JSON-LD to all docs pages

### 8. No AI-specific crawler directives in robots.txt
- **Impact:** AI crawlers (GPTBot, ClaudeBot, PerplexityBot) are not explicitly welcomed
- **Location:** `app/robots.ts` — only has generic `User-agent: *`
- **Fix:** Add explicit `User-agent` rules for AI crawlers with `Allow: /`

### 9. Homepage uses raw `<img>` instead of `next/image`
- **Impact:** LCP degradation, missing image optimization, weaker Core Web Vitals signal
- **Location:** `app/page.tsx:227-231`
- **Fix:** Convert to `<Image priority />` from `next/image`

---

## Medium Priority Issues

### 10. No publication dates on content pages
- **Impact:** AI systems can't assess content freshness for time-sensitive citations
- **Location:** All docs pages lack `datePublished` / `dateModified` metadata
- **Fix:** Add `article:published_time` meta tags; include dates in JSON-LD

### 11. Pricing page missing meta description
- **Impact:** AI systems and search engines fall back to generic description
- **Location:** `app/pricing/page.tsx` metadata export
- **Fix:** Add explicit description: "Cerul pricing plans — free tier with 10 daily searches, pay-as-you-go, Pro, and Enterprise options for AI video search API."

### 12. API Reference page missing meta description
- **Impact:** Generic fallback description used instead of page-specific content
- **Location:** `app/docs/api-reference/page.tsx:11-15`
- **Fix:** Add description covering the two endpoints documented

### 13. Docs pages lack TL;DR / summary sections
- **Impact:** AI systems benefit from explicit summaries for extraction and citation
- **Fix:** Add 1-2 sentence summary callouts at top of each documentation page

### 14. Statistics on homepage lack substantiation
- **Impact:** Claims like "99.9% Uptime SLA" and "150ms Avg latency" are not backed by sources
- **Location:** `app/page.tsx:126-131`
- **Fix:** Link to status page for uptime; add context like "based on 30-day rolling average"

### 15. No HowTo schema for tutorial content
- **Impact:** The Quickstart guide (4 steps) is a natural fit for HowTo schema
- **Location:** `app/docs/page.tsx` — Steps 1-4 structure
- **Fix:** Add HowTo JSON-LD with step-by-step markup

---

## Low Priority Issues

### 16. Missing `priority` flag on above-fold images
- **Location:** Brand page, docs pages
- **Fix:** Add `priority` prop to hero/above-fold `<Image>` components

### 17. No related articles / cross-linking in docs
- **Location:** All docs pages
- **Fix:** Add "Related" or "Next Steps" sections at bottom of each guide

### 18. No previous/next pagination on docs
- **Fix:** Add sequential navigation between documentation pages

### 19. Social image version hardcoded
- **Location:** `lib/social-metadata.ts`
- **Fix:** Consider build-time timestamps for automatic cache busting

### 20. Docs pages lack `inLanguage` metadata
- **Fix:** Add `inLanguage: "en"` to page metadata for AI language detection

---

## Category Deep Dives

### AI Citability (55/100)

**Strengths:**
- Clear, quotable one-liner: "Cerul is the video search layer for AI agents — search video by meaning across speech, visuals, and on-screen text"
- Well-structured FAQ with 5 Q&A pairs (natural citation targets)
- API documentation with precise parameter tables and response schemas
- Code examples in 3 languages (cURL, Python, JavaScript)
- Quantified metrics: 99.9% uptime, 150ms latency, 10,000+ videos

**Weaknesses:**
- No TL;DR or "Key Takeaways" blocks on any page
- FAQ content lacks FAQPage schema (invisible to structured data consumers)
- Statistics lack substantiation or source attribution
- No comparison content ("Cerul vs X") that AI systems frequently cite
- Documentation lacks "What is Cerul?" definitional block optimized for AI extraction

**Recommendation:** Add a prominent "What is Cerul?" definitional paragraph on the homepage and docs landing, structured as: definition + key differentiator + use case. This is the #1 pattern AI systems extract for citations.

### Brand Authority (11/100)

**Platform Presence:**

| Platform | Status | Quality |
|---|---|---|
| GitHub | Present | 122 stars, 5 forks, active development, good README |
| PyPI | Present | Published `cerul` Python package |
| Discord | Present | Community server exists |
| Reddit | Absent | Zero mentions |
| YouTube | Absent | Zero content |
| Twitter/X | Unclear | @cerul_hq not confirmed active |
| LinkedIn | Absent | No company page |
| Hacker News | Absent | Zero submissions |
| Wikipedia | Absent | No article |
| Product Hunt | Absent | No launch |
| Dev.to/Medium | Absent | No third-party articles |

**Key Issue:** Brand authority is almost entirely self-published. AI models rely heavily on third-party mentions (Reddit discussions, HN threads, blog posts by others) to build entity confidence. Without these signals, AI systems may not recognize "Cerul" as an authoritative entity worth citing.

### Content E-E-A-T (25/100)

**Experience:** Low — No case studies, no customer stories, no usage demonstrations beyond code examples
**Expertise:** Low — No author bios, no team credentials, no "About Us" page demonstrating domain expertise
**Authoritativeness:** Low — No external citations, no press mentions, no awards or recognitions
**Trustworthiness:** Moderate — Open source code, clear pricing, legal pages present, GitHub transparency

**Critical gap:** The site has zero human faces or names attached to it. AI systems weight author attribution heavily in E-E-A-T scoring.

### Technical GEO (52/100)

**Strengths:**
- Server-side rendering (Next.js SSR) — content accessible to all crawlers
- Clean robots.txt allowing public pages
- Sitemap present with correct format
- No blocking security headers
- Good font optimization (local fonts, no external requests)
- Proper canonical URLs on all pages

**Weaknesses:**
- No `llms.txt` file
- No AI-specific crawler directives
- Raw `<img>` tag on homepage instead of optimized `<Image>`
- Sitemap only covers 4 of 9+ public pages
- No `X-Robots-Tag` headers for fine-grained control
- All sitemap entries share same `lastModified` timestamp (no real freshness signal)

### Schema & Structured Data (45/100)

**Implemented (Homepage only):**
- Organization (with social links)
- WebSite
- SoftwareApplication (with license, repo)
- WebAPI (with documentation link)

**Missing:**
| Schema Type | Where Needed | Impact |
|---|---|---|
| FAQPage | Pricing page | High — 5 ready-to-markup Q&A pairs |
| BreadcrumbList | All docs pages | High — navigation hierarchy exists in UI |
| HowTo | Quickstart guide | Medium — 4-step tutorial is perfect fit |
| Article | Docs pages | Medium — technical content without article markup |
| Product | Pricing page | Low — for plan/pricing structured data |

### Platform Optimization (18/100)

**Google AI Overviews:** Moderate readiness — structured data exists but limited. FAQ schema would significantly improve snippet eligibility.

**ChatGPT/Claude:** Low readiness — no `llms.txt`, no explicit AI crawler welcome, limited third-party training data (no Reddit/HN/blog mentions).

**Perplexity:** Low readiness — Perplexity heavily weights citability and source diversity. Single-source content with no external validation scores poorly.

**Bing Copilot:** Moderate — proper OG tags on homepage, but docs pages lack them.

---

## Quick Wins (Implement This Week)

1. **Create `/public/llms.txt`** — 5 minutes. Immediately signals AI crawler welcome. Include site description, key URLs, API docs link.

2. **Add FAQPage JSON-LD to pricing page** — 15 minutes. 5 Q&A pairs already exist in `lib/site.ts`. Wrap them in FAQPage schema. Unlocks rich results.

3. **Convert homepage `<img>` to `<Image priority />`** — 10 minutes. Direct Core Web Vitals (LCP) improvement.

4. **Add missing pages to sitemap** — 10 minutes. Add `/docs/search-api`, `/docs/api-reference`, `/brand`, `/terms`, `/privacy`.

5. **Add meta descriptions to pricing and API reference pages** — 5 minutes. Fill the two pages currently falling back to generic descriptions.

---

## 30-Day Action Plan

### Week 1: Technical GEO Foundation
- [ ] Create `llms.txt` with comprehensive site description
- [ ] Add AI-specific crawler directives to `robots.txt` (GPTBot, ClaudeBot, PerplexityBot)
- [ ] Fix homepage `<img>` → `<Image priority />`
- [ ] Complete sitemap with all public pages
- [ ] Add missing meta descriptions (pricing, API reference)

### Week 2: Structured Data & Schema
- [ ] Add FAQPage JSON-LD to pricing page
- [ ] Add BreadcrumbList JSON-LD to all docs pages
- [ ] Add HowTo JSON-LD to quickstart guide
- [ ] Add page-specific OpenGraph/Twitter metadata to all docs pages
- [ ] Add `datePublished` and `dateModified` to content pages

### Week 3: Content & E-E-A-T
- [ ] Create `/about` or `/team` page with founder credentials and company story
- [ ] Add author attribution to documentation pages
- [ ] Write "What is Cerul?" definitional block for homepage and docs landing
- [ ] Add TL;DR summaries to each documentation page
- [ ] Substantiate homepage statistics with sources/links

### Week 4: Brand Authority & Distribution
- [ ] Launch on Product Hunt
- [ ] Submit Show HN post to Hacker News
- [ ] Create LinkedIn company page
- [ ] Write 2-3 dev blog posts (Dev.to, Medium, or own blog) about video search use cases
- [ ] Seed discussions in relevant Reddit communities (r/MachineLearning, r/artificial, r/LangChain)
- [ ] Publish a YouTube demo/tutorial of the API

---

## Appendix: Pages Analyzed

| URL | Title | GEO Issues |
|---|---|---|
| https://cerul.ai/ | Cerul | 3 (raw img, stats unsubstantiated, no definitional block) |
| https://cerul.ai/pricing | Pricing \| Cerul | 3 (no FAQPage schema, no meta description, no OG) |
| https://cerul.ai/docs | Documentation \| Cerul | 3 (no JSON-LD, no breadcrumbs, no OG-specific) |
| https://cerul.ai/docs/search-api | Search API \| Cerul | 3 (no JSON-LD, no OG, no TL;DR) |
| https://cerul.ai/docs/api-reference | API Reference \| Cerul | 4 (no JSON-LD, no description, no OG, no TL;DR) |
| https://cerul.ai/docs/usage-api | Usage API \| Cerul | 3 (no JSON-LD, no OG, not in sitemap) |
| https://cerul.ai/brand | Brand & Press Kit \| Cerul | 1 (no JSON-LD) |
| https://cerul.ai/terms | Terms of Service \| Cerul | 1 (no OG) |
| https://cerul.ai/privacy | Privacy Policy \| Cerul | 1 (no OG) |

---

**Methodology:** This audit follows the GEO Audit Framework (geo-seo-claude) with weighted scoring across 6 categories. Scores reflect both on-site optimization and off-site brand signals. External platform presence was verified via web search on 2026-04-14.
