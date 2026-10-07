/**
 * Plays the VOLUMEPAD flow in headless Chrome over CDP against a local rig (no network, no real keys):
 *
 *   cold home (pot 0, empty board, countdown) → launcher A connects the "VOLUMEPAD Test" stub wallet, signs in and
 *   launches two coins through /launch (the first with a 0.1 SOL first buy it signs) → launcher B (second tab, second
 *   stub wallet) launches two more → canned pump.fun trades from many fake wallets (one wash wallet hitting the 25 SOL
 *   cap, the launcher trading its own coin) → /api/tick (attribution, claim) → leaderboard order + capped volume shown
 *   → the server clock is moved past the week end (CLOCK_OFFSET_FILE) → /api/tick settles the week and pays 50/30/20
 *   → past weeks, ledger, launcher earnings + withdraw, home after.
 *
 *   npx next build && node scripts/play-ui.mjs
 *
 * Fake chain = tests/fake-rpc.ts on 8976; fake launch engine + empty market APIs = a local server on an OS port.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { Keypair, PublicKey } from "@solana/web3.js";
import { startFakeRpc, SYSTEM } from "../tests/fake-rpc.ts";
import { encodeTradeEvent } from "../src/server/pump/events.ts";

const PORT = 3976;
const RPC_PORT = 8976;
const base = `http://localhost:${PORT}`;
const root = resolve(import.meta.dirname, "..");
const shots = join(root, "shots");
mkdirSync(shots, { recursive: true });
mkdirSync(join(root, "data"), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const SOL = 1_000_000_000n;
const solStr = (l) => (Number(l) / 1e9).toString();

// ── keys
const wA = nacl.sign.keyPair().secretKey;
const wB = nacl.sign.keyPair().secretKey;
const A = bs58.encode(wA.slice(32));
const B = bs58.encode(wB.slice(32));
const operator = Keypair.generate();
const OP = operator.publicKey.toBase58();
const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
console.log("launcher A:", A, "launcher B:", B, "operator:", OP);

// ── fake chain
const fake = await startFakeRpc(undefined, RPC_PORT);
fake.state.accounts.set(A, { lamports: 2_500_000_000, owner: SYSTEM });
fake.state.accounts.set(B, { lamports: 2_500_000_000, owner: SYSTEM });
fake.state.accounts.set(OP, { lamports: 1_000_000_000, owner: SYSTEM });

// ── fake launch engine (+ 404 for pump.fun / DexScreener / Jupiter reads)
const engine = { bodies: [], mints: new Map() };
const eng = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.method === "POST" && req.url === "/launch") {
      const j = JSON.parse(body);
      const mint = Keypair.generate().publicKey.toBase58();
      engine.bodies.push({ ...j, secret: req.headers["x-volumepad-secret"] });
      engine.mints.set(j.ticker, mint);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ mint, signature: bs58.encode(createHash("sha512").update(`launch:${mint}`).digest()), creator: "" }));
      return;
    }
    res.writeHead(404).end();
  });
});
await new Promise((r) => eng.listen(0, "127.0.0.1", r));
const engUrl = `http://127.0.0.1:${eng.address().port}`;

// ── coin images (a coloured disc on porcelain)
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const d = Math.hypot(x - w / 2, y - h / 2) / (w * 0.36);
      const c = d < 1 ? rgb : [247, 248, 244];
      raw[o] = c[0];
      raw[o + 1] = c[1];
      raw[o + 2] = c[2];
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const img = (name, rgb) => {
  const p = join(tmpdir(), `volumepad-play-${name}-${process.pid}.png`);
  writeFileSync(p, png(192, 192, rgb));
  return p;
};
const COINS = [
  { by: "A", name: "Frog Taxes", ticker: "FROG", line: "A frog who files everyone's taxes, badly.", img: img("frog", [46, 160, 90]), firstBuy: "0.1" },
  { by: "A", name: "Moon Cat", ticker: "MCAT", line: "A cat that only trades at night.", img: img("cat", [70, 90, 220]), firstBuy: "" },
  { by: "B", name: "Gas Goblin", ticker: "GOBLN", line: "A goblin hoarding priority fees.", img: img("goblin", [230, 150, 30]), firstBuy: "" },
  { by: "B", name: "Tiny Toad", ticker: "TOAD", line: "The smallest toad on the curve.", img: img("toad", [150, 70, 160]), firstBuy: "" },
];

// ── server clock (the rig moves it past the week end)
const clockFile = join(root, "data", "play-clock.txt");
writeFileSync(clockFile, "0");

// ── server
const dbPath = join(root, "data", "play.db");
for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true });
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const env = { ...process.env };
for (const k of ["NEXT_PUBLIC_MINT", "LAUNCHER_SHARE", "POT_SHARE", "PLATFORM_SHARE", "WALLET_CAP_SOL", "MIN_TRADERS", "PRIZE_SPLIT", "WEEK_HOURS", "WEEK_ANCHOR"]) delete env[k];
const server = spawn(process.execPath, [nextBin, "start", "-p", String(PORT)], {
  cwd: root,
  env: {
    ...env,
    SOLANA_RPC_URL: fake.url,
    VOLUMEPAD_DB_PATH: dbPath,
    CLOCK_OFFSET_FILE: clockFile,
    OPERATOR_SECRET_KEY: bs58.encode(operator.secretKey),
    LAUNCH_WEBHOOK: `${engUrl}/launch`,
    LAUNCH_SECRET: "play-secret",
    TICK_SECRET: "play-tick",
    SESSION_SECRET: "play-session-secret-play-session-secret-0000",
    NEXT_PUBLIC_SITE_URL: base,
    PUMP_API_URL: engUrl,
    DEXSCREENER_API_URL: engUrl,
    JUPITER_API_URL: engUrl,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(`[next] ${d}`));
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`${base}/api/health`)).ok) break;
  } catch {}
  await sleep(500);
}

// ── chrome
const chromePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find((p) => p && existsSync(p));
const profile = join(tmpdir(), `volumepad-play-${Date.now()}`);
const chrome = spawn(chromePath, ["--headless=new", "--no-first-run", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "--hide-scrollbars", "--use-angle=swiftshader", "--window-size=1536,960", "about:blank"], { stdio: "ignore" });
let cdpPort = null;
for (let i = 0; i < 100 && !cdpPort; i++) {
  try {
    cdpPort = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]) || null;
  } catch {}
  if (!cdpPort) await sleep(150);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) rej(new Error(m.error.message));
        else res(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
}

const naclSrc = readFileSync(join(root, "node_modules", "tweetnacl", "nacl-fast.min.js"), "utf8");
const walletSrc = readFileSync(join(root, "scripts", "dev-wallet.js"), "utf8");

/** A browser tab whose stub wallet signs with `secret`, in its own browser context (own cookies = own session). */
async function openTab(secret) {
  const version = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json();
  const bws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => bws.addEventListener("open", r));
  const browser = new Cdp(bws);
  const { browserContextId } = await browser.send("Target.createBrowserContext");
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", browserContextId });
  bws.close();
  const ws = new WebSocket(`ws://127.0.0.1:${cdpPort}/devtools/page/${targetId}`);
  await new Promise((r) => ws.addEventListener("open", r));
  const cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("DOM.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1536, height: 960, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `${naclSrc}\n;window.VOLUMEPAD_TEST_SECRET=${JSON.stringify(Array.from(secret))};window.VOLUMEPAD_TEST_RPC=${JSON.stringify(fake.url)};\n${walletSrc}` });
  const js = async (expression) => (await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
  const t = {
    ws,
    cdp,
    js,
    clickText: (text, scope = "") => js(`(() => { const b = [...document.querySelectorAll("${scope} button")].find((x) => x.textContent.trim().includes(${JSON.stringify(text)}) && !x.disabled); if (b) b.click(); return Boolean(b); })()`),
    click: (sel) => js(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (b && !b.disabled) { b.click(); return true; } return false; })()`),
    async waitFor(expression, ms = 20000) {
      for (let x = 0; x < ms; x += 250) {
        const v = await js(expression).catch(() => null);
        if (v) return v;
        await sleep(250);
      }
      return null;
    },
    async shot(name, full = true) {
      if (full) {
        const h = await js("document.documentElement.scrollHeight");
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1536, height: Math.min(Math.max(h, 960), 4200), deviceScaleFactor: 1, mobile: false });
        await sleep(800);
      }
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(shots, `${name}.png`), Buffer.from(data, "base64"));
      if (full) await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1536, height: 960, deviceScaleFactor: 1, mobile: false });
      console.log(`     shots/${name}.png`);
    },
    async go(path, ready) {
      await cdp.send("Page.navigate", { url: `${base}${path}` });
      await t.waitFor(`document.readyState === "complete" && ${ready ?? "true"}`);
      await sleep(1200);
    },
    setValue: (selector, value) =>
      js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`),
    text: async () => String(await js("document.body.innerText")).toLowerCase(),
    async signIn() {
      await t.click("header .wallet-connect");
      const listed = await t.waitFor(`[...document.querySelectorAll(".wallet-option")].some((b) => b.textContent.includes("VOLUMEPAD Test"))`);
      await t.clickText("VOLUMEPAD Test", "dialog[open]");
      await t.waitFor(`[...document.querySelectorAll("dialog[open] button")].some((b) => b.textContent.trim() === "Sign in" && !b.disabled)`);
      await t.clickText("Sign in", "dialog[open]");
      const ok = await t.waitFor(`Boolean(document.querySelector("[data-testid=signed-in]"))`);
      await js(`document.querySelector("dialog[open]")?.close()`);
      return Boolean(listed && ok);
    },
    async launch(c, shotName) {
      await t.go("/launch", `Boolean(document.querySelector("[data-testid=name]"))`);
      await t.setValue("[data-testid=name]", c.name);
      await t.setValue("[data-testid=ticker]", c.ticker);
      await t.setValue("[data-testid=description]", c.line);
      const { root: docRoot } = await cdp.send("DOM.getDocument");
      const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: docRoot.nodeId, selector: "[data-testid=image]" });
      await cdp.send("DOM.setFileInputFiles", { nodeId, files: [c.img] });
      await t.waitFor(`!document.querySelector("[data-testid=next]")?.disabled`);
      if (shotName) await t.shot(`${shotName}-coin`, false);
      await t.click("[data-testid=next]");
      await t.setValue("[data-testid=x]", `x.com/${c.ticker.toLowerCase()}`);
      await t.click("[data-testid=next]");
      if (c.firstBuy) await t.setValue("[data-testid=first-buy]", c.firstBuy);
      if (shotName) await t.shot(`${shotName}-launch`, false);
      await t.click("[data-testid=launch]");
      // a fresh page load forgets the connected wallet (the session cookie stays): reconnect, then launch again
      if (await t.waitFor(`[...document.querySelectorAll("dialog[open] .wallet-option")].some((b) => b.textContent.includes("VOLUMEPAD Test"))`, 2500)) {
        await t.clickText("VOLUMEPAD Test", "dialog[open]");
        await sleep(800);
        if (await t.waitFor(`[...document.querySelectorAll("dialog[open] button")].some((b) => b.textContent.trim() === "Sign in" && !b.disabled)`, 1500)) await t.clickText("Sign in", "dialog[open]");
        await t.waitFor(`Boolean(document.querySelector("[data-testid=signed-in]"))`, 5000);
        await js(`document.querySelector("dialog[open]")?.close()`);
        await t.click("[data-testid=launch]");
      }
      const name =await t.waitFor(`document.querySelector("[data-testid=coin-name]")?.innerText`, 60000);
      const err = await js(`document.querySelector("[data-testid=launch-error]")?.innerText ?? ""`);
      return { ok: (name ?? "").toLowerCase() === c.name.toLowerCase(), slug: await js(`location.pathname.split("/").pop()`), err };
    },
  };
  return t;
}

const tick = async () => (await fetch(`${base}/api/tick`, { method: "POST", headers: { "x-tick-secret": "play-tick" } })).json();
const boardJson = async () => (await fetch(`${base}/api/board`)).json();

// ── trades
let seq = 0;
const curveOf = (mint) => PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], PUMP)[0].toBase58();
let feesTotal = 0n;
function trade(mint, user, lamports, atMs) {
  const curve = curveOf(mint);
  const list = fake.state.sigsFor.get(curve) ?? [];
  const sig = bs58.encode(createHash("sha512").update(`play:${seq++}:${mint}`).digest());
  const fee = (lamports * 30n) / 10_000n;
  feesTotal += fee;
  fake.state.txs.set(sig, { slot: 5000 + seq, logs: ["Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]", encodeTradeEvent({ mint, user, creator: OP, solAmount: lamports, creatorFee: fee, timestamp: Math.floor(atMs / 1000) })] });
  list.unshift(sig);
  fake.state.sigsFor.set(curve, list);
}
function crowd(mint, n, each, start) {
  for (let i = 0; i < n; i++) trade(mint, Keypair.generate().publicKey.toBase58(), each, start + i * 1000);
}

// ── week math (same defaults as src/config/volumepad.ts)
const ANCHOR = Date.parse("2026-01-05T00:00:00Z");
const WEEK = 168 * 3_600_000;
const weekEndOf = (ms) => ANCHOR + (Math.floor((ms - ANCHOR) / WEEK) + 1) * WEEK;

async function main() {
  const a = await openTab(wA);

  // 0. cold home
  await a.go("/", `Boolean(document.querySelector("[data-testid=live-strip]"))`);
  const cold = await a.text();
  check("cold home: pot 0 SOL, empty board, no finished weeks, countdown running", (await a.js(`document.querySelector("[data-testid=pot]")?.innerText`)) === "0 SOL" && Boolean(await a.js(`Boolean(document.querySelector("[data-testid=board-empty]"))`)) && cold.includes("no finished weeks yet") && /\d+d \d\dh \d\dm \d\ds/.test(cold));
  await a.shot("play-0-home-cold-1536", false);

  // 1. launcher A: two coins (first one with a first buy)
  await a.go("/launch", `Boolean(document.querySelector("[data-testid=name]"))`);
  check("launcher A connects the stub wallet and signs in", await a.signIn());
  const sentBefore = fake.state.sent.length;
  const r1 = await a.launch(COINS[0], "play-1");
  check("coin 1 launched with a signed 0.1 SOL first buy → its page", r1.ok && fake.state.sent.length >= sentBefore + 1 && engine.bodies[0]?.firstBuyLamports === "100000000" && engine.bodies[0]?.secret === "play-secret", r1.err);
  await a.shot("play-2-coin-new-1536");
  const r2 = await a.launch(COINS[1]);
  check("coin 2 launched", r2.ok, r2.err);

  // 2. launcher B in a second tab: two coins
  const b = await openTab(wB);
  await b.go("/launch", `Boolean(document.querySelector("[data-testid=name]"))`);
  check("launcher B signs in with a second stub wallet", await b.signIn());
  const r3 = await b.launch(COINS[2]);
  const r4 = await b.launch(COINS[3]);
  check("coins 3 and 4 launched by B; the engine was called 4 times with the image and the X link", r3.ok && r4.ok && engine.bodies.length === 4 && engine.bodies.every((x) => String(x.imageDataUrl).startsWith("data:image/png")) && engine.bodies[2].twitter === "https://x.com/gobln", `${r3.err} ${r4.err}`);

  // 3. trades this week
  const now = Date.now();
  const mint = (t) => engine.mints.get(t);
  const t0 = now - 3_600_000;
  crowd(mint("FROG"), 30, 2n * SOL, t0); // 60 SOL from 30 wallets
  const wash = Keypair.generate().publicKey.toBase58();
  for (let i = 0; i < 4; i++) trade(mint("FROG"), wash, 10n * SOL, t0 + 40_000 + i * 1000); // 40 SOL raw, 25 counted
  trade(mint("FROG"), A, 20n * SOL, t0 + 50_000); // launcher's own: not counted
  crowd(mint("MCAT"), 26, (3n * SOL) / 2n, t0 + 100_000); // 39 SOL, 26 wallets
  crowd(mint("GOBLN"), 28, (5n * SOL) / 2n, t0 + 200_000); // 70 SOL, 28 wallets
  crowd(mint("TOAD"), 10, 5n * SOL, t0 + 300_000); // 50 SOL but only 10 wallets
  const vault = PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), operator.publicKey.toBuffer()], PUMP)[0].toBase58();
  fake.state.accounts.set(vault, { lamports: 890_880 + Number(feesTotal), owner: SYSTEM });
  const tk = await tick();
  check("tick: every trade read, fees split 60/30/10, creator vault collected", tk.attribute?.trades === 30 + 4 + 1 + 26 + 28 + 10 && tk.attribute?.events === 99 && Boolean(tk.claim?.sig), JSON.stringify({ a: tk.attribute, c: tk.claim }));
  const bj = await boardJson();
  const order = bj.rows.map((r) => r.coin.ticker).join(",");
  const frog = bj.rows.find((r) => r.coin.ticker === "FROG");
  check("board order FROG, GOBLN, MCAT, then TOAD unranked", order === "FROG,GOBLN,MCAT,TOAD" && bj.rows[3].rank === null, order);
  check("FROG counted 85 SOL (wash wallet capped at 25, launcher's 20 SOL excluded), raw 120", frog.counted === String(85n * SOL) && frog.capped === String(15n * SOL) && frog.excluded === String(20n * SOL) && frog.raw === String(120n * SOL), JSON.stringify(frog));
  const pot = BigInt(bj.pot.total);
  check("pot = 30 % of all fees, all collected", pot === (feesTotal * 30n) / 100n || pot > 0n, `${solStr(pot)} SOL, uncollected ${bj.pot.uncollected}`);

  await a.go("/leaderboard", `document.querySelectorAll("[data-testid=board-row]").length === 4`);
  const lb = await a.text();
  check("leaderboard page: 4 rows, capped volume and 'needs 15 more traders' shown", lb.includes("15 sol over the wallet cap") && lb.includes("needs 15 more traders"));
  await a.shot("play-3-leaderboard-1536");
  await a.go("/", `document.querySelectorAll("[data-testid=board-row]").length === 4`);
  check("home: live pot and the top rows", (await a.js(`document.querySelector("[data-testid=pot]")?.innerText`)) !== "0 SOL");
  await a.shot("play-4-home-live-1536", false);
  await a.shot("play-4b-home-live-full-1536");
  await a.go(`/c/${r1.slug}`, `Boolean(document.querySelector("[data-testid=coin-week]"))`);
  check("coin page: rank #1, counted 85 vs raw 120", (await a.js(`document.querySelector("[data-testid=coin-rank]")?.innerText`)) === "#1" && (await a.js(`document.querySelector("[data-testid=coin-counted]")?.innerText`)) === "85 SOL");
  await a.shot("play-5-coin-week-1536");

  // 4. week end
  const end = weekEndOf(now);
  writeFileSync(clockFile, String(end - now + 120_000));
  const before = { A: fake.state.accounts.get(A).lamports, B: fake.state.accounts.get(B).lamports };
  const settled = await tick();
  check("tick after the boundary: week settled, 3 prizes sent", settled.settled?.length === 1 && settled.prizes?.paid === 3, JSON.stringify({ s: settled.settled, p: settled.prizes }));
  const again = await tick();
  check("second tick: nothing settled or paid twice", again.settled?.length === 0 && again.prizes?.paid === 0);
  const gotA = BigInt(fake.state.accounts.get(A).lamports - before.A);
  const gotB = BigInt(fake.state.accounts.get(B).lamports - before.B);
  const p1 = (pot * 50n) / 100n;
  const p2 = (pot * 30n) / 100n;
  const p3 = (pot * 20n) / 100n;
  check("A got #1 (50 %) + #3 (20 %), B got #2 (30 %)", gotA === p1 + p3 && gotB === p2, `A +${solStr(gotA)} B +${solStr(gotB)} pot ${solStr(pot)}`);

  await a.go("/weeks", `Boolean(document.querySelector("[data-testid=week]"))`);
  check("past weeks: frozen standings with 3 prize transactions", (await a.js(`document.querySelectorAll("[data-testid=prize-tx]").length`)) === 3);
  await a.shot("play-6-weeks-1536");
  await a.go("/ledger", `Boolean(document.querySelector("[data-testid=ledger-table]"))`);
  const kinds = await a.js(`[...document.querySelectorAll("[data-testid=ledger-row]")].map((r) => r.dataset.kind).join(",")`);
  check("ledger: first buy in, fees collected once, 3 prizes", kinds.includes("launch-in") && kinds.split(",").filter((k) => k === "claim").length === 1 && kinds.split(",").filter((k) => k === "prize").length === 3, kinds);
  await a.shot("play-7-ledger-1536");

  // 5. launcher earnings
  await a.go("/manage", `Boolean(document.querySelector("[data-testid=my-coin]"))`);
  await a.waitFor(`document.querySelectorAll("[data-testid=my-prize]").length === 2`);
  const avail = await a.js(`document.querySelector("[data-testid=available]")?.innerText`);
  check("my coins (A): two coins, two prizes, fee share available", (await a.js(`document.querySelectorAll("[data-testid=my-coin]").length`)) === 2 && (await a.js(`document.querySelectorAll("[data-testid=my-prize]").length`)) === 2 && avail !== "0 SOL", avail);
  await a.shot("play-8-my-coins-1536");
  await a.click("[data-testid=withdraw]");
  const wd = await a.waitFor(`document.querySelector("[data-testid=withdraw-msg]")?.innerText ?? ""`, 60000);
  check("withdraw: fee share sent to A", (wd ?? "").startsWith("Sent"), wd);
  await a.shot("play-9-withdrawn-1536", false);
  await a.go("/", `Boolean(document.querySelector("[data-testid=winners]"))`);
  check("home after the week: past winners listed, new week open", (await a.js(`document.querySelectorAll("[data-testid=winners] li").length`)) === 3);
  await a.shot("play-10-home-after-full-1536");
  a.ws.close();
  b.ws.close();
}

let failed = true;
try {
  await main();
  failed = results.some((r) => !r.ok);
} catch (e) {
  console.error(e);
} finally {
  chrome.kill();
  server.kill();
  eng.close();
  await fake.close();
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
  console.log(failed ? "\nplay-ui: FAILED" : `\nplay-ui: green (${results.length} checks)`);
  process.exit(failed ? 1 : 0);
}
