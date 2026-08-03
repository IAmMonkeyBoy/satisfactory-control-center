import type { JSX } from "react";

export function Stat({
  label,
  value,
  emphasis,
  muted,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  /** Dim a value the current source cannot answer, so it reads as absent. */
  muted?: boolean;
}): JSX.Element {
  const valueClass = emphasis
    ? "font-semibold text-alarm-critical"
    : muted
      ? "text-neutral-600"
      : "text-neutral-100";
  return (
    <li className="flex items-baseline justify-between gap-4">
      <span className="text-neutral-400">{label}</span>
      <span className={valueClass}>{value}</span>
    </li>
  );
}
