import { DatabaseSync } from "node:sqlite";
import { accessSync, constants, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * One SQLite file (node:sqlite). Path: `VOLUMEPAD_DB_PATH`, else `./data/volumepad.db`, else the OS temp
 * dir when the disk is read-only (Vercel: /tmp, per instance and ephemeral).
 */
export function resolveDbPath(): { path: string; persistent: boolean } {
  const explicit = process.env["VOLUMEPAD_DB_PATH"]?.trim();
  const candidates = explicit ? [explicit] : [join(process.cwd(), "data", "volumepad.db")];
  for (const file of candidates) {
    try {
      mkdirSync(/* turbopackIgnore: true */ dirname(file), { recursive: true });
      accessSync(/* turbopackIgnore: true */ dirname(file), constants.W_OK);
      return { path: file, persistent: !process.env["VERCEL"] };
    } catch {
      // fall through to the temp dir
    }
  }
  const dir = join(tmpdir(), "volumepad");
  mkdirSync(dir, { recursive: true });
  return { path: join(dir, "volumepad.db"), persistent: false };
}

export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, "to" TEXT, mint TEXT, amount TEXT NOT NULL,
    sig TEXT NOT NULL, at INTEGER NOT NULL, note TEXT, cluster TEXT NOT NULL DEFAULT 'mainnet-beta', coinId TEXT
  );
  CREATE INDEX IF NOT EXISTS ledger_at ON ledger(at DESC);
  CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL, createdAt INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS launches (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, ticker TEXT NOT NULL, setup TEXT NOT NULL,
    imageId TEXT NOT NULL, launcher TEXT NOT NULL, firstBuyLamports TEXT NOT NULL DEFAULT '0', status TEXT NOT NULL,
    paySig TEXT, mint TEXT, sig TEXT, error TEXT, createdAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS coins (
    id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, mint TEXT UNIQUE NOT NULL, name TEXT NOT NULL, ticker TEXT NOT NULL,
    description TEXT NOT NULL, imageId TEXT, owner TEXT NOT NULL, creator TEXT, launchSig TEXT, website TEXT, xUrl TEXT,
    telegram TEXT, createdAt INTEGER NOT NULL, lastSig TEXT, pendingNewest TEXT, beforeSig TEXT
  );
  CREATE TABLE IF NOT EXISTS fee_events (
    mint TEXT NOT NULL, sig TEXT NOT NULL, slot INTEGER NOT NULL, lamports TEXT NOT NULL, coinId TEXT, owner TEXT,
    ownerShare TEXT NOT NULL, pot TEXT NOT NULL DEFAULT '0', platform TEXT NOT NULL, potWeek INTEGER NOT NULL DEFAULT 0,
    ts INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, PRIMARY KEY (mint, sig)
  );
  CREATE INDEX IF NOT EXISTS fee_week ON fee_events(potWeek);
  CREATE TABLE IF NOT EXISTS trades (
    sig TEXT NOT NULL, n INTEGER NOT NULL, coinId TEXT NOT NULL, user TEXT NOT NULL, lamports TEXT NOT NULL,
    isBuy INTEGER NOT NULL, ts INTEGER NOT NULL, slot INTEGER NOT NULL, week INTEGER NOT NULL, PRIMARY KEY (sig, n)
  );
  CREATE INDEX IF NOT EXISTS trades_week ON trades(week, coinId);
  CREATE TABLE IF NOT EXISTS owners (wallet TEXT PRIMARY KEY, lamports TEXT NOT NULL DEFAULT '0', paidLamports TEXT NOT NULL DEFAULT '0');
  CREATE TABLE IF NOT EXISTS weeks (
    week INTEGER PRIMARY KEY, startAt INTEGER NOT NULL, endAt INTEGER NOT NULL, potIn TEXT NOT NULL, rolloverIn TEXT NOT NULL,
    pot TEXT NOT NULL, prizes TEXT NOT NULL, rolloverOut TEXT NOT NULL, standings TEXT NOT NULL, settledAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS prizes (
    week INTEGER NOT NULL, rank INTEGER NOT NULL, coinId TEXT NOT NULL, wallet TEXT NOT NULL, lamports TEXT NOT NULL,
    status TEXT NOT NULL, sig TEXT, error TEXT, paidAt INTEGER, PRIMARY KEY (week, rank)
  );
  CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`;

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA);
  return db;
}

const holder = globalThis as unknown as { __volumepadDb?: { db: DatabaseSync; path: string; persistent: boolean } };

/** The process-wide database (survives dev hot reloads). */
export function db(): DatabaseSync {
  if (!holder.__volumepadDb) {
    const { path, persistent } = resolveDbPath();
    holder.__volumepadDb = { db: openDb(path), path, persistent };
  }
  return holder.__volumepadDb.db;
}

export function dbInfo(): { path: string; persistent: boolean } {
  db();
  const { path, persistent } = holder.__volumepadDb!;
  return { path, persistent };
}
