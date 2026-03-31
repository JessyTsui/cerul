import type { Metadata } from "next";
import Link from "next/link";
import { AIToolbar } from "@/components/ai-toolbar";
import { CodeBlock } from "@/components/code-block";
import { DocsHeader } from "@/components/docs-header";
import { DocsTabs } from "@/components/docs-tabs";
import { DocsToc, type TocItem } from "@/components/docs-toc";
import { SiteFooter } from "@/components/site-footer";
import { apiReferenceEndpoints } from "@/lib/docs";

export const metadata: Metadata = {
  title: "API Reference",
  alternates: {
    canonical: "/docs/api-reference",
  },
};

const groups = Array.from(
  apiReferenceEndpoints.reduce<Map<string, (typeof apiReferenceEndpoints)[number][]>>(
    (map, endpoint) => {
      const items = map.get(endpoint.group) ?? [];
      items.push(endpoint);
      map.set(endpoint.group, items);
      return map;
    },
    new Map(),
  ),
);

const tocItems: TocItem[] = [
  { id: "overview", text: "Introduction", level: 1 },
  ...apiReferenceEndpoints.map((endpoint) => ({
    id: endpoint.id,
    text: `${endpoint.method} ${endpoint.path}`,
    level: 1 as const,
  })),
];

function getMethodClasses(method: "GET" | "POST" | "DELETE") {
  if (method === "GET") {
    return "border-[rgba(31,141,74,0.18)] bg-[rgba(31,141,74,0.12)] text-[var(--success)]";
  }

  if (method === "DELETE") {
    return "border-[rgba(191,91,70,0.18)] bg-[rgba(191,91,70,0.12)] text-[var(--error)]";
  }

  return "border-[var(--border-brand)] bg-[var(--brand-subtle)] text-[var(--brand-bright)]";
}

export default function ApiReferencePage() {
  return (
    <div className="soft-theme min-h-screen pb-10">
      <DocsHeader currentPath="/docs/api-reference" />

      <div className="mx-auto max-w-[1520px] px-4 sm:px-6 lg:px-8">
        <div className="mt-8 grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)_220px]">
          <aside className="sticky top-20 h-fit max-h-[calc(100vh-5.5rem)] overflow-y-auto rounded-[24px] border border-[var(--border)] bg-[rgba(255,252,247,0.78)] p-4 shadow-[0_18px_40px_rgba(36,29,21,0.06)] backdrop-blur-xl">
            <div className="border-b border-[var(--border)] pb-4">
              <Link
                href="/docs"
                className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--brand-bright)]"
              >
                Documentation
              </Link>
              <p className="mt-2 text-base font-semibold text-[var(--foreground)]">
                API Reference
              </p>
              <p className="mt-1 text-sm leading-6 text-[var(--foreground-secondary)]">
                Stable public routes only.
              </p>
            </div>

            <div className="mt-4 space-y-5">
              {groups.map(([groupName, endpoints]) => (
                <section key={groupName}>
                  <h2 className="px-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
                    {groupName}
                  </h2>
                  <div className="mt-2 space-y-1">
                    {endpoints.map((endpoint) => (
                      <a
                        key={endpoint.id}
                        href={`#${endpoint.id}`}
                        className="block rounded-[14px] border-l-2 border-l-transparent px-3 py-2.5 transition hover:bg-white/70"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getMethodClasses(endpoint.method)}`}
                          >
                            {endpoint.method}
                          </span>
                          <span className="truncate text-sm text-[var(--foreground)]">
                            {endpoint.path}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-[var(--foreground-secondary)]">
                          {endpoint.title}
                        </p>
                      </a>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </aside>

          <main data-ai-copy-root="true" className="min-w-0">
            <article className="rounded-[28px] border border-[var(--border)] bg-[rgba(255,252,247,0.78)] px-6 py-8 shadow-[0_18px_48px_rgba(36,29,21,0.08)] backdrop-blur-xl sm:px-8">
              <section id="overview" className="max-w-4xl border-b border-[var(--border)] pb-10">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--brand-bright)]">
                  API Reference
                </p>
                <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-[var(--foreground)] sm:text-5xl">
                  API Reference
                </h1>
                <p className="mt-4 max-w-4xl text-[15px] leading-8 text-[var(--foreground-secondary)]">
                  Two endpoints: search videos and check usage. Both require a Bearer API key
                  and return JSON responses.
                </p>

                <div className="mt-5 flex flex-wrap items-center gap-2 text-sm text-[var(--foreground-secondary)]">
                  {[
                    "Base URL: https://api.cerul.ai",
                    "Bearer authentication",
                    "JSON payloads",
                  ].map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-[var(--border)] bg-white/70 px-3 py-1"
                    >
                      {item}
                    </span>
                  ))}
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-3">
                  {[
                    {
                      title: "Base URL",
                      value: "https://api.cerul.ai",
                      description: "All public requests share the same API origin.",
                    },
                    {
                      title: "Formats",
                      value: "JSON request + response",
                      description: "Authenticated routes are JSON-first with stable envelopes.",
                    },
                    {
                      title: "Auth",
                      value: "Bearer key",
                      description: "Dashboard sessions are separate from the public API contract.",
                    },
                  ].map((item) => (
                    <div
                      key={item.title}
                      className="rounded-[18px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-4"
                    >
                      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                        {item.title}
                      </p>
                      <p className="mt-3 text-base font-semibold text-[var(--foreground)]">
                        {item.value}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                        {item.description}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-7" data-docs-ai-anchor="true">
                  <AIToolbar
                    copyRootSelector="[data-ai-copy-root='true']"
                    pageUrl="/docs/api-reference"
                    pageTitle="Cerul API Reference"
                  />
                </div>
              </section>

              <div className="divide-y divide-[var(--border)]">
                {apiReferenceEndpoints.map((endpoint) => (
                  <section key={endpoint.id} id={endpoint.id} className="scroll-mt-28 py-10">
                    <div className="max-w-4xl">
                      <div className="flex flex-wrap items-center gap-3">
                        <span
                          className={`rounded-full border px-3 py-1 text-sm font-semibold ${getMethodClasses(endpoint.method)}`}
                        >
                          {endpoint.method}
                        </span>
                        <span className="rounded-full border border-[var(--border)] bg-white/70 px-3 py-1 font-mono text-sm text-[var(--foreground)]">
                          {endpoint.path}
                        </span>
                        <span className="rounded-full border border-[var(--border)] px-3 py-1 text-sm text-[var(--foreground-secondary)]">
                          {endpoint.group}
                        </span>
                      </div>
                      <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                        {endpoint.title}
                      </h2>
                      <p className="mt-4 max-w-4xl text-[15px] leading-8 text-[var(--foreground-secondary)]">
                        {endpoint.description}
                      </p>
                    </div>

                    <div className="mt-6 grid gap-8 xl:grid-cols-[minmax(0,1fr)_460px]">
                      <div className="space-y-6">
                        <div className="rounded-[18px] border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-4 py-4">
                          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                            Authentication
                          </p>
                          <div className="mt-3 inline-flex rounded-full border border-[var(--border-brand)] bg-white/65 px-3 py-1 text-sm text-[var(--brand-bright)]">
                            {endpoint.authLabel}
                          </div>
                          <p className="mt-3 text-sm leading-7 text-[var(--foreground)]">
                            {endpoint.authDescription}
                          </p>
                        </div>

                        <div className="rounded-[18px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-4">
                          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                            Request contract
                          </p>
                          <p className="mt-3 text-sm leading-7 text-[var(--foreground-secondary)]">
                            {endpoint.parameters.length > 0
                              ? "Fields below describe the exact public contract. Omit optional values instead of sending empty placeholders."
                              : "This route does not accept request body fields or query parameters in the public contract."}
                          </p>
                        </div>

                        <div>
                          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                            Request parameters
                          </p>
                          <h3 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                            Inputs accepted by this route
                          </h3>

                          {endpoint.parameters.length > 0 ? (
                            <div className="mt-4 overflow-hidden rounded-[20px] border border-[var(--border)]">
                              <table className="w-full text-left text-sm">
                                <thead className="bg-[var(--background-elevated)] text-[var(--foreground-secondary)]">
                                  <tr>
                                    <th className="px-4 py-3 font-medium">Name</th>
                                    <th className="px-4 py-3 font-medium">Type</th>
                                    <th className="px-4 py-3 font-medium">Required</th>
                                    <th className="px-4 py-3 font-medium">Description</th>
                                  </tr>
                                </thead>
                                <tbody className="bg-white/65">
                                  {endpoint.parameters.map((parameter) => (
                                    <tr key={parameter.name} className="border-t border-[var(--border)]">
                                      <td className="px-4 py-4 font-mono text-[var(--foreground)]">
                                        {parameter.name}
                                      </td>
                                      <td className="px-4 py-4 text-[var(--foreground-secondary)]">
                                        {parameter.type}
                                      </td>
                                      <td className="px-4 py-4 text-[var(--foreground-secondary)]">
                                        {parameter.required}
                                      </td>
                                      <td className="px-4 py-4 text-[var(--foreground-secondary)]">
                                        {parameter.description}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="mt-4 rounded-[18px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-4">
                              <p className="text-sm leading-7 text-[var(--foreground-secondary)]">
                                No parameters are required for this endpoint.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-6">
                        <div>
                          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                            Request examples
                          </p>
                          <h3 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                            Run the endpoint from your stack
                          </h3>
                          <div className="mt-4">
                            <DocsTabs
                              items={endpoint.requestExamples.map((example) => ({
                                label: example.label,
                                value: `${endpoint.id}-${example.label.toLowerCase()}`,
                                content: (
                                  <CodeBlock
                                    code={example.code}
                                    language={example.language}
                                    filename={example.filename}
                                  />
                                ),
                              }))}
                            />
                          </div>
                        </div>

                        <div className="space-y-6">
                          <div className="rounded-[18px] border border-[var(--border)] bg-[var(--background-elevated)] p-4">
                            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                              Response schema
                            </p>
                            <div className="mt-4">
                              <CodeBlock
                                code={endpoint.responseSchema}
                                language="json"
                                filename="response-schema.json"
                              />
                            </div>
                          </div>

                          <div className="rounded-[18px] border border-[var(--border)] bg-[var(--background-elevated)] p-4">
                            <div className="flex items-center justify-between gap-3">
                              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                                Response example
                              </p>
                              <span className="rounded-full border border-[rgba(31,141,74,0.18)] bg-[rgba(31,141,74,0.12)] px-3 py-1 text-sm text-[var(--success)]">
                                200 OK
                              </span>
                            </div>
                            <div className="mt-4">
                              <CodeBlock
                                code={endpoint.responseExample}
                                language="json"
                                filename="response-example.json"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>
                ))}
              </div>
            </article>
          </main>

          <DocsToc
            items={tocItems}
            subtitle="Jump between the introduction and each stable public route."
            actions={[
              { label: "Get API key", href: "/login?mode=signup" },
              { label: "Read quickstart", href: "/docs" },
            ]}
          />
        </div>

        <SiteFooter />
      </div>
    </div>
  );
}
