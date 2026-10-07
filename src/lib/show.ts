/** Display helpers shared by server and client components. */
export function usd(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export function ago(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function nextPost(at: number, now: number, paused: boolean): string {
  if (paused) return "Posting paused";
  const m = Math.ceil((at - now) / 60_000);
  if (m <= 0) return "Next post any minute";
  if (m < 60) return `Next post in ${m}m`;
  return `Next post in ${Math.floor(m / 60)}h ${m % 60}m`;
}

export function sol(lamports: bigint | string | number, digits = 4): string {
  const n = Number(BigInt(String(lamports))) / 1e9;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: digits })} SOL`;
}

export const joined = (at: number) => `Joined ${new Date(at).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`;
