/**
 * One tick = fee sweep (attribute + claim) → week settlement → prize payouts → $VOLUMEPAD buy & burn.
 * Runs from `/api/tick` (Vercel cron) and from `after()` on a page load when the last tick is older than
 * TICK_EVERY_MS. Never loops, never runs twice at once (a 90 s lock in kv).
 */
import type { DatabaseSync } from "node:sqlite";
import { TICK_EVERY_MS } from "../config/volumepad.ts";
import { runBurn } from "./burn.ts";
import type { BurnStep } from "./burn.ts";
import { now as clockNow } from "./clock.ts";
import { db as defaultDb } from "./db.ts";
import { attribute, claim } from "./sweep.ts";
import type { AttributeResult, StepResult } from "./sweep.ts";
import { payPrizes, settleDue } from "./week.ts";
import { kvGet, kvSet } from "./store.ts";

export interface TickResult {
  at: number;
  attribute: AttributeResult;
  claim: StepResult;
  settled: number[];
  prizes: { paid: number; failed: number; skipped?: string };
  burn: BurnStep;
}

export async function runTick(db: DatabaseSync = defaultDb(), opts: { now?: number; fetcher?: typeof fetch } = {}): Promise<TickResult | { skipped: string }> {
  const lock = Number(kvGet(db, "tickLock") ?? 0);
  if (Date.now() - lock < 90_000) return { skipped: "a tick is already running" };
  kvSet(db, "tickLock", String(Date.now()));
  try {
    const attributed = await attribute(db);
    const claimed = await claim(db).catch(() => ({ error: "claim failed" }) as StepResult);
    const at = opts.now ?? clockNow();
    const settled = settleDue(db, at);
    const prizes = await payPrizes(db).catch(() => ({ paid: 0, failed: 1 }));
    const burned = await runBurn(db, opts.fetcher ?? fetch).catch(() => ({ error: "burn failed" }) as BurnStep);
    kvSet(db, "lastTick", String(Date.now()));
    return { at, attribute: attributed, claim: claimed, settled, prizes, burn: burned };
  } finally {
    kvSet(db, "tickLock", "0");
  }
}

export function tickDue(db: DatabaseSync = defaultDb(), nowMs = Date.now()): boolean {
  return nowMs - Number(kvGet(db, "lastTick") ?? 0) > TICK_EVERY_MS;
}

export function lastTick(db: DatabaseSync = defaultDb()): number | null {
  const v = Number(kvGet(db, "lastTick") ?? 0);
  return v > 0 ? v : null;
}
