"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type MenuPosition = { x: number; y: number };

export function BrandMark() {
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menu) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setMenu(null);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKey);
    };
  }, [menu]);

  const handleContextMenu = (event: React.MouseEvent<HTMLSpanElement>) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY });
  };

  const closeMenu = () => setMenu(null);

  const copySvg = async () => {
    try {
      const response = await fetch("/logo.svg");
      const text = await response.text();
      await navigator.clipboard.writeText(text);
    } catch {
      /* noop — clipboard can fail on non-https or denied permission */
    }
    closeMenu();
  };

  return (
    <>
      <Link href="/" className="group inline-flex items-center gap-3">
        <span
          onContextMenu={handleContextMenu}
          className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-[14px] border border-[var(--border)] bg-white shadow-[0_12px_28px_rgba(44,31,18,0.12)] transition-transform duration-200 group-hover:-translate-y-0.5"
        >
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

      {menu ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Cerul brand assets"
          style={{
            position: "fixed",
            top: menu.y,
            left: menu.x,
            zIndex: 100,
          }}
          className="min-w-[240px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-[0_24px_48px_rgba(44,31,18,0.18)] backdrop-blur"
        >
          <div className="px-4 pb-2 pt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--foreground-tertiary)]">
            Cerul brand assets
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={copySvg}
            className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-[var(--foreground)] transition hover:bg-[var(--brand-subtle)]"
          >
            <MenuIcon name="copy" />
            Copy SVG markup
          </button>
          <MenuLink href="/logo.svg" download onClick={closeMenu} icon="download">
            Download logo (SVG)
          </MenuLink>
          <MenuLink
            href="/press-kit/logo/logo-light.svg"
            download
            onClick={closeMenu}
            icon="download"
          >
            Download logo — light (SVG)
          </MenuLink>
          <MenuLink
            href="/press-kit/icons/icon-512.png"
            download
            onClick={closeMenu}
            icon="download"
          >
            Download icon (PNG, 512)
          </MenuLink>
          <div className="my-1 h-px bg-[var(--border)]" />
          <MenuLink
            href="/cerul-press-kit.zip"
            download
            onClick={closeMenu}
            icon="zip"
          >
            Download full press kit (.zip)
          </MenuLink>
          <MenuLink href="/brand" onClick={closeMenu} icon="info">
            Brand guidelines
          </MenuLink>
        </div>
      ) : null}
    </>
  );
}

function MenuLink({
  href,
  children,
  download,
  onClick,
  icon,
}: {
  href: string;
  children: React.ReactNode;
  download?: boolean;
  onClick?: () => void;
  icon: IconName;
}) {
  return (
    <a
      href={href}
      download={download}
      role="menuitem"
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-2 text-sm text-[var(--foreground)] transition hover:bg-[var(--brand-subtle)]"
    >
      <MenuIcon name={icon} />
      {children}
    </a>
  );
}

type IconName = "copy" | "download" | "zip" | "info";

function MenuIcon({ name }: { name: IconName }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "text-[var(--foreground-tertiary)]",
  };
  if (name === "copy") {
    return (
      <svg {...common}>
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
    );
  }
  if (name === "download") {
    return (
      <svg {...common}>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    );
  }
  if (name === "zip") {
    return (
      <svg {...common}>
        <path d="M21 8v13H3V8" />
        <path d="M1 3h22v5H1z" />
        <path d="M10 12h4" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
