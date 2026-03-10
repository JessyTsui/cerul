import Link from "next/link";

export function BrandMark() {
  return (
    <Link href="/" className="group inline-flex items-center gap-3">
      <span className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl">
        {/* Glow effect */}
        <span className="absolute inset-0 bg-gradient-to-br from-blue-500 to-orange-500 opacity-80 transition-opacity group-hover:opacity-100" />
        <span className="absolute inset-[1px] rounded-[11px] bg-[#0a0a0f]" />
        {/* Inner gradient */}
        <span className="absolute inset-[2px] rounded-[10px] bg-gradient-to-br from-blue-500 to-orange-500" />
        <span className="relative text-lg font-bold text-white">C</span>
      </span>
      <span className="text-xl font-bold tracking-tight text-white">
        Cerul
      </span>
    </Link>
  );
}
