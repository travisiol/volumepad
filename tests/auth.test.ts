import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { signInMessage } from "../src/lib/signin-message.ts";
import { NONCE_TTL_MS, issueNonce, verifySignIn } from "../src/server/auth.ts";
import { openDb } from "../src/server/db.ts";
import { HttpError } from "../src/server/errors.ts";
import { assertBalance } from "../src/server/gate.ts";

const HOST = "localhost:3965";

function signed(kp: Keypair, nonce: string, issuedAt: string, signer: Keypair = kp) {
  const address = kp.publicKey.toBase58();
  const message = signInMessage({ host: HOST, address, nonce, issuedAt });
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), signer.secretKey));
  return { host: HOST, address, nonce, issuedAt, signature };
}

const status = (fn: () => unknown) => {
  try {
    fn();
    return 200;
  } catch (e) {
    return (e as HttpError).status;
  }
};

test("a good signature opens a session for that address", () => {
  const db = openDb(":memory:");
  const kp = Keypair.generate();
  const nonce = issueNonce(db);
  assert.equal(verifySignIn(db, signed(kp, nonce, new Date().toISOString())), kp.publicKey.toBase58());
});

test("a signature from another key is refused (401)", () => {
  const db = openDb(":memory:");
  const kp = Keypair.generate();
  const nonce = issueNonce(db);
  assert.equal(status(() => verifySignIn(db, signed(kp, nonce, new Date().toISOString(), Keypair.generate()))), 401);
});

test("a message signed for another host is refused", () => {
  const db = openDb(":memory:");
  const kp = Keypair.generate();
  const nonce = issueNonce(db);
  const req = signed(kp, nonce, new Date().toISOString());
  assert.equal(status(() => verifySignIn(db, { ...req, host: "evil.example" })), 401);
});

test("a nonce works once: the replay is refused", () => {
  const db = openDb(":memory:");
  const kp = Keypair.generate();
  const req = signed(kp, issueNonce(db), new Date().toISOString());
  assert.equal(status(() => verifySignIn(db, req)), 200);
  assert.equal(status(() => verifySignIn(db, req)), 401);
});

test("an expired nonce and a malformed address are refused", () => {
  const db = openDb(":memory:");
  const kp = Keypair.generate();
  const old = issueNonce(db, Date.now() - NONCE_TTL_MS - 1000);
  assert.equal(status(() => verifySignIn(db, signed(kp, old, new Date().toISOString()))), 401);
  assert.equal(status(() => verifySignIn(db, { host: HOST, address: "0xabc", nonce: "n", issuedAt: "t", signature: "s" })), 400);
});

test("balance gate: refuses below the minimum or without a mint, passes at or above it", async () => {
  const read = async () => BigInt(100);
  const code = async (p: Promise<unknown>) => p.then(() => 200, (e: HttpError) => e.status);
  assert.equal(await code(assertBalance("A", "M", BigInt(101), read)), 403);
  assert.equal(await code(assertBalance("A", null, BigInt(1), read)), 403);
  assert.equal(await assertBalance("A", "M", BigInt(100), read), BigInt(100));
  assert.equal(await assertBalance("A", null, BigInt(0), read), BigInt(0));
});
