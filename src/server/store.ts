/**
 * VOLUMEPAD tables: media, launches, coins, fee_events, trades, owners, weeks, prizes, kv. Every function takes
 * the database so tests can use an in-memory one.
 */
import type { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";

export interface CoinRow {
  id: string;
  slug: string;
  mint: string;
  name: string;
  ticker: string;
  description: string;
  imageId: string | null;
  owner: string;
  creator: string | null;
  launchSig: string | null;
  website: string | null;
  xUrl: string | null;
  telegram: string | null;
  createdAt: number;
  lastSig: string | null;
  pendingNewest: string | null;
  beforeSig: string | null;
}

export interface LaunchRow {
  id: string;
  name: string;
  ticker: string;
  setup: string;
  imageId: string;
  launcher: string;
  firstBuyLamports: string;
  status: string;
  paySig: string | null;
  mint: string | null;
  sig: string | null;
  error: string | null;
  createdAt: number;
}

export interface TradeRow {
  sig: string;
  n: number;
  coinId: string;
  user: string;
  lamports: string;
  isBuy: number;
  ts: number;
  slot: number;
  week: number;
}

const big = (v: unknown) => BigInt(String(v ?? "0"));
export const newId = (bytes = 8) => randomBytes(bytes).toString("hex");

// ───────────────────────────── media

export function putMedia(db: DatabaseSync, mime: string, bytes: Buffer): string {
  const id = newId(10);
  db.prepare("INSERT INTO media (id, mime, bytes, createdAt) VALUES (?, ?, ?, ?)").run(id, mime, bytes, Date.now());
  return id;
}

export function getMedia(db: DatabaseSync, id: string): { mime: string; bytes: Buffer } | null {
  const row = db.prepare("SELECT mime, bytes FROM media WHERE id = ?").get(id) as { mime: string; bytes: Uint8Array } | undefined;
  return row ? { mime: row.mime, bytes: Buffer.from(row.bytes) } : null;
}

export const mediaUrl = (id: string | null) => (id ? `/api/media/${id}` : null);

// ───────────────────────────── launches

export function insertLaunch(db: DatabaseSync, l: Omit<LaunchRow, "paySig" | "mint" | "sig" | "error">) {
  db.prepare("INSERT INTO launches (id, name, ticker, setup, imageId, launcher, firstBuyLamports, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    l.id,
    l.name,
    l.ticker,
    l.setup,
    l.imageId,
    l.launcher,
    l.firstBuyLamports,
    l.status,
    l.createdAt,
  );
}

export function getLaunch(db: DatabaseSync, id: string): LaunchRow | null {
  return (db.prepare("SELECT * FROM launches WHERE id = ?").get(id) as unknown as LaunchRow | undefined) ?? null;
}

export function updateLaunch(db: DatabaseSync, id: string, patch: Partial<Pick<LaunchRow, "status" | "paySig" | "mint" | "sig" | "error" | "firstBuyLamports">>) {
  for (const [k, v] of Object.entries(patch)) db.prepare(`UPDATE launches SET ${k} = ? WHERE id = ?`).run(v as string | null, id);
}

export function paySigUsed(db: DatabaseSync, sig: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM launches WHERE paySig = ?").get(sig));
}

export function launchesSince(db: DatabaseSync, launcher: string, since: number): number {
  return Number((db.prepare("SELECT COUNT(*) AS n FROM launches WHERE launcher = ? AND createdAt > ? AND status != ?").get(launcher, since, "failed") as { n: number }).n);
}

// ───────────────────────────── coins

export function slugify(name: string, db: DatabaseSync): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "coin";
  for (;;) {
    const slug = `${base}-${randomBytes(2).toString("hex")}`;
    if (!db.prepare("SELECT 1 FROM coins WHERE slug = ?").get(slug)) return slug;
  }
}

export type NewCoin = Pick<CoinRow, "mint" | "name" | "ticker" | "description" | "imageId" | "owner" | "creator" | "launchSig" | "website" | "xUrl" | "telegram"> & { createdAt?: number };

export function insertCoin(db: DatabaseSync, c: NewCoin): CoinRow {
  const id = newId();
  const slug = slugify(c.name, db);
  db.prepare(
    `INSERT INTO coins (id, slug, mint, name, ticker, description, imageId, owner, creator, launchSig, website, xUrl, telegram, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, slug, c.mint, c.name, c.ticker, c.description, c.imageId, c.owner, c.creator, c.launchSig, c.website, c.xUrl, c.telegram, c.createdAt ?? Date.now());
  return getCoin(db, id)!;
}

export function getCoin(db: DatabaseSync, id: string): CoinRow | null {
  return (db.prepare("SELECT * FROM coins WHERE id = ?").get(id) as unknown as CoinRow | undefined) ?? null;
}
export function coinBySlug(db: DatabaseSync, slug: string): CoinRow | null {
  return (db.prepare("SELECT * FROM coins WHERE slug = ?").get(slug) as unknown as CoinRow | undefined) ?? null;
}
export function coinByMint(db: DatabaseSync, mint: string): CoinRow | null {
  return (db.prepare("SELECT * FROM coins WHERE mint = ?").get(mint) as unknown as CoinRow | undefined) ?? null;
}
export function listCoins(db: DatabaseSync, limit = 200): CoinRow[] {
  return db.prepare("SELECT * FROM coins ORDER BY createdAt DESC LIMIT ?").all(limit) as unknown as CoinRow[];
}
export function coinsOf(db: DatabaseSync, owner: string): CoinRow[] {
  return db.prepare("SELECT * FROM coins WHERE owner = ? ORDER BY createdAt DESC").all(owner) as unknown as CoinRow[];
}

export function updateCoin(db: DatabaseSync, id: string, patch: Partial<Pick<CoinRow, "lastSig" | "pendingNewest" | "beforeSig">>) {
  for (const [k, v] of Object.entries(patch)) db.prepare(`UPDATE coins SET ${k} = ? WHERE id = ?`).run(v as string | null, id);
}

// ───────────────────────────── fees, trades and owners

export function creditFee(
  db: DatabaseSync,
  e: { mint: string; sig: string; slot: number; ts: number; lamports: bigint; coinId: string | null; owner: string | null; ownerShare: bigint; pot: bigint; platform: bigint; potWeek: number },
): boolean {
  const res = db
    .prepare("INSERT OR IGNORE INTO fee_events (mint, sig, slot, lamports, coinId, owner, ownerShare, pot, platform, potWeek, ts, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(e.mint, e.sig, e.slot, e.lamports.toString(), e.coinId, e.owner, e.ownerShare.toString(), e.pot.toString(), e.platform.toString(), e.potWeek, e.ts, Date.now());
  if (Number(res.changes) === 0) return false;
  if (e.owner && e.ownerShare > BigInt(0)) {
    db.prepare("INSERT OR IGNORE INTO owners (wallet) VALUES (?)").run(e.owner);
    const o = getOwner(db, e.owner);
    db.prepare("UPDATE owners SET lamports = ? WHERE wallet = ?").run((big(o.lamports) + e.ownerShare).toString(), e.owner);
  }
  return true;
}

export function recordTrade(db: DatabaseSync, t: TradeRow): boolean {
  const res = db
    .prepare("INSERT OR IGNORE INTO trades (sig, n, coinId, user, lamports, isBuy, ts, slot, week) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(t.sig, t.n, t.coinId, t.user, t.lamports, t.isBuy, t.ts, t.slot, t.week);
  return Number(res.changes) > 0;
}

export function tradesOfWeek(db: DatabaseSync, week: number): TradeRow[] {
  return db.prepare("SELECT * FROM trades WHERE week = ? ORDER BY ts, slot, sig, n").all(week) as unknown as TradeRow[];
}

export function getOwner(db: DatabaseSync, wallet: string): { wallet: string; lamports: string; paidLamports: string } {
  return (db.prepare("SELECT * FROM owners WHERE wallet = ?").get(wallet) as { wallet: string; lamports: string; paidLamports: string } | undefined) ?? { wallet, lamports: "0", paidLamports: "0" };
}

export function ownerBalance(db: DatabaseSync, wallet: string): { earned: bigint; paid: bigint; available: bigint } {
  const o = getOwner(db, wallet);
  return { earned: big(o.lamports), paid: big(o.paidLamports), available: big(o.lamports) - big(o.paidLamports) };
}

export function setOwnerPaid(db: DatabaseSync, wallet: string, paid: bigint) {
  db.prepare("INSERT OR IGNORE INTO owners (wallet) VALUES (?)").run(wallet);
  db.prepare("UPDATE owners SET paidLamports = ? WHERE wallet = ?").run(paid.toString(), wallet);
}

/** Fees attributed to a coin: total creator fees and each share. */
export function coinFees(db: DatabaseSync, coinId: string): { fees: bigint; launcher: bigint; pot: bigint; platform: bigint; events: number } {
  const rows = db.prepare("SELECT lamports, ownerShare, pot, platform FROM fee_events WHERE coinId = ?").all(coinId) as { lamports: string; ownerShare: string; pot: string; platform: string }[];
  const out = { fees: BigInt(0), launcher: BigInt(0), pot: BigInt(0), platform: BigInt(0), events: rows.length };
  for (const r of rows) {
    out.fees += big(r.lamports);
    out.launcher += big(r.ownerShare);
    out.pot += big(r.pot);
    out.platform += big(r.platform);
  }
  return out;
}

/** Pot share of fees credited to week `week`. */
export function potOfWeek(db: DatabaseSync, week: number): bigint {
  return (db.prepare("SELECT pot FROM fee_events WHERE potWeek = ?").all(week) as { pot: string }[]).reduce((s, r) => s + big(r.pot), BigInt(0));
}

// ───────────────────────────── kv

export function kvGet(db: DatabaseSync, k: string): string | null {
  return (db.prepare("SELECT v FROM kv WHERE k = ?").get(k) as { v: string } | undefined)?.v ?? null;
}

export function kvSet(db: DatabaseSync, k: string, v: string) {
  db.prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, v);
}
