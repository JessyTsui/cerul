import Link from "next/link";

export function BrandMark() {
  return (
    <Link href="/" className="inline-flex items-center gap-3">
      <span className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-[14px] border border-[var(--line)] bg-white/88 shadow-[0_18px_40px_rgba(16,33,45,0.12)]">
        <span className="absolute inset-1 rounded-[10px] bg-[linear-gradient(135deg,rgba(10,142,216,0.88),rgba(255,107,44,0.95))]" />
        <span className="relative text-lg font-semibold text-white">C</span>
      </span>
      <span className="display-title text-2xl">Cerul</span>
    </Link>
  );
}
