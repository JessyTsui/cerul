# Cerul Mobile Responsive Audit and Remediation Plan

> Audit date: 2026-04-13
> Scope: `frontend/` public pages, docs pages, dashboard shell, admin shell
> Verification method: code inspection + live mobile rendering in iPhone 14 emulation

## Executive Summary

The statement "mobile adaptation is very poor across pages" is directionally true, but not evenly true for every page.

What is clearly true after verification:

- The docs page family has real mobile layout problems, including severe horizontal overflow.
- Dashboard and admin lose primary navigation on smaller screens.
- The homepage has horizontal overflow on mobile and needs containment fixes.

What is not fully true, or is already stale in the previous version of this document:

- The missing `viewport` export in `frontend/app/layout.tsx` is not proven to be the root cause.
- `DocsSidebar` already has a mobile toggle and should not be treated as "missing mobile navigation".
- The auth shell is not currently a priority mobile breakage based on live rendering.
- `pricing` and `brand` can be improved, but they are not in the same severity class as the docs pages.

The practical goal should be:

1. Fix mobile-only breakages first.
2. Keep all desktop layouts visually unchanged.
3. Avoid broad global CSS band-aids that hide the real overflow sources.

---

## Audit Method

I verified the current state in two ways:

1. Read the actual layout and shell code in `frontend/app` and `frontend/components`.
2. Ran the app locally and captured full-page screenshots in iPhone 14 emulation.

Baseline note:

- In iPhone 14 emulation, a normal page screenshot is roughly `1170px` wide because the device viewport is `390 CSS px` with a device pixel ratio of `3`.
- Pages significantly wider than that are genuinely overflowing horizontally.

Measured results:

| Page | Screenshot width | Result |
| --- | ---: | --- |
| `/login` | 1170 | Normal baseline, no major layout break observed |
| `/pricing` | 1179 | Close to baseline, readable but table UX is dense |
| `/brand` | 1179 | Close to baseline, no major overflow detected |
| `/` | 1602 | Horizontal overflow confirmed |
| `/docs` | 4080 | Severe horizontal overflow confirmed |
| `/docs/api-reference` | 5064 | Severe horizontal overflow confirmed |
| `/docs/search-api` | 4962 | Severe horizontal overflow confirmed |

This means the problem is real, but concentrated in a few important layout systems rather than every page equally.

---

## Verified Findings

### P0 — Real Mobile Breakages

#### 1. Dashboard loses primary navigation on mobile

Evidence:

- `frontend/components/dashboard/dashboard-sidebar.tsx:82`
- The sidebar is `hidden ... lg:block`.
- `frontend/components/dashboard/dashboard-app-shell.tsx` does not render a mobile replacement.
- `frontend/components/dashboard/dashboard-top-nav.tsx` only renders utility actions, not route navigation.

Why this matters:

- On screens below `lg`, users can land inside dashboard pages but cannot reliably move between them.
- This is a true functional break, not just a visual issue.

Required fix:

- Add a dedicated mobile drawer or sheet navigation for dashboard routes.
- Reuse `dashboardRoutes`.
- Mount it in the top bar or app shell for `< lg`.
- Keep the desktop sidebar untouched.

Desktop safety rule:

- New component must be `lg:hidden`.
- Existing sidebar stays exactly as-is with `lg:block`.

---

#### 2. Admin loses primary navigation on mobile and tablet-width screens

Evidence:

- `frontend/components/admin/admin-sidebar.tsx:135`
- The sidebar is `hidden ... xl:block`.
- `frontend/components/admin/admin-app-shell.tsx` has no mobile fallback.
- `frontend/components/admin/admin-top-bar.tsx` renders utility actions only.

Why this matters:

- This is even more restrictive than dashboard because the admin sidebar disappears below `xl`, not just below `lg`.
- iPad-sized layouts are affected too.

Required fix:

- Add `admin-mobile-nav.tsx` using the same route config as the desktop sidebar.
- Mount it in the admin top bar for `< xl`.

Desktop safety rule:

- Mobile nav only appears under `xl:hidden`.
- Existing `xl:block` sidebar stays intact.

---

#### 3. Docs layout family has severe horizontal overflow on mobile

Evidence:

- Live rendering confirms major overflow on:
  - `/docs`
  - `/docs/api-reference`
  - `/docs/search-api`
- Shared desktop-style layout patterns still present in:
  - `frontend/app/docs/page.tsx:39`
  - `frontend/app/docs/api-reference/page.tsx:57`
  - `frontend/app/docs/search-api/page.tsx:123`
- `DocsToc` is always rendered as a sticky card:
  - `frontend/components/docs-toc.tsx:64`

Why this matters:

- This is the clearest proof that the current docs mobile experience is genuinely broken.
- The issue is systemic to the docs layout family, not isolated to one page.

Likely contributing causes:

- Three-column desktop composition collapses visually, but some inner blocks still behave like desktop content.
- Sticky TOC and wide content blocks remain in the flow without a dedicated mobile presentation.
- Code blocks and tables are contained locally with `overflow-x-auto`, but the surrounding page-level composition still leaks width.

Required fix:

- Treat docs as a layout-system fix, not as isolated page tweaks.
- Add a dedicated mobile docs pattern:
  - mobile docs navigation trigger
  - mobile TOC trigger or collapsible section
  - mobile-safe content wrappers around code and tables

Desktop safety rule:

- Preserve existing `lg:grid-cols[...]` layouts for desktop.
- Add mobile-only wrappers or alternatives rather than rewriting the desktop structure.

---

#### 4. API Reference page has no real mobile nav replacement

Evidence:

- `frontend/app/docs/api-reference/page.tsx:58`
- The left nav is an inline `aside`, not the shared `DocsSidebar`.
- Unlike `DocsSidebar`, this page has no mobile toggle.

Why this matters:

- Even if general docs navigation is improved, this page still has its own unique mobile blocker.
- It should not be grouped together with the "DocsSidebar is missing" claim, because that claim is stale.

Required fix:

- Extract the API reference sidebar into a reusable component with:
  - desktop sticky sidebar
  - mobile collapsible panel or drawer

Desktop safety rule:

- Desktop API reference sidebar remains the default on `lg` and above.

---

### P1 — Important UX and Layout Problems

#### 5. Homepage still overflows horizontally on mobile

Evidence:

- Live rendering of `/` produced a width of `1602px`, above the mobile baseline.
- The demo block and its surrounding animated/visual wrappers are the most likely overflow candidates:
  - `frontend/app/page.tsx:178`
  - `frontend/app/page.tsx:193`
  - `frontend/components/animations.tsx:51-77`

Why this matters:

- This affects the first public page users see.
- Even moderate overflow makes the page feel unstable on phones.

Likely contributing causes:

- Wide demo content inside a two-column marketing section.
- Animated wrappers using `transform` before visibility settles.
- Decorative visual layers making the page canvas wider than intended.

Required fix:

- Audit homepage sections for `min-w-0`, `max-w-full`, and overflow containment.
- Constrain code/demo containers explicitly on small screens.
- If needed, reduce only mobile spacing and chip density.

Desktop safety rule:

- Do not change `lg:grid-cols-2`.
- Apply containment and spacing fixes only below `lg`.

---

#### 6. Docs TOC and docs tabs are not truly mobile-friendly

Evidence:

- `DocsToc` is always rendered on docs pages:
  - `frontend/app/docs/page.tsx:312`
  - `frontend/app/docs/api-reference/page.tsx:345`
  - `frontend/app/docs/search-api/page.tsx:564`
- `frontend/components/docs-header.tsx:118-126` uses horizontally scrollable tabs with `whitespace-nowrap`.

What is true here:

- The docs header tabs are not missing a mobile state; they do scroll.
- But the current experience is still rough on mobile:
  - tab labels can truncate visually
  - scroll affordance is weak
  - TOC is not transformed into a mobile-first pattern

Required fix:

- Keep horizontal tab scroll, but add visual affordance such as fade edges or a stronger active-state cue.
- Hide the sticky TOC card below `lg`.
- Replace it with an inline collapsible "On this page" section or a floating button that opens a sheet.

Desktop safety rule:

- Desktop sticky TOC remains unchanged on `lg+`.
- Mobile gets a separate rendering path.

---

#### 7. Full-width data tables in docs should not rely on raw horizontal scroll alone

Evidence:

- Pricing comparison table:
  - `frontend/app/pricing/page.tsx:161-163`
- API reference parameter table:
  - `frontend/app/docs/api-reference/page.tsx` parameter tables in the main content
- Search API page error/code tables:
  - `frontend/app/docs/search-api/page.tsx:514+`

What is true here:

- `overflow-x-auto` prevents the layout from fully collapsing in some places.
- But on mobile, that is still a weak UX for dense structured data.

Required fix:

- Keep tables on desktop.
- Introduce card or definition-list renderers on mobile for the densest tables.
- Use horizontal scroll only as a fallback, not as the primary mobile design.

Desktop safety rule:

- Use `hidden lg:block` and `lg:hidden` pairings rather than altering the existing desktop tables.

---

### P2 — Secondary Issues Worth Fixing

#### 8. Dashboard top nav hides current page context on mobile

Evidence:

- `frontend/components/dashboard/dashboard-top-nav.tsx:23`
- Breadcrumb area is `hidden md:flex`.

Impact:

- Users on phones lose page context even after navigation is fixed.

Recommended fix:

- Show the active page label next to the mobile menu button on `< md`.

---

#### 9. Public site header hides GitHub on mobile

Evidence:

- `frontend/components/site-header.tsx:47-57`
- GitHub action is `hidden ... lg:inline-flex`.

Impact:

- This is not a structural break, but it removes an important public action on small screens.

Recommended fix:

- Add a compact icon-only GitHub action for mobile.
- Or include GitHub as an item in the mobile nav/action row.

---

#### 10. Animation-first rendering can worsen perceived mobile instability

Evidence:

- `frontend/components/animations.tsx:29-77`
- `FadeIn` and `BlurFade` start from invisible/transformed states.

Impact:

- On slower devices or certain rendering conditions, the page can feel blank or delayed before content settles.
- This amplifies the perception that the mobile layout is broken.

Recommended fix:

- Reduce or simplify reveal effects below `md`.
- Prefer immediate rendering for key content blocks on mobile.
- Keep richer motion on larger screens.

Desktop safety rule:

- Motion reductions should be scoped to small screens or reduced-motion preferences only.

---

## Findings That Are Stale or Not Substantiated

These points from the previous document should not be carried forward as confirmed root causes.

### A. Missing `viewport` export is not proven to be the main issue

Evidence:

- `frontend/app/layout.tsx` does not export `viewport`.
- But multiple pages still render at the expected mobile baseline.

Conclusion:

- This may be worth revisiting later, but current evidence does not support classifying it as a P0 root cause.
- Do not anchor the remediation plan on this item.

---

### B. `DocsSidebar` is not missing mobile navigation

Evidence:

- `frontend/components/docs-sidebar.tsx:20-33`
- There is already a mobile toggle button and conditional mobile panel.

Conclusion:

- The broader docs mobile experience is still poor.
- But the old claim "docs sidebar is missing on mobile" is factually outdated.

---

### C. Auth shell is not currently a top-priority mobile layout issue

Evidence:

- Live mobile rendering for `/login` was normal.
- `frontend/components/auth/auth-shell.tsx:17-18` uses the large split layout only under `lg`.
- The form column remains `w-full max-w-[460px]` with mobile padding.

Conclusion:

- Keep it on the watch list, but do not treat it as a first-wave fix.

---

## Safe Optimization Principles

To avoid any desktop regressions, all remediation should follow these rules.

### 1. Never "fix" mobile by weakening desktop classes

Good:

- Add `lg:hidden` mobile alternatives
- Add `hidden lg:block` desktop preservation
- Add `min-w-0`, `max-w-full`, `overflow-x-auto` to mobile-sensitive containers

Bad:

- Removing existing desktop grid definitions
- Changing desktop widths just to make mobile work
- Replacing a three-column desktop layout with one shared compromise layout

### 2. Avoid `body { overflow-x: hidden; }` as the primary solution

Reason:

- It hides symptoms.
- It makes debugging much harder.
- It can clip drawers, shadows, and fixed overlays.

Allowed use:

- Only as a last-step containment guard after the real overflow source is fixed.

### 3. Prefer parallel mobile render paths for dense UI

Use this for:

- dashboard/admin navigation
- docs TOC
- dense data tables
- API reference sidebars

Do not force a desktop control to "sort of work" on phones when a dedicated mobile pattern is cleaner.

### 4. Add `min-w-0` aggressively inside flex and grid layouts

This is one of the lowest-risk, highest-value fixes for overflow prevention.

Targets:

- content columns inside grid layouts
- card wrappers with code or tables
- any flex row with long labels or tokens

---

## Detailed Update Plan

## Phase 1 — Fix Functional Mobile Navigation Gaps

Priority: highest

Goals:

- Restore dashboard navigation on mobile
- Restore admin navigation on mobile
- Preserve current desktop sidebars completely

Files:

- New: `frontend/components/dashboard/dashboard-mobile-nav.tsx`
- Update: `frontend/components/dashboard/dashboard-top-nav.tsx`
- Update: `frontend/components/dashboard/dashboard-app-shell.tsx`
- New: `frontend/components/admin/admin-mobile-nav.tsx`
- Update: `frontend/components/admin/admin-top-bar.tsx`
- Update: `frontend/components/admin/admin-app-shell.tsx`

Implementation outline:

1. Add a menu button in the top bar.
2. Open a drawer/sheet from the left.
3. Reuse `dashboardRoutes` / `adminRoutes`.
4. Show the active route label in the mobile top bar.
5. Close the drawer after route selection.

Acceptance criteria:

- On `390px` width, users can switch between all dashboard pages.
- On `768px` width, admin still has accessible navigation.
- On `1440px` width, desktop sidebar appearance is unchanged.

---

## Phase 2 — Rebuild Docs Mobile Layout Without Touching Desktop

Priority: highest

Goals:

- Remove horizontal overflow from docs pages
- Give docs a true mobile navigation pattern
- Convert TOC into a mobile-safe interaction model

Files:

- `frontend/app/docs/page.tsx`
- `frontend/app/docs/api-reference/page.tsx`
- `frontend/app/docs/search-api/page.tsx`
- `frontend/app/docs/[slug]/page.tsx`
- `frontend/components/docs-sidebar.tsx`
- `frontend/components/docs-toc.tsx`
- `frontend/components/docs-header.tsx`
- `frontend/components/code-block.tsx`
- Potentially a new shared docs mobile nav / toc component

Implementation outline:

1. Keep the existing desktop `lg:grid-cols[...]` layout.
2. Below `lg`:
   - move navigation access to explicit triggers
   - hide the sticky right TOC card
   - render a collapsible mobile TOC inside the article flow
3. For API Reference:
   - extract the inline sidebar into a reusable component
   - give it both desktop and mobile variants
4. Wrap all dense blocks with mobile containment:
   - `min-w-0`
   - `w-full`
   - `max-w-full`
   - `overflow-x-auto`
5. Replace the densest docs tables with mobile cards instead of raw table scroll.
6. Add a visible scroll affordance to header tabs rather than forcing wrap.

Acceptance criteria:

- `/docs`, `/docs/api-reference`, `/docs/search-api` all render near the normal mobile baseline width.
- No horizontal page drag on `390px`.
- Desktop three-column docs layout is visually unchanged on `lg+`.

---

## Phase 3 — Fix Homepage Overflow and Stabilize Mobile First Paint

Priority: high

Goals:

- Remove homepage horizontal overflow
- Improve the readability of demo content on phones
- Reduce "blank before animate-in" perception on small screens

Files:

- `frontend/app/page.tsx`
- `frontend/components/animations.tsx`
- Possibly shared utility classes in `frontend/app/globals.css`

Implementation outline:

1. Audit the hero and API demo section for unbounded width.
2. Add `min-w-0` and `max-w-full` to demo columns and wrappers where needed.
3. Keep code block horizontal scroll, but make the surrounding card fully bounded.
4. Reduce animation intensity below `md` for critical content sections.
5. If decorative layers still create stray overflow, clip them at the section level instead of globally on `body`.

Acceptance criteria:

- `/` no longer exceeds the normal mobile width envelope.
- Hero content is visible immediately on mobile.
- Desktop hero layout remains the same.

---

## Phase 4 — Improve Dense Data Views on Mobile

Priority: medium

Goals:

- Make pricing and docs tables readable on phones
- Avoid making mobile users horizontally scroll through high-density comparisons

Files:

- `frontend/app/pricing/page.tsx`
- Docs pages containing tables

Implementation outline:

1. Keep current tables on `lg+`.
2. Render stacked cards below `lg`.
3. For pricing:
   - one card per tier
   - grouped feature rows inside each card
4. For docs:
   - one card per parameter or error row

Acceptance criteria:

- Pricing remains visually identical on desktop.
- Mobile comparisons are readable without precision horizontal scrolling.

---

## Phase 5 — Finish Secondary Mobile UX Gaps

Priority: medium

Goals:

- Restore small-screen access to important public actions
- Improve context and polish

Files:

- `frontend/components/site-header.tsx`
- `frontend/components/site-header-auth-actions.tsx`
- `frontend/components/dashboard/dashboard-top-nav.tsx`

Implementation outline:

1. Add a mobile GitHub affordance.
2. Check whether the auth action loading placeholder width needs a smaller mobile version.
3. Surface active-route context in dashboard mobile top nav.

Acceptance criteria:

- No more "missing GitHub action" on mobile.
- Top bars remain stable without squeezing or wrapping awkwardly.

---

## QA Matrix

Every phase should be verified at these widths:

- `375px` — iPhone SE class
- `390px` — iPhone 14 class
- `768px` — iPad portrait
- `1024px` — small laptop / iPad Pro edge
- `1440px` — standard desktop baseline

Key pages to smoke-test every time:

- `/`
- `/docs`
- `/docs/api-reference`
- `/docs/search-api`
- `/pricing`
- `/login`
- one dashboard page
- one admin page

Required checks:

- No horizontal page drag unless intentionally inside a contained code/table block
- Navigation remains accessible
- Desktop sidebars and column layouts are unchanged
- No clipped drawers, popovers, or shadows

---

## Recommended Delivery Order

1. Dashboard mobile nav
2. Admin mobile nav
3. Docs mobile layout system
4. Homepage overflow fix
5. Pricing/docs dense-table mobile variants
6. Header and small UX polish

This order fixes the true blockers first and minimizes the risk of desktop regressions.

---

## Execution Status

Implementation status on 2026-04-13:

- Phase 1 completed:
  - added dashboard mobile navigation drawer
  - added admin mobile navigation drawer
  - surfaced the active route label in both mobile top bars
- Phase 2 completed:
  - rebuilt docs mobile navigation into overlay patterns
  - hid the desktop sticky TOC below `lg`
  - added a mobile TOC trigger
  - extracted the API reference sidebar into a reusable mobile-safe component
  - strengthened docs tab behavior so the active tab scrolls into view
- Phase 3 completed:
  - contained homepage overflow with `min-w-0`, `max-w-full`, and section-level clipping
  - improved mobile header action density
- Phase 4 completed:
  - added mobile pricing comparison cards
  - wrapped dense docs tables in controlled overflow containers
- Phase 5 completed:
  - restored a mobile GitHub affordance in the public header
  - reduced auth-action squeeze on smaller screens

### Post-fix Verification

Verification steps used:

1. `pnpm --dir frontend lint`
2. `pnpm --dir frontend build`
3. Local mobile screenshot capture in iPhone 14 emulation
4. Visual comparison against the original overflowing pages

Measured post-fix screenshot widths:

| Page | Width after fix | Result |
| --- | ---: | --- |
| `/` | 1170 | Returned to normal mobile baseline |
| `/pricing` | 1170 | Within baseline |
| `/brand` | 1170 | Within baseline |
| `/login` | 1170 | Within baseline |
| `/docs` | 1170 | Severe overflow removed |
| `/docs/api-reference` | 1170 | Severe overflow removed |
| `/docs/search-api` | 1170 | Severe overflow removed |

Verification conclusion:

- The previously confirmed public-page mobile breakages are now resolved based on both layout inspection and live screenshot comparison.
- The docs family no longer shows page-level horizontal overflow.
- The homepage no longer exceeds the normal mobile width envelope.
- Pricing now has a mobile-specific comparison pattern without changing the desktop table.
- Desktop regression risk stayed low because the fixes used mobile-only branches such as `lg:hidden` / `xl:hidden` and preserved the existing desktop grid and sidebar layout.

Remaining verification boundary:

- The dashboard and admin mobile drawers were implemented and passed lint/build validation.
- In the current local environment, unauthenticated visits to `/dashboard` and `/admin` redirect to `/login`, so final live interaction testing for those authenticated shells still needs one signed-in screenshot pass.

### Additional finding after screenshot review

A second mobile audit exposed another real issue:

- several long pages appeared to have large blank areas near the bottom in full-page mobile screenshots

Root cause:

- this was not a real layout-height bug
- the shared motion wrappers in `frontend/components/animations.tsx` used `IntersectionObserver` with initial `opacity: 0`
- on mobile full-page capture, many below-the-fold sections never became intersecting before the screenshot was taken
- the result looked like "large bottom whitespace" even though the page height was correct

Applied fix:

- preserved the desktop scroll-reveal behavior
- added mobile and reduced-motion CSS overrides so `.motion-reveal-*` wrappers render immediately on smaller screens
- this keeps the desktop motion style while preventing mobile screenshots and initial long-page rendering from hiding large sections of content

Validated pages after the fix:

- `/`
- `/docs`
- `/brand`

Artifacts:

- post-fix production screenshots saved under `/Users/jessytsui/cerul-ai/local-audits/cerul-mobile-2026-04-13/prod-blank-fix/`
