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
    <div className="inline-flex rounded-full border border-[var(--border)] bg-white/68 p-1 shadow-sm">
      {ADMIN_RANGE_OPTIONS.map((option) => {
        const isActive = option.value === value;

        return (
          <button
            key={option.value}
            className={`rounded-full px-4 py-2 text-sm transition-colors ${
              isActive
                ? "bg-[var(--foreground)] text-[#faf6ef]"
                : "text-[var(--foreground-secondary)] hover:bg-white/80 hover:text-[var(--foreground)]"
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
