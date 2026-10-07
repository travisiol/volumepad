import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { LAUNCHES_PER_DAY, rules, shares, splitFee, weekEnd, weekOf, weekStart } from "../src/config/volumepad.ts";
import { burnBook } from "../src/server/burn.ts";
import { clearChainCache, connection, curveCreatorVault } from "../src/server/chain.ts";
import { openDb } from "../src/server/db.ts";
import type { HttpError } from "../src/server/errors.ts";
import { LAUNCH_CLOSED, prepareLaunch, submitLaunch } from "../src/server/launch.ts";
import type { LaunchInput } from "../src/server/launch.ts";
import { listLedger } from "../src/server/operator.ts";
import { bondingCurvePda } from "../src/server/pump/instructions.ts";
import { encodeTradeEvent } from "../src/server/pump/events.ts";
import { attribute, claim, withdraw } from "../src/server/sweep.ts";
import { insertCoin, kvGet, ownerBalance, potOfWeek } from "../src/server/store.ts";
import type { NewCoin } from "../src/server/store.ts";
import { runTick } from "../src/server/tick.ts";
import { getWeek, openPot, payPrizes, prizesOf, settle, settleDue, splitPot, standings } from "../src/server/week.ts";
import { SYSTEM, startFakeRpc } from "./fake-rpc.ts";

process.env.VOLUMEPAD_DB_PATH = join(tmpdir(), `volumepad-test-${process.pid}.db`);
const rpc = await startFakeRpc();
const operator = Keypair.generate();
const OP = operator.publicKey.toBase58();
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const SOL = BigInt(1_000_000_000);
const MON = Date.parse("2026-10-05T00:00:00Z"); // a Monday
const W = weekOf(MON);

const code = async (p: Promise<unknown>) => p.then(() => 200, (e: HttpError) => e.status ?? 500);

before(() => {
  process.env.SOLANA_RPC_URL = rpc.url;
  process.env.SOLANA_CLUSTER = "devnet";
  process.env.OPERATOR_SECRET_KEY = bs58.encode(operator.secretKey);
  for (const k of ["NEXT_PUBLIC_MINT", "LAUNCHER_SHARE", "POT_SHARE", "PLATFORM_SHARE", "WALLET_CAP_SOL", "MIN_TRADERS", "PRIZE_SPLIT", "WEEK_HOURS", "WEEK_ANCHOR", "CLOCK_OFFSET_FILE"]) delete process.env[k];
  rpc.state.accounts.set(OP, { lamports: 500 * 1_000_000_000, owner: SYSTEM });
});
beforeEach(() => clearChainCache());
after(async () => {
  await rpc.close();
});

const coin = (over: Partial<NewCoin> = {}): NewCoin => ({
  mint: Keypair.generate().publicKey.toBase58(),
  name: "Frog Taxes",
  ticker: "FROG",
  description: "A frog who files everyone's taxes.",
  imageId: null,
  owner: Keypair.generate().publicKey.toBase58(),
  creator: OP,
  launchSig: null,
  website: null,
  xUrl: null,
  telegram: null,
  ...over,
});

let seq = 0;
/** One curve trade of `lamports` SOL by `user` at `atMs`, with a creator fee of 30 bps (pump.fun's curve rate). */
function trade(mint: string, user: string, lamports: bigint, atMs: number, creator = OP) {
  const curve = bondingCurvePda(new PublicKey(mint)).toBase58();
  const list = rpc.state.sigsFor.get(curve) ?? [];
  const sig = bs58.encode(createHash("sha512").update(`t${seq++}:${mint}`).digest());
  rpc.state.txs.set(sig, { slot: 2000 + seq, logs: ["Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]", encodeTradeEvent({ mint, user, creator, solAmount: lamports, creatorFee: (lamports * BigInt(30)) / BigInt(10_000), timestamp: Math.floor(atMs / 1000) })] });
  list.unshift(sig);
  rpc.state.sigsFor.set(curve, list);
}
const wallets = (n: number) => Array.from({ length: n }, () => Keypair.generate().publicKey.toBase58());
/** `n` distinct wallets each trading `each` lamports, one minute apart from `start`. */
function crowd(mint: string, n: number, each: bigint, start: number) {
  wallets(n).forEach((u, i) => trade(mint, u, each, start + i * 60_000));
}

// ───────────────────────── config

test("fee split 60 / 30 / 10, platform and pot rounded down, the launcher keeps the dust; bad env falls back", () => {
  assert.deepEqual(shares(), { launcher: 60, pot: 30, platform: 10 });
  assert.deepEqual(splitFee(BigInt(1000)), { launcher: BigInt(600), pot: BigInt(300), platform: BigInt(100) });
  assert.deepEqual(splitFee(BigInt(7)), { launcher: BigInt(5), pot: BigInt(2), platform: BigInt(0) });
  process.env.POT_SHARE = "50";
  assert.deepEqual(shares(), { launcher: 60, pot: 30, platform: 10 }, "60 + 50 + 10 ≠ 100 → defaults");
  process.env.LAUNCHER_SHARE = "40";
  assert.deepEqual(shares(), { launcher: 40, pot: 50, platform: 10 });
  delete process.env.POT_SHARE;
  delete process.env.LAUNCHER_SHARE;
  const r = rules();
  assert.equal(r.walletCap, BigInt(25) * SOL);
  assert.equal(r.minTraders, 25);
  assert.deepEqual(r.prizes, [50, 30, 20]);
  assert.equal(new Date(weekStart(W)).toISOString(), "2026-10-05T00:00:00.000Z", "weeks start Monday 00:00 UTC");
  assert.equal(new Date(weekEnd(W) - 1).toISOString(), "2026-10-11T23:59:59.999Z", "and end Sunday 23:59:59 UTC");
});

// ───────────────────────── attribution

test("attribution: each TradeEvent's creator fee split launcher / pot / platform; idempotent; other creators' fees ignored; withdraw", async () => {
  const db = openDb(":memory:");
  const c = insertCoin(db, coin());
  for (let i = 0; i < 4; i++) trade(c.mint, Keypair.generate().publicKey.toBase58(), BigInt(10) * SOL, MON + 3_600_000 + i);
  trade(c.mint, Keypair.generate().publicKey.toBase58(), BigInt(10) * SOL, MON + 3_700_000, Keypair.generate().publicKey.toBase58());
  const r = await attribute(db);
  assert.equal(r.trades, 5, "every trade is recorded for volume");
  assert.equal(r.events, 4, "the fee of a coin whose creator is not the operator is not ours");
  const fee = (BigInt(10) * SOL * BigInt(30)) / BigInt(10_000); // 0.03 SOL
  assert.equal(r.launcherLamports, (fee * BigInt(4) * BigInt(60)) / BigInt(100));
  assert.equal(r.potLamports, (fee * BigInt(4) * BigInt(30)) / BigInt(100));
  assert.equal(r.platformLamports, (fee * BigInt(4) * BigInt(10)) / BigInt(100));
  assert.equal(potOfWeek(db, W), r.potLamports, "pot share credited to the week of the trade");
  assert.equal(burnBook(db).held, r.platformLamports, "platform share held until NEXT_PUBLIC_MINT is set");
  const again = await attribute(db);
  assert.equal(again.events + again.trades, 0);
  const w = await withdraw(c.owner, db, async () => ({ sig: "paySig", status: "confirmed" }));
  assert.equal(w.lamports, r.launcherLamports.toString());
  assert.equal(ownerBalance(db, c.owner).available, BigInt(0));
  assert.equal(await code(withdraw(c.owner, db, async () => ({ sig: "x", status: "confirmed" }))), 400, "nothing left to take twice");
});

// ───────────────────────── counted volume

test("counted volume: one wallet counts at most 25 SOL per coin per week; the excess is shown as capped", async () => {
  const db = openDb(":memory:");
  const c = insertCoin(db, coin());
  const wash = Keypair.generate().publicKey.toBase58();
  for (let i = 0; i < 4; i++) trade(c.mint, wash, BigInt(10) * SOL, MON + 1000 * i); // 40 SOL
  const honest = Keypair.generate().publicKey.toBase58();
  trade(c.mint, honest, BigInt(3) * SOL, MON + 9000);
  await attribute(db);
  const [s] = standings(db, W, rules(), OP);
  assert.equal(s.raw, (BigInt(43) * SOL).toString());
  assert.equal(s.counted, (BigInt(28) * SOL).toString());
  assert.equal(s.capped, (BigInt(15) * SOL).toString());
  assert.equal(s.cappedWallets, 1);
  assert.equal(s.traders, 2);
  // a new week resets the cap
  trade(c.mint, wash, BigInt(10) * SOL, weekEnd(W) + 1000);
  await attribute(db);
  assert.equal(standings(db, W + 1, rules(), OP)[0].counted, (BigInt(10) * SOL).toString());
});

test("launcher and operator trades are not counted (nor as traders)", async () => {
  const db = openDb(":memory:");
  const c = insertCoin(db, coin());
  trade(c.mint, c.owner, BigInt(20) * SOL, MON + 1);
  trade(c.mint, OP, BigInt(5) * SOL, MON + 2);
  trade(c.mint, Keypair.generate().publicKey.toBase58(), BigInt(1) * SOL, MON + 3);
  await attribute(db);
  const [s] = standings(db, W, rules(), OP);
  assert.equal(s.raw, (BigInt(26) * SOL).toString());
  assert.equal(s.excluded, (BigInt(25) * SOL).toString());
  assert.equal(s.counted, SOL.toString());
  assert.equal(s.traders, 1);
});

test("a coin needs 25 distinct counted wallets to rank", async () => {
  const db = openDb(":memory:");
  const a = insertCoin(db, coin({ name: "Big Whale" }));
  const b = insertCoin(db, coin({ name: "Crowd" }));
  crowd(a.mint, 24, BigInt(20) * SOL, MON + 1000); // 480 SOL, 24 wallets
  crowd(b.mint, 25, SOL, MON + 2000); // 25 SOL, 25 wallets
  await attribute(db);
  const t = standings(db, W, rules(), OP);
  assert.equal(t[0].coinId, b.id, "the qualifying coin ranks first even with less volume");
  assert.equal(t[0].rank, 1);
  assert.equal(t[1].coinId, a.id);
  assert.equal(t[1].qualifies, false);
  assert.equal(t[1].rank, null);
  assert.equal(t[1].traders, 24);
});

test("ties on counted volume: the coin whose first counted trade came earlier ranks higher", async () => {
  const db = openDb(":memory:");
  const late = insertCoin(db, coin({ name: "Late" }));
  const early = insertCoin(db, coin({ name: "Early" }));
  crowd(late.mint, 25, SOL, MON + 50_000_000);
  crowd(early.mint, 25, SOL, MON + 10_000_000);
  await attribute(db);
  const t = standings(db, W, rules(), OP);
  assert.equal(t[0].counted, t[1].counted);
  assert.equal(t[0].coinId, early.id);
  assert.equal(t[1].coinId, late.id);
});

// ───────────────────────── payout

test("pot split 50 / 30 / 20: rounding never exceeds the pot, dust rolls over", () => {
  const pot = BigInt(1_000_000_001);
  const { amounts, rollover } = splitPot(pot, 3);
  assert.deepEqual(amounts, [BigInt(500_000_000), BigInt(300_000_000), BigInt(200_000_000)]);
  assert.equal(rollover, BigInt(1));
  for (const p of [BigInt(7), BigInt(99), BigInt(123_456_789)]) {
    const s = splitPot(p, 3);
    assert.ok(s.amounts.reduce((x, y) => x + y, BigInt(0)) + s.rollover === p);
  }
});

test("week end: standings frozen, top 3 launchers paid 50/30/20 by the operator (simulated, on the ledger)", async () => {
  const db = openDb(":memory:");
  const coins = [insertCoin(db, coin({ name: "One" })), insertCoin(db, coin({ name: "Two" })), insertCoin(db, coin({ name: "Three" })), insertCoin(db, coin({ name: "Four" }))];
  coins.forEach((c, i) => crowd(c.mint, 25, (BigInt(4 - i) * SOL) / BigInt(2), MON + 1000 + i));
  await attribute(db);
  const pot = potOfWeek(db, W);
  assert.ok(pot > BigInt(0));
  const before = coins.map((c) => rpc.state.accounts.get(c.owner)?.lamports ?? 0);
  const sims = rpc.state.calls.filter((m) => m === "simulateTransaction").length;
  assert.deepEqual(settleDue(db, weekEnd(W) - 1), [], "nothing settles before the boundary");
  assert.deepEqual(settleDue(db, weekEnd(W) + 1), [W]);
  const w = getWeek(db, W)!;
  assert.equal(w.pot, pot.toString());
  const paid = await payPrizes(db);
  assert.equal(paid.paid, 3);
  const prizes = prizesOf(db, W);
  assert.deepEqual(prizes.map((p) => p.coinId), [coins[0].id, coins[1].id, coins[2].id]);
  assert.deepEqual(prizes.map((p) => BigInt(p.lamports)), [(pot * BigInt(50)) / BigInt(100), (pot * BigInt(30)) / BigInt(100), (pot * BigInt(20)) / BigInt(100)]);
  coins.slice(0, 3).forEach((c, i) => assert.equal((rpc.state.accounts.get(c.owner)?.lamports ?? 0) - before[i], Number(prizes[i].lamports)));
  assert.equal(rpc.state.accounts.get(coins[3].owner)?.lamports ?? 0, before[3], "fourth place gets nothing");
  assert.ok(rpc.state.calls.filter((m) => m === "simulateTransaction").length >= sims + 3, "every prize simulated first");
  const ledgerPrizes = listLedger(db).filter((r) => r.kind === "prize");
  assert.equal(ledgerPrizes.length, 3);
  assert.ok(prizes.every((p) => p.status === "paid" && p.sig));
  const frozen = JSON.parse(w.standings) as { coinId: string }[];
  assert.equal(frozen.length, 4);
});

test("fewer than 3 qualifiers: the unpaid shares roll into next week's pot", async () => {
  const db = openDb(":memory:");
  const a = insertCoin(db, coin({ name: "Alone" }));
  crowd(a.mint, 25, SOL, MON + 1000);
  await attribute(db);
  const pot = potOfWeek(db, W);
  settle(db, W, weekEnd(W) + 1);
  const w = getWeek(db, W)!;
  const prizes = prizesOf(db, W);
  assert.equal(prizes.length, 1);
  assert.equal(BigInt(prizes[0].lamports), pot / BigInt(2));
  assert.equal(BigInt(w.rolloverOut), pot - pot / BigInt(2));
  const next = openPot(db, W + 1);
  assert.equal(next.rollover, BigInt(w.rolloverOut));
  // a fee for an already settled week is credited to the open week
  trade(a.mint, Keypair.generate().publicKey.toBase58(), SOL, MON + 5000);
  await attribute(db);
  assert.ok(openPot(db, W + 1).fromFees > BigInt(0));
  // next week settles with that rollover in its pot, even with no qualifier at all
  settle(db, W + 1, weekEnd(W + 1) + 1);
  assert.equal(getWeek(db, W + 1)!.rolloverIn, w.rolloverOut);
  assert.equal(prizesOf(db, W + 1).length, 0);
  assert.equal(getWeek(db, W + 1)!.rolloverOut, getWeek(db, W + 1)!.pot, "nobody qualified: all of it rolls on");
});

test("the week boundary is idempotent: two ticks after it settle and pay once", async () => {
  const db = openDb(":memory:");
  const c = insertCoin(db, coin({ name: "Once" }));
  crowd(c.mint, 25, SOL, MON + 1000);
  const t1 = await runTick(db, { now: weekEnd(W) + 60_000 });
  assert.ok("settled" in t1 && t1.settled.includes(W));
  const sent = rpc.state.sent.length;
  const t2 = await runTick(db, { now: weekEnd(W) + 120_000 });
  assert.ok("settled" in t2 && t2.settled.length === 0);
  assert.equal(rpc.state.sent.length, sent, "nothing sent twice");
  assert.equal(listLedger(db).filter((r) => r.kind === "prize").length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM weeks WHERE week = ?").get(W)!.n, 1);
  assert.equal(kvGet(db, "settledThrough"), String(W));
  // a second settle call on the same week returns the frozen row untouched
  assert.equal(settle(db, W, Date.now()).settledAt, getWeek(db, W)!.settledAt);
});

test("claim: the operator's curve creator vault is collected above 0.002 SOL and recorded", async () => {
  const db = openDb(":memory:");
  const vault = curveCreatorVault(operator.publicKey).toBase58();
  rpc.state.accounts.set(vault, { lamports: 890_880 + 50_000_000, owner: SYSTEM });
  const r = await claim(db);
  assert.ok("sig" in r && r.lamports === BigInt(50_000_000));
  assert.equal(kvGet(db, "claimedLamports"), "50000000");
  assert.deepEqual(await claim(db), { skipped: "under the claim minimum" }, "a second claim right after reads the vault fresh, never a cached balance");
  assert.equal(kvGet(db, "claimedLamports"), "50000000");
});

// ───────────────────────── launch

const INPUT: LaunchInput = { name: "Frog Taxes", ticker: "$frog", imageDataUrl: PNG, description: "A frog who files everyone's taxes.", x: "x.com/frogtaxes" };

test("launch: sign-in required; without the webhook a neutral sentence and nothing stored", async () => {
  const db = openDb(":memory:");
  process.env.LAUNCH_WEBHOOK = "http://engine.test/launch";
  assert.equal(await code(prepareLaunch(null, INPUT, db)), 401);
  delete process.env.LAUNCH_WEBHOOK;
  await assert.rejects(prepareLaunch(Keypair.generate().publicKey.toBase58(), INPUT, db), (e: HttpError) => e.message === LAUNCH_CLOSED);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM launches").get()!.n, 0);
});

test("launch: webhook gets identity + image; the launcher owns the coin, the operator is creator of record; first buy read back; daily cap", async () => {
  process.env.LAUNCH_WEBHOOK = "http://engine.test/launch";
  process.env.LAUNCH_SECRET = "s3cret";
  const db = openDb(":memory:");
  const bodies: Record<string, unknown>[] = [];
  const headers: string[] = [];
  let mint = Keypair.generate().publicKey.toBase58();
  const engine = (async (_u: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    headers.push(String((init.headers as Record<string, string>)["x-volumepad-secret"]));
    return Response.json({ mint, signature: "launchSig", creator: "" });
  }) as unknown as typeof fetch;
  const L = Keypair.generate().publicKey.toBase58();
  assert.equal(await code(prepareLaunch(L, { ...INPUT, description: "short" }, db)), 400);
  const prep = await prepareLaunch(L, INPUT, db);
  assert.equal(prep.transaction, null);
  const out = await submitLaunch(L, prep.id, null, db, engine);
  assert.equal(headers.at(-1), "s3cret");
  assert.equal(bodies.at(-1)!.ticker, "FROG");
  assert.match(String(bodies.at(-1)!.imageDataUrl), /^data:image\/png;base64,/);
  assert.equal(bodies.at(-1)!.twitter, "https://x.com/frogtaxes");
  assert.equal(out.coin.owner, L);
  assert.equal(out.coin.creator, OP);
  assert.equal(out.coin.description, "A frog who files everyone's taxes.", "the line is kept as typed (whitespace collapsed only)");
  await submitLaunch(L, prep.id, null, db, engine);
  assert.equal(bodies.length, 1, "same request twice → engine called once");
  const launcher = Keypair.generate();
  const L2 = launcher.publicKey.toBase58();
  rpc.state.accounts.set(L2, { lamports: 2_000_000_000, owner: SYSTEM });
  const p2 = await prepareLaunch(L2, { ...INPUT, firstBuySol: "0.1" }, db);
  assert.ok(p2.transaction);
  assert.equal(await code(submitLaunch(L2, p2.id, null, db, engine)), 400);
  const tx = Transaction.from(Buffer.from(p2.transaction!, "base64"));
  tx.partialSign(launcher);
  const sig = await connection().sendRawTransaction(tx.serialize());
  mint = Keypair.generate().publicKey.toBase58();
  await submitLaunch(L2, p2.id, sig, db, engine);
  assert.equal(bodies.at(-1)!.firstBuyLamports, "100000000");
  assert.ok(listLedger(db).some((r) => r.kind === "launch-in" && r.amount === "100000000"));
  for (let i = 1; i < LAUNCHES_PER_DAY; i++) await prepareLaunch(L2, INPUT, db);
  assert.equal(await code(prepareLaunch(L2, INPUT, db)), 429);
  delete process.env.LAUNCH_WEBHOOK;
});
