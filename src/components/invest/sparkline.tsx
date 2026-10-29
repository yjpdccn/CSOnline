import { cn } from "@/lib/utils";

/** Daily closes as a small line; red when the period ended higher, green when lower. */
export function Sparkline({ values, className, label }: { values: number[]; className?: string; label?: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(2)},${(28 - ((v - min) / range) * 26).toFixed(2)}`).join(" ");
  const up = values.at(-1)! >= values[0];
  return (
    <svg
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className={cn("h-8 w-full", up ? "text-red-500/80" : "text-emerald-500/80", className)}
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
