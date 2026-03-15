import Image from "next/image";
import Link from "next/link";

export function BrandMark() {
  return (
    <Link href="/" className="group inline-flex items-center gap-3">
      <span className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-[14px] border border-black/5 bg-white shadow-[0_12px_32px_rgba(5,8,20,0.22)] transition-transform duration-200 group-hover:-translate-y-0.5">
        <Image
          src="/logo.svg"
          alt=""
          width={24}
          height={24}
          unoptimized
          className="h-6 w-6"
        />
      </span>
      <span className="text-xl font-bold tracking-tight text-white transition-colors duration-200 group-hover:text-[var(--foreground-secondary)]">
        Cerul
      </span>
    </Link>
  );
}
