import type { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { signInMessage } from "../lib/signin-message.ts";
import { isBase58Address } from "../lib/format.ts";
import { HttpError } from "./errors.ts";

/** A nonce lives 10 minutes and is spent once. */
export const NONCE_TTL_MS = 10 * 60_000;

export function issueNonce(db: DatabaseSync, now = Date.now()): string {
  const nonce = randomBytes(16).toString("hex");
  db.prepare("DELETE FROM nonces WHERE created_at < ?").run(now - NONCE_TTL_MS);
  db.prepare("INSERT INTO nonces (nonce, created_at) VALUES (?, ?)").run(nonce, now);
  return nonce;
}

/** Deletes the nonce; true only if it existed and was fresh. A nonce can never be used twice. */
export function consumeNonce(db: DatabaseSync, nonce: string, now = Date.now()): boolean {
  const row = db.prepare("DELETE FROM nonces WHERE nonce = ? RETURNING created_at").get(nonce) as { created_at: number } | undefined;
  return Boolean(row && row.created_at >= now - NONCE_TTL_MS);
}

/** ed25519 check of a base58 signature over the rebuilt sign-in message. */
export function verifySignature(address: string, message: string, signatureB58: string): boolean {
  try {
    const signature = bs58.decode(signatureB58);
    const publicKey = bs58.decode(address);
    if (signature.length !== 64 || publicKey.length !== 32) return false;
    return nacl.sign.detached.verify(new TextEncoder().encode(message), signature, publicKey);
  } catch {
    return false;
  }
}

export interface SignInRequest {
  host: string;
  address?: string;
  nonce?: string;
  issuedAt?: string;
  signature?: string;
}

/** Spend the nonce, rebuild the message server-side, check the signature. Returns the address. */
export function verifySignIn(db: DatabaseSync, input: SignInRequest): string {
  const { address, nonce, issuedAt, signature, host } = input;
  if (!isBase58Address(address)) throw new HttpError(400, "Invalid wallet address.");
  if (!nonce || !issuedAt || !signature) throw new HttpError(400, "Incomplete sign-in request.");
  // The nonce is spent before the signature is checked, so it can never be tried twice.
  if (!consumeNonce(db, nonce)) throw new HttpError(401, "That sign-in request expired. Try again.");
  const message = signInMessage({ host, address, nonce, issuedAt });
  if (!verifySignature(address, message, signature)) throw new HttpError(401, "The signature does not match this wallet.");
  return address;
}
