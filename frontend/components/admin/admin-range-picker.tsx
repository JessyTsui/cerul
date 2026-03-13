"use client";

import type { AdminRange } from "@/lib/admin-api";
import { ADMIN_RANGE_OPTIONS } from "@/lib/admin-console";

type AdminRangePickerProps = {
  value: AdminRange;
  onChange: (value: AdminRange) => void;
};

export function AdminRangePicker({
  value,
  onChange,
}: AdminRangePickerProps) {
  return (
    <div className="inline-flex rounded-full border border-[var(--border)] bg-[var(--surface)] p-1">
      {ADMIN_RANGE_OPTIONS.map((option) => {
        const isActive = option.value === value;

        return (
          <button
            key={option.value}
            className={`rounded-full px-4 py-2 text-sm transition-colors ${
              isActive
                ? "bg-[var(--brand-bright)] text-slate-950"
                : "text-[var(--foreground-secondary)] hover:text-white"
            }`}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
