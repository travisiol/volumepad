/**
 * The operator wallet: one Keypair from `OPERATOR_SECRET_KEY` (base58 or a JSON byte array, as
 * `solana-keygen` writes it). Every payout is sent, confirmed by polling, and written to the
 * sqlite `ledger` table with its signature.
 *
 * Serverless (Vercel): a payout must finish inside one invocation. Call it from a route handler
 * with `export const maxDuration = 60`, or schedule it with `after(() => sendSol(...))` from
 * `next/server` so the response returns first — never from a background loop or an un-awaited
 * promise, which the platform freezes as soon as the response is sent.
 */
import type { DatabaseSync } from "node:sqlite";
import bs58 from "bs58";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { ATA_PROGRAM, SYSTEM_PROGRAM, serverCluster } from "../config/solana.ts";
import { ataAddress, confirmTx, connection, mintInfo } from "./chain.ts";
import { db as defaultDb } from "./db.ts";
import { MEMO_PROGRAM } from "../config/volumepad.ts";

export const PAYOUTS_CLOSED = "Payouts are not open yet.";

export type PayoutResult = { sig: string; status: string } | { error: string };

export interface LedgerRow {
  id: number;
  kind: string;
  to: string | null;
  mint: string | null;
  amount: string;
  sig: string;
  at: number;
  note: string | null;
  cluster: string;
  coinId: string | null;
}

/** Parses base58 or a JSON array. Returns null when unset or malformed; never logs the value. */
export function parseSecretKey(raw: string | undefined | null): Keypair | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const bytes = value.startsWith("[") ? Uint8Array.from(JSON.parse(value) as number[]) : bs58.decode(value);
    if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
    if (bytes.length === 32) return Keypair.fromSeed(bytes);
    return null;
  } catch {
    return null;
  }
}

export function operatorKeypair(): Keypair | null {
  return parseSecretKey(process.env["OPERATOR_SECRET_KEY"]);
}

/** Public address of the operator, or null. Safe to show. */
export function operatorAddress(): string | null {
  return operatorKeypair()?.publicKey.toBase58() ?? null;
}

export function recordPayout(
  database: DatabaseSync,
  row: { kind: string; to: string | null; mint: string | null; amount: bigint | string; sig: string; note?: string | null; cluster?: string; coinId?: string | null },
): number {
  const result = database
    .prepare('INSERT INTO ledger (kind, "to", mint, amount, sig, at, note, cluster, coinId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(row.kind, row.to, row.mint, String(row.amount), row.sig, Date.now(), row.note ?? null, row.cluster ?? serverCluster(), row.coinId ?? null);
  return Number(result.lastInsertRowid);
}

export function listLedger(database: DatabaseSync = defaultDb(), limit = 100): LedgerRow[] {
  return database.prepare('SELECT id, kind, "to", mint, amount, sig, at, note, cluster, coinId FROM ledger ORDER BY at DESC, id DESC LIMIT ?').all(limit) as unknown as LedgerRow[];
}

// ───────────────────────────── SPL instructions (no spl-token dependency)

function u64(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}

/** ATA program `CreateIdempotent` (instruction 1): no-op when the account already exists. */
export function createAtaIdempotentIx(payer: PublicKey, ata: PublicKey, owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey) {
  return new TransactionInstruction({
    programId: new PublicKey(ATA_PROGRAM),
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(SYSTEM_PROGRAM), isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

/** Token `TransferChecked` (12): works for Token and Token-2022. */
export function transferCheckedIx(source: PublicKey, mint: PublicKey, dest: PublicKey, owner: PublicKey, amount: bigint, decimals: number, tokenProgram: PublicKey) {
  return new TransactionInstruction({
    programId: tokenProgram,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([12]), u64(amount), Buffer.from([decimals])]),
  });
}

/** Token `BurnChecked` (15). */
export function burnCheckedIx(account: PublicKey, mint: PublicKey, owner: PublicKey, amount: bigint, decimals: number, tokenProgram: PublicKey) {
  return new TransactionInstruction({
    programId: tokenProgram,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([15]), u64(amount), Buffer.from([decimals])]),
  });
}

// ───────────────────────────── sending

export async function sendAndRecord(
  operator: Keypair,
  instructions: TransactionInstruction[],
  row: { kind: string; to: string | null; mint: string | null; amount: bigint; note?: string | null; coinId?: string | null },
  database: DatabaseSync,
): Promise<PayoutResult> {
  const conn = connection();
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: operator.publicKey, blockhash, lastValidBlockHeight }).add(...instructions);
  tx.sign(operator);
  // Simulated first: a transfer the cluster would refuse is never sent.
  const sim = await conn.simulateTransaction(new VersionedTransaction(tx.compileMessage()), { sigVerify: false, commitment: "confirmed" });
  if (sim.value.err) return { error: "The transaction failed in simulation." };
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  const status = await confirmTx(sig);
  if (status === "failed") return { error: "The transaction failed on chain." };
  recordPayout(database, { ...row, sig, note: row.note ?? (status === "pending" ? "sent, not yet confirmed" : null) });
  return { sig, status };
}

export async function sendSol(to: string, lamports: bigint, note?: string, database: DatabaseSync = defaultDb(), memo?: string, kind = "sol", coinId: string | null = null): Promise<PayoutResult> {
  const operator = operatorKeypair();
  if (!operator) return { error: PAYOUTS_CLOSED };
  if (lamports <= BigInt(0)) return { error: "Nothing to send." };
  const ix = SystemProgram.transfer({ fromPubkey: operator.publicKey, toPubkey: new PublicKey(to), lamports });
  return sendAndRecord(operator, memo ? [ix, memoIx(memo, operator.publicKey)] : [ix], { kind, to, mint: null, amount: lamports, note, coinId }, database);
}

/** Sends `amount` base units of `mint`; creates the recipient's ATA when it is missing. */
export async function sendToken(to: string, mint: string, amount: bigint, note?: string, database: DatabaseSync = defaultDb()): Promise<PayoutResult> {
  const operator = operatorKeypair();
  if (!operator) return { error: PAYOUTS_CLOSED };
  if (amount <= BigInt(0)) return { error: "Nothing to send." };
  const { program, decimals } = await mintInfo(mint);
  const tokenProgram = new PublicKey(program);
  const m = new PublicKey(mint);
  const owner = new PublicKey(to);
  const source = ataAddress(operator.publicKey, m, tokenProgram);
  const dest = ataAddress(owner, m, tokenProgram);
  return sendAndRecord(
    operator,
    [createAtaIdempotentIx(operator.publicKey, dest, owner, m, tokenProgram), transferCheckedIx(source, m, dest, operator.publicKey, amount, decimals, tokenProgram)],
    { kind: "token", to, mint, amount, note },
    database,
  );
}

/** Burns `amount` base units of `mint` held by the operator. */
export async function burnToken(mint: string, amount: bigint, note?: string, database: DatabaseSync = defaultDb()): Promise<PayoutResult> {
  const operator = operatorKeypair();
  if (!operator) return { error: PAYOUTS_CLOSED };
  if (amount <= BigInt(0)) return { error: "Nothing to burn." };
  const { program, decimals } = await mintInfo(mint);
  const tokenProgram = new PublicKey(program);
  const m = new PublicKey(mint);
  const account = ataAddress(operator.publicKey, m, tokenProgram);
  return sendAndRecord(operator, [burnCheckedIx(account, m, operator.publicKey, amount, decimals, tokenProgram)], { kind: "burn", to: null, mint, amount, note }, database);
}

/** SPL Memo v2 instruction (the memo text is public on chain). */
export function memoIx(text: string, signer: PublicKey) {
  return new TransactionInstruction({
    programId: new PublicKey(MEMO_PROGRAM),
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
    data: Buffer.from(text, "utf8"),
  });
}
