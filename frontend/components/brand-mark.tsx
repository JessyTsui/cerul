import Image from "next/image";
import Link from "next/link";

export function BrandMark() {
  return (
    <Link href="/" className="group inline-flex items-center gap-3">
      <span className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-[14px] border border-[var(--border)] bg-white shadow-[0_12px_28px_rgba(44,31,18,0.12)] transition-transform duration-200 group-hover:-translate-y-0.5">
        <Image
          src="/logo.svg"
          alt=""
          width={24}
          height={24}
          unoptimized
          className="h-6 w-6"
        />
      </span>
      <span className="text-xl font-bold tracking-tight text-[var(--foreground)] transition-colors duration-200 group-hover:text-[var(--foreground-secondary)]">
        Cerul
      </span>
    </Link>
  );
}
