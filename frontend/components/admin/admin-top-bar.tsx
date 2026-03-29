"use client";

import { UserAvatarMenu } from "./user-avatar-menu";

type AdminTopBarProps = {
  title: string;
  subtitle: string;
};

export function AdminTopBar({ title, subtitle }: AdminTopBarProps) {
  return (
    <header className="flex h-20 shrink-0 items-center justify-between border-b border-slate-800/50 px-8">
      {/* Left: title */}
      <div>
        <h1 className="text-xl font-semibold text-white">{title}</h1>
        <p className="text-xs uppercase tracking-wider text-slate-500">{subtitle}</p>
      </div>

      {/* Right: utilities */}
      <div className="flex items-center gap-6">
        {/* Search */}
        <div className="relative w-72">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
            </svg>
          </div>
          <input
            className="block w-full rounded-md border-none bg-[#151c2c] py-2 pl-10 pr-3 text-sm leading-5 text-slate-300 placeholder-slate-500 outline-none focus:ring-1 focus:ring-cyan-500"
            placeholder="Search resources..."
            type="text"
          />
        </div>

        {/* Icon buttons */}
        <div className="flex items-center gap-4">
          {/* Notification bell */}
          <button type="button" className="relative text-slate-400 transition-colors hover:text-white">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
            </svg>
            <span className="absolute right-0 top-0 block h-2 w-2 rounded-full bg-red-500 ring-2 ring-[#0b111e]" />
          </button>

          {/* Grid / app switcher */}
          <button type="button" className="glow-cyan rounded border border-cyan-900 bg-cyan-900/20 p-1.5 text-cyan-400 transition-colors hover:bg-cyan-900/40">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
            </svg>
          </button>

          {/* User avatar (rightmost) — dropdown with profile settings + sign out */}
          <UserAvatarMenu />
        </div>
      </div>
    </header>
  );
}
