import type { DemoMode } from "@/lib/demo-api";

type SearchAnswerProps = {
  answer?: string;
  mode: DemoMode;
};

const answerCopyByMode: Record<Exclude<DemoMode, "broll">, string> = {
  knowledge: "Synthesized from segment-level retrieval across spoken and visual evidence.",
  agent: "Structured for downstream agents that need concise claims plus citation-ready context.",
};

export function SearchAnswer({ answer, mode }: SearchAnswerProps) {
  if (!answer || mode === "broll") {
    return null;
  }

  return (
    <section className="surface-elevated overflow-hidden">
      <div className="border-b border-[var(--border-brand)] bg-[linear-gradient(135deg,rgba(59,130,246,0.14),rgba(249,115,22,0.08))] px-5 py-4 sm:px-6">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--brand-bright)]">
          {mode === "agent" ? "Agent Answer" : "Knowledge Answer"}
        </p>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--foreground-secondary)]">
          {answerCopyByMode[mode]}
        </p>
      </div>
      <div className="px-5 py-5 sm:px-6 sm:py-6">
        <p className="max-w-4xl text-lg leading-8 text-white sm:text-xl">
          {answer}
        </p>
      </div>
    </section>
  );
}
