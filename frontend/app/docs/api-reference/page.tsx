import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { DocsTabs } from "@/components/docs-tabs";
import { SiteHeader } from "@/components/site-header";
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

function getMethodClasses(method: "GET" | "POST" | "DELETE") {
  if (method === "GET") {
    return "bg-emerald-500/14 text-emerald-300 border-emerald-500/30";
  }

  if (method === "DELETE") {
    return "bg-rose-500/14 text-rose-300 border-rose-500/30";
  }

  return "bg-sky-500/14 text-sky-300 border-sky-500/30";
}

export default function ApiReferencePage() {
  return (
    <div className="min-h-screen px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1520px]">
        <SiteHeader currentPath="/docs/api-reference" />

        <div className="mt-8 grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)_360px]">
          <aside className="sticky top-24 h-fit rounded-[24px] border border-[var(--border)] bg-[rgba(9,13,21,0.92)] p-4 shadow-[0_22px_60px_rgba(2,6,18,0.16)]">
            <div className="rounded-[16px] border border-[var(--border-brand)] bg-[rgba(34,211,238,0.08)] px-4 py-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                Public API only
              </p>
              <p className="mt-2 text-sm leading-6 text-white">
                This reference only lists the public HTTP routes exposed by Cerul today.
              </p>
            </div>

            <div className="mt-5 space-y-5">
              {groups.map(([groupName, endpoints]) => (
                <section key={groupName}>
                  <h2 className="px-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
                    {groupName}
                  </h2>
                  <div className="mt-3 space-y-1">
                    {endpoints.map((endpoint) => {
                      return (
                        <a
                          key={endpoint.id}
                          href={`#${endpoint.id}`}
                          className={`rounded-[14px] border-l-2 px-3 py-3 ${
                            "border-l-transparent bg-transparent transition hover:border-l-[var(--brand)] hover:bg-[rgba(34,211,238,0.08)]"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getMethodClasses(endpoint.method)}`}>
                              {endpoint.method}
                            </span>
                            <span className="truncate text-sm text-white">{endpoint.path}</span>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-[var(--foreground-secondary)]">
                            {endpoint.title}
                          </p>
                        </a>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </aside>

          <main className="min-w-0 space-y-6">
            <section className="rounded-[24px] border border-[var(--border)] bg-[rgba(9,13,21,0.92)] px-6 py-6 shadow-[0_22px_60px_rgba(2,6,18,0.16)] sm:px-8">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--brand-bright)]">
                API contract
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-[var(--foreground-secondary)]">
                <span className="rounded-full border border-[var(--border)] px-3 py-1">
                  v2.0
                </span>
                <span className="rounded-full border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-3 py-1 text-[var(--brand-bright)]">
                  Base URL: https://api.cerul.ai
                </span>
              </div>
              <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-white sm:text-5xl">
                Public endpoints, accurate payloads, no dashboard-only chrome.
              </h1>
              <p className="mt-5 max-w-4xl text-base leading-8 text-[var(--foreground-secondary)]">
                Cerul’s public contract is intentionally narrow. Index, search, and usage are the
                primary authenticated routes, with tracking redirects returned as public result URLs.
              </p>
              <div className="mt-6 grid gap-4 xl:grid-cols-3">
                {[
                  {
                    title: "Base URL",
                    value: "https://api.cerul.ai",
                    description: "All public HTTP requests target the same origin.",
                  },
                  {
                    title: "Formats",
                    value: "JSON request + response",
                    description: "Primary authenticated routes are JSON-first.",
                  },
                  {
                    title: "Auth posture",
                    value: "Bearer key",
                    description: "Dashboard sessions are separate from the public API contract.",
                  },
                ].map((item) => (
                  <div
                    key={item.title}
                    className="rounded-[20px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-5 py-5"
                  >
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                      {item.title}
                    </p>
                    <p className="mt-3 text-lg font-semibold text-white">{item.value}</p>
                    <p className="mt-3 text-sm leading-6 text-[var(--foreground-secondary)]">
                      {item.description}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            {apiReferenceEndpoints.map((endpoint) => (
              <section
                key={endpoint.id}
                id={endpoint.id}
                className="scroll-mt-28 rounded-[24px] border border-[var(--border)] bg-[rgba(9,13,21,0.92)] px-6 py-6 shadow-[0_22px_60px_rgba(2,6,18,0.16)] sm:px-8"
              >
                <div className="border-b border-[var(--border)] pb-8">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${getMethodClasses(endpoint.method)}`}>
                      {endpoint.method}
                    </span>
                    <span className="rounded-full border border-[var(--border)] px-3 py-1 font-mono text-sm text-white">
                      {endpoint.path}
                    </span>
                    <span className="rounded-full border border-[var(--border)] px-3 py-1 text-sm text-[var(--foreground-secondary)]">
                      {endpoint.group}
                    </span>
                  </div>
                  <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-white">
                    {endpoint.title}
                  </h2>
                  <p className="mt-4 max-w-4xl text-base leading-8 text-[var(--foreground-secondary)]">
                    {endpoint.description}
                  </p>
                </div>

                <div className="mt-8 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                  <div className="rounded-[20px] border border-[var(--border-brand)] bg-[rgba(34,211,238,0.08)] px-5 py-5">
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                      Authentication
                    </p>
                    <div className="mt-3 inline-flex rounded-full border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-3 py-1 text-sm text-[var(--brand-bright)]">
                      {endpoint.authLabel}
                    </div>
                    <p className="mt-3 text-sm leading-7 text-white">
                      {endpoint.authDescription}
                    </p>
                  </div>

                  <div className="rounded-[20px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-5 py-5">
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                      Request contract
                    </p>
                    <p className="mt-3 text-sm leading-7 text-[var(--foreground-secondary)]">
                      {endpoint.parameters.length > 0
                        ? "Fields below describe the exact public contract. Optional inputs should be omitted rather than sent as empty placeholders."
                        : "This route does not accept request body fields or query parameters in the public contract."}
                    </p>
                  </div>
                </div>

                <div className="mt-8">
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                    Request parameters
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold text-white">Inputs accepted by this route</h3>

                  {endpoint.parameters.length > 0 ? (
                    <div className="mt-4 overflow-hidden rounded-[20px] border border-[var(--border)]">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-[rgba(255,255,255,0.03)] text-[var(--foreground-secondary)]">
                          <tr>
                            <th className="px-4 py-3 font-medium">Name</th>
                            <th className="px-4 py-3 font-medium">Type</th>
                            <th className="px-4 py-3 font-medium">Required</th>
                            <th className="px-4 py-3 font-medium">Description</th>
                          </tr>
                        </thead>
                        <tbody>
                          {endpoint.parameters.map((parameter) => (
                            <tr key={parameter.name} className="border-t border-[var(--border)]">
                              <td className="px-4 py-4 font-mono text-white">{parameter.name}</td>
                              <td className="px-4 py-4 text-[var(--foreground-secondary)]">{parameter.type}</td>
                              <td className="px-4 py-4 text-[var(--foreground-secondary)]">{parameter.required}</td>
                              <td className="px-4 py-4 text-[var(--foreground-secondary)]">{parameter.description}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-[20px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-5 py-5">
                      <p className="text-sm leading-7 text-[var(--foreground-secondary)]">
                        No parameters are required for this endpoint.
                      </p>
                    </div>
                  )}
                </div>

                <div className="mt-8">
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                    Request examples
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold text-white">Run the endpoint from your stack</h3>
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

                <div className="mt-8 grid gap-6 xl:grid-cols-2">
                  <div className="rounded-[24px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] p-5">
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

                  <div className="rounded-[24px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] p-5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                        Response example
                      </p>
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-sm text-emerald-300">
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
              </section>
            ))}
          </main>

          <aside className="space-y-6">
            <section className="sticky top-24 space-y-6">
              <div className="rounded-[24px] border border-[var(--border)] bg-[rgba(9,13,21,0.92)] p-5 shadow-[0_22px_60px_rgba(2,6,18,0.16)]">
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                  Navigation
                </p>
                <div className="mt-4 space-y-3">
                  <Link href="/docs/quickstart" className="button-secondary w-full justify-center">
                    Quickstart
                  </Link>
                  <Link href="/docs/search-api" className="button-secondary w-full justify-center">
                    Search guide
                  </Link>
                  <Link href="/docs/usage-api" className="button-secondary w-full justify-center">
                    Usage guide
                  </Link>
                </div>
              </div>

              <div className="rounded-[24px] border border-[var(--border)] bg-[rgba(9,13,21,0.92)] p-5 shadow-[0_22px_60px_rgba(2,6,18,0.16)]">
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                  Reference notes
                </p>
                <div className="mt-4 space-y-4">
                  {[
                    "Public docs only describe stable routes that exist today.",
                    "Dashboard session endpoints are intentionally excluded from the public API contract.",
                    "When in doubt, test `/v1/search` first and verify credits with `/v1/usage`.",
                  ].map((item) => (
                    <div
                      key={item}
                      className="rounded-[16px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-4 py-4"
                    >
                      <p className="text-sm leading-6 text-white">{item}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
