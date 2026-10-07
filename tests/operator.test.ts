import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { ATA_PROGRAM, TOKEN_PROGRAM } from "../src/config/solana.ts";
import { clearChainCache } from "../src/server/chain.ts";
import { openDb } from "../src/server/db.ts";
import { PAYOUTS_CLOSED, listLedger, parseSecretKey, sendSol, sendToken } from "../src/server/operator.ts";
import { READ_METHODS, refusedMethod, relay } from "../src/server/rpc-relay.ts";
import { SYSTEM, mintData, startFakeRpc } from "./fake-rpc.ts";

const rpc = await startFakeRpc();
const operator = Keypair.generate();
const MINT = Keypair.generate().publicKey.toBase58();

before(() => {
  process.env.SOLANA_RPC_URL = rpc.url;
  process.env.SOLANA_CLUSTER = "devnet";
  rpc.state.accounts.set(operator.publicKey.toBase58(), { lamports: 5_000_000_000, owner: SYSTEM });
  rpc.state.accounts.set(MINT, { lamports: 1_461_600, owner: TOKEN_PROGRAM, data: mintData(6, BigInt(1e15)) });
});
beforeEach(() => clearChainCache());
after(() => rpc.close());

test("payouts refuse to run without OPERATOR_SECRET_KEY and record nothing", async () => {
  delete process.env.OPERATOR_SECRET_KEY;
  const db = openDb(":memory:");
  const sent = rpc.state.sent.length;
  assert.deepEqual(await sendSol(Keypair.generate().publicKey.toBase58(), BigInt(1000), undefined, db), { error: PAYOUTS_CLOSED });
  assert.deepEqual(await sendToken(Keypair.generate().publicKey.toBase58(), MINT, BigInt(1), undefined, db), { error: PAYOUTS_CLOSED });
  assert.equal(listLedger(db).length, 0);
  assert.equal(rpc.state.sent.length, sent);
});

test("the secret key parses from base58 and from a JSON byte array; garbage is null", () => {
  assert.equal(parseSecretKey(bs58.encode(operator.secretKey))?.publicKey.toBase58(), operator.publicKey.toBase58());
  assert.equal(parseSecretKey(JSON.stringify(Array.from(operator.secretKey)))?.publicKey.toBase58(), operator.publicKey.toBase58());
  assert.equal(parseSecretKey("not-a-key"), null);
  assert.equal(parseSecretKey(""), null);
});

test("sendSol signs a real transfer, waits for confirmation and records the signature", async () => {
  process.env.OPERATOR_SECRET_KEY = bs58.encode(operator.secretKey);
  const db = openDb(":memory:");
  const to = Keypair.generate().publicKey.toBase58();
  const result = await sendSol(to, BigInt(1_000_000), "test payout", db);
  assert.ok("sig" in result, JSON.stringify(result));
  assert.equal(result.status, "confirmed");
  const tx = Transaction.from(rpc.state.sent.at(-1)!.raw);
  assert.ok(tx.verifySignatures(), "operator signature is valid");
  assert.equal(tx.instructions[0].programId.toBase58(), SystemProgram.programId.toBase58());
  assert.equal(tx.instructions[0].data.readBigUInt64LE(4), BigInt(1_000_000));
  const [row] = listLedger(db);
  assert.equal(row.sig, result.sig);
  assert.equal(row.kind, "sol");
  assert.equal(row.to, to);
  assert.equal(row.amount, "1000000");
  assert.equal(row.cluster, "devnet");
  assert.equal(row.note, "test payout");
});

test("sendToken creates the recipient ATA (idempotent) and sends TransferChecked", async () => {
  process.env.OPERATOR_SECRET_KEY = bs58.encode(operator.secretKey);
  const db = openDb(":memory:");
  const to = Keypair.generate().publicKey.toBase58();
  const result = await sendToken(to, MINT, BigInt(42_000_000), undefined, db);
  assert.ok("sig" in result, JSON.stringify(result));
  const tx = Transaction.from(rpc.state.sent.at(-1)!.raw);
  assert.equal(tx.instructions[0].programId.toBase58(), ATA_PROGRAM);
  assert.deepEqual([...tx.instructions[0].data], [1]);
  assert.equal(tx.instructions[1].programId.toBase58(), TOKEN_PROGRAM);
  assert.equal(tx.instructions[1].data[0], 12);
  assert.equal(tx.instructions[1].data.readBigUInt64LE(1), BigInt(42_000_000));
  assert.equal(tx.instructions[1].data[9], 6);
  assert.equal(tx.instructions[0].keys[2].pubkey.toBase58(), new PublicKey(to).toBase58());
  assert.equal(listLedger(db)[0].mint, MINT);
});

test("rpc relay: read methods pass through to the upstream", async () => {
  rpc.state.accounts.set("Vote111111111111111111111111111111111111111", { lamports: 7, owner: SYSTEM });
  const res = await relay({ jsonrpc: "2.0", id: 9, method: "getBalance", params: ["Vote111111111111111111111111111111111111111"] }, rpc.url);
  assert.equal(res.status, 200);
  const j = (await res.json()) as { id: number; result: { value: number } };
  assert.equal(j.id, 9);
  assert.equal(j.result.value, 7);
});

test("rpc relay: writes and unknown methods are refused, even inside a batch", async () => {
  assert.equal(READ_METHODS.has("sendTransaction"), false);
  const sent = rpc.state.sent.length;
  const res = await relay({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: ["AA=="] }, rpc.url);
  assert.equal(res.status, 403);
  assert.equal(rpc.state.sent.length, sent);
  assert.equal(refusedMethod([{ method: "getBalance" }, { method: "requestAirdrop" }]), "requestAirdrop");
  assert.equal(refusedMethod([]), "batch");
  assert.equal(refusedMethod({ nope: true }), "invalid");
});

test("rpc relay: an upstream 429 is passed through as 429; a dead upstream is a 504", async () => {
  const limited = (async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
  const res = await relay({ jsonrpc: "2.0", id: 1, method: "getSlot" }, "http://upstream", limited);
  assert.equal(res.status, 429);
  const dead = (async () => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch;
  assert.equal((await relay({ jsonrpc: "2.0", id: 1, method: "getSlot" }, "http://upstream", dead)).status, 504);
});
