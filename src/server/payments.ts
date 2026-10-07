/**
 * Payments into the operator: one SystemProgram transfer from the payer to the operator plus an
 * SPL memo naming what it pays for. The server reads the confirmed transaction back from the chain
 * and trusts only what it finds there.
 */
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { MEMO_PROGRAM } from "../config/volumepad.ts";
import { LAMPORTS_PER_SOL } from "../config/solana.ts";
import { confirmTx, connection } from "./chain.ts";
import { HttpError } from "./errors.ts";

export function parseSolAmount(v: string | number | undefined, label = "Amount"): bigint {
  const s = String(v ?? "").trim();
  if (!s) return BigInt(0);
  if (!/^\d+(\.\d{1,9})?$/.test(s)) throw new HttpError(400, `${label} must be an amount in SOL, like 0.1.`);
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * BigInt(LAMPORTS_PER_SOL) + BigInt(frac.padEnd(9, "0"));
}

/** The unsigned transfer + memo the payer's wallet signs and sends. */
export function buildPaymentTx(payer: string, operator: string, lamports: bigint, memo: string, blockhash: string): Transaction {
  const from = new PublicKey(payer);
  const tx = new Transaction({ feePayer: from, recentBlockhash: blockhash });
  tx.add(SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(operator), lamports }));
  tx.add(new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM), keys: [{ pubkey: from, isSigner: true, isWritable: false }], data: Buffer.from(memo, "utf8") }));
  return tx;
}

export async function paymentTxBase64(payer: string, operator: string, lamports: bigint, memo: string): Promise<string> {
  const { blockhash } = await connection().getLatestBlockhash("confirmed");
  return buildPaymentTx(payer, operator, lamports, memo, blockhash).serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

/** Reads a confirmed transaction and returns the lamports `from` sent to `to`, requiring the exact memo. */
export async function readPayment(sig: string, from: string, to: string, memo: string): Promise<bigint> {
  const status = await confirmTx(sig, 45_000, 800);
  if (status !== "confirmed" && status !== "finalized") throw new HttpError(400, "The transfer is not confirmed.");
  const tx = await connection().getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  if (!tx || tx.meta?.err) throw new HttpError(400, "The transfer failed.");
  const msg = tx.transaction.message;
  const keys = msg.staticAccountKeys.map((k) => k.toBase58());
  let lamports = BigInt(0);
  let memoOk = false;
  for (const ix of msg.compiledInstructions) {
    const program = keys[ix.programIdIndex];
    const data = Buffer.from(ix.data);
    if (program === SystemProgram.programId.toBase58() && data.length === 12 && data.readUInt32LE(0) === 2) {
      const [src, dst] = ix.accountKeyIndexes.map((i) => keys[i]);
      if (src === from && dst === to) lamports += data.readBigUInt64LE(4);
    }
    if (program === MEMO_PROGRAM && data.toString("utf8") === memo) memoOk = true;
  }
  if (!memoOk) throw new HttpError(400, "That transfer is not for this request.");
  return lamports;
}
