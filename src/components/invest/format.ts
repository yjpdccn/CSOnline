/** Chinese market colors: red for up, green for down. */
export function moveClass(value: number | undefined): string {
  if (value === undefined || Math.abs(value) < 0.005) return "text-muted-foreground";
  return value > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400";
}

export function fmt(value: number, decimals: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function signedPct(value: number | undefined): string {
  if (value === undefined) return "—";
  if (Math.abs(value) < 0.005) return "0.00%";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function signedBp(value: number | undefined): string {
  if (value === undefined) return "—";
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded}bp`;
}

/** "10月28日" from YYYY-MM-DD. */
export function shortDate(day: string): string {
  return `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;
}

export function percentile(value: number | undefined): string {
  return value === undefined ? "" : `${Math.round(value * 100)}%`;
}
