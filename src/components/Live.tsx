"use client";

import { useSyncExternalStore } from "react";

const subscribeSecond = (cb: () => void) => {
  const t = setInterval(cb, 1000);
  return () => clearInterval(t);
};
const nowSecond = () => Math.floor(Date.now() / 1000) * 1000;

/** Client clock skew per server timestamp, computed once outside render state. */
const skews = new Map<number, number>();
function skewFor(serverNow: number): number {
  let s = skews.get(serverNow);
  if (s === undefined) {
    s = serverNow - Date.now();
    skews.set(serverNow, s);
  }
  return s;
}

export function parts(ms: number): { d: number; h: number; m: number; s: number } {
  const t = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(t / 86400), h: Math.floor((t % 86400) / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 };
}

/** Time left in the week, ticking each second, aligned to the server clock. */
export function WeekCountdown({ endAt, serverNow, className = "" }: { endAt: number; serverNow: number; className?: string }) {
  const now = useSyncExternalStore(subscribeSecond, nowSecond, () => 0);
  const left = now ? endAt - (now + skewFor(serverNow)) : endAt - serverNow;
  if (left <= 0)
    return (
      <span className={className} data-testid="countdown">
        Closed · settling
      </span>
    );
  const p = parts(left);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <span className={className} data-testid="countdown" suppressHydrationWarning>
      {p.d}d {pad(p.h)}h {pad(p.m)}m {pad(p.s)}s
    </span>
  );
}
