/**
 * pump.fun Anchor event decoding from transaction logs ("Program data: <base64>").
 * Ported from donchain.snipe `src/solana/pump/events.js` (decodeEvent / parseEventLogs): same
 * discriminators, same TradeEvent field order, `creator_fee` read after `creator` + `creator_fee_basis_points`.
 */
import { PublicKey } from "@solana/web3.js";

const DISC = { trade: "bddb7fd34ee661ee", collectCreatorFee: "7a027f010ebf0caf" } as const;

export interface TradeEvent {
  kind: "trade";
  mint: string;
  solAmount: bigint;
  tokenAmount: bigint;
  isBuy: boolean;
  user: string;
  timestamp: bigint;
  fee: bigint;
  creator: string;
  creatorFee: bigint;
}

export interface CollectCreatorFeeEvent {
  kind: "collectCreatorFee";
  timestamp: bigint;
  creator: string;
  amount: bigint;
}

export type PumpEvent = TradeEvent | CollectCreatorFeeEvent;

class Reader {
  o = 0;
  b: Buffer;
  constructor(b: Buffer) {
    this.b = b;
  }
  u64() {
    const v = this.b.readBigUInt64LE(this.o);
    this.o += 8;
    return v;
  }
  i64() {
    const v = this.b.readBigInt64LE(this.o);
    this.o += 8;
    return v;
  }
  bool() {
    return this.b[this.o++] === 1;
  }
  pubkey() {
    const v = new PublicKey(this.b.subarray(this.o, this.o + 32)).toBase58();
    this.o += 32;
    return v;
  }
}

export function decodeEvent(b64: string): PumpEvent | null {
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    return null;
  }
  if (buf.length < 8) return null;
  const disc = buf.subarray(0, 8).toString("hex");
  const r = new Reader(buf.subarray(8));
  try {
    if (disc === DISC.collectCreatorFee) {
      const timestamp = r.i64();
      const creator = r.pubkey();
      return { kind: "collectCreatorFee", timestamp, creator, amount: r.u64() };
    }
    if (disc === DISC.trade) {
      const mint = r.pubkey();
      const solAmount = r.u64();
      const tokenAmount = r.u64();
      const isBuy = r.bool();
      const user = r.pubkey();
      const timestamp = r.i64();
      r.u64(); // virtual_sol_reserves
      r.u64(); // virtual_token_reserves
      r.u64(); // real_sol_reserves
      r.u64(); // real_token_reserves
      r.pubkey(); // fee_recipient
      r.u64(); // fee_basis_points
      const fee = r.u64();
      const creator = r.pubkey();
      r.u64(); // creator_fee_basis_points
      const creatorFee = r.u64();
      return { kind: "trade", mint, solAmount, tokenAmount, isBuy, user, timestamp, fee, creator, creatorFee };
    }
  } catch {
    return null;
  }
  return null;
}

export function parseEventLogs(logs: readonly string[]): PumpEvent[] {
  const out: PumpEvent[] = [];
  for (const line of logs) {
    const i = line.indexOf("Program data: ");
    if (i === -1) continue;
    const e = decodeEvent(line.slice(i + 14).trim());
    if (e) out.push(e);
  }
  return out;
}

/** Encodes a TradeEvent the way the program logs it (tests and the local rig only). */
export function encodeTradeEvent(e: { mint: string; user: string; creator: string; solAmount: bigint; creatorFee: bigint; isBuy?: boolean; timestamp?: number }): string {
  const parts: Buffer[] = [Buffer.from(DISC.trade, "hex")];
  const u64 = (n: bigint) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(n);
    return b;
  };
  const key = (k: string) => new PublicKey(k).toBuffer();
  parts.push(key(e.mint), u64(e.solAmount), u64(BigInt(1_000_000)), Buffer.from([e.isBuy === false ? 0 : 1]), key(e.user), u64(BigInt(e.timestamp ?? 1_759_000_000)));
  parts.push(u64(BigInt(0)), u64(BigInt(0)), u64(BigInt(0)), u64(BigInt(0)), key(e.user), u64(BigInt(95)), u64((e.solAmount * BigInt(95)) / BigInt(10_000)));
  parts.push(key(e.creator), u64(BigInt(30)), u64(e.creatorFee));
  return `Program data: ${Buffer.concat(parts).toString("base64")}`;
}
