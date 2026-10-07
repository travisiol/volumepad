/**
 * Every trade burns $VOLUMEPAD. The platform share of each launched coin's creator fees (PLATFORM_SHARE %,
 * attributed per TradeEvent in rewards.ts) is held by the operator until it is collected from
 * pump.fun; then `runBurn()` spends it: Jupiter quote (SOL → $VOLUMEPAD) → swap transaction → simulate →
 * send → burn exactly what the swap added to the operator's $VOLUMEPAD balance. Both legs go on the ledger.
 * Before NEXT_PUBLIC_MINT is set nothing is bought: the share stays held and is shown as held.
 */
import type { DatabaseSync } from "node:sqlite";
import { VersionedTransaction } from "@solana/web3.js";
import { ENV, MIN_BURN_LAMPORTS } from "../config/volumepad.ts";
import { WSOL_MINT } from "../config/solana.ts";
import { clearChainCache, confirmTx, connection, tokenBalance } from "./chain.ts";
import { db as defaultDb } from "./db.ts";
import { burnToken, operatorKeypair, recordPayout } from "./operator.ts";
import { kvGet, kvSet } from "./store.ts";

const ZERO = BigInt(0);
const big = (v: string | null) => BigInt(v ?? "0");

export type ActionResult = { sig: string; spent: bigint; bought: bigint; detail: string; burnSig?: string } | { error: string };

/** Platform share attributed so far, collected so far, spent on $VOLUMEPAD so far, and what is held. */
export function burnBook(db: DatabaseSync = defaultDb()): { platform: bigint; claimed: bigint; spent: bigint; burned: bigint; held: bigint; burnable: bigint } {
  const platform = (db.prepare("SELECT platform FROM fee_events").all() as { platform: string }[]).reduce((s, r) => s + BigInt(r.platform), ZERO);
  const claimed = big(kvGet(db, "claimedLamports"));
  const spent = big(kvGet(db, "burnSpentLamports"));
  const burned = big(kvGet(db, "burnedUnits"));
  const cap = platform < claimed ? platform : claimed;
  return { platform, claimed, spent, burned, held: platform - spent, burnable: cap > spent ? cap - spent : ZERO };
}

async function simulateOk(tx: VersionedTransaction): Promise<string | null> {
  const sim = await connection().simulateTransaction(tx, { commitment: "confirmed" });
  return sim.value.err ? `Simulation failed: ${JSON.stringify(sim.value.err).slice(0, 120)}` : null;
}

export async function buybackBurn(mint: string, lamports: bigint, db: DatabaseSync, fetcher: typeof fetch = fetch): Promise<ActionResult> {
  const operator = operatorKeypair();
  if (!operator) return { error: "No operator key." };
  const owner = operator.publicKey.toBase58();
  const api = ENV.jupiter();
  const quote = await fetcher(`${api}/swap/v1/quote?inputMint=${WSOL_MINT}&outputMint=${mint}&amount=${lamports}&slippageBps=300`, { signal: AbortSignal.timeout(10_000) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (!quote) return { error: "No Jupiter route right now." };
  const swap = (await fetcher(`${api}/swap/v1/swap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ quoteResponse: quote, userPublicKey: owner, wrapAndUnwrapSol: true }),
    signal: AbortSignal.timeout(15_000),
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)) as { swapTransaction?: string } | null;
  if (!swap?.swapTransaction) return { error: "Jupiter returned no swap transaction." };
  const tx = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, "base64"));
  tx.sign([operator]);
  const simError = await simulateOk(tx);
  if (simError) return { error: simError };
  const before = (await tokenBalance(owner, mint).catch(() => ({ amount: ZERO }))).amount;
  const sig = await connection().sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  const status = await confirmTx(sig);
  if (status === "failed" || status === "pending") return { error: `The swap is ${status}.` };
  recordPayout(db, { kind: "buy", to: owner, mint, amount: lamports, sig, note: "$VOLUMEPAD bought with the platform share of creator fees" });
  clearChainCache();
  const after = (await tokenBalance(owner, mint)).amount;
  const bought = after - before;
  if (bought <= ZERO) return { sig, spent: lamports, bought: ZERO, detail: "Swap landed; nothing to burn." };
  const burned = await burnToken(mint, bought, "$VOLUMEPAD burned", db);
  if (!("sig" in burned)) return { sig, spent: lamports, bought, detail: "Bought; the burn is retried on the next sweep." };
  return { sig, spent: lamports, bought, detail: `Bought and burned ${bought.toString()} base units`, burnSig: burned.sig };
}

export type BurnStep = { skipped: string } | ActionResult;

/** Spends the burnable platform share on $VOLUMEPAD and burns it. Idempotent bookkeeping in kv. */
export async function runBurn(db: DatabaseSync = defaultDb(), fetcher: typeof fetch = fetch): Promise<BurnStep> {
  const mint = ENV.platformMint();
  if (!mint) return { skipped: "held: $VOLUMEPAD mint not set" };
  if (!operatorKeypair()) return { skipped: "no operator key" };
  const { burnable, spent, burned } = burnBook(db);
  if (burnable < MIN_BURN_LAMPORTS) return { skipped: "under the burn minimum" };
  const r = await buybackBurn(mint, burnable, db, fetcher);
  if ("sig" in r) {
    kvSet(db, "burnSpentLamports", (spent + r.spent).toString());
    if (r.burnSig) kvSet(db, "burnedUnits", (burned + r.bought).toString());
  }
  return r;
}
