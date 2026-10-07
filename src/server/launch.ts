/**
 * Launch requests. Launching is free. The site never creates a coin: it takes the coin identity (name, ticker,
 * image, one line, links), optionally a first buy (one SystemProgram transfer from the launcher to the operator with
 * the memo `volumepad launch <id>`, confirmed and read back from the chain), then hands the request to the owner's
 * engine through LAUNCH_WEBHOOK, which launches on pump.fun with the operator wallet as creator of record.
 *
 * Webhook contract: POST JSON {id, name, ticker, description, imageDataUrl, website, twitter, telegram, launcher, firstBuyLamports}
 * with header `x-volumepad-secret: LAUNCH_SECRET`; reply 200 JSON {mint, signature, creator, tokensBought?}.
 */
import type { DatabaseSync } from "node:sqlite";
import { PublicKey } from "@solana/web3.js";
import { ENV, LAUNCHES_PER_DAY, MAX_IMAGE_BYTES } from "../config/volumepad.ts";
import { LAMPORTS_PER_SOL } from "../config/solana.ts";
import { db as defaultDb } from "./db.ts";
import { HttpError } from "./errors.ts";
import { operatorAddress, recordPayout } from "./operator.ts";
import { parseSolAmount, paymentTxBase64, readPayment } from "./payments.ts";
import { coinByMint, getLaunch, getMedia, insertCoin, insertLaunch, launchesSince, newId, paySigUsed, putMedia, updateLaunch } from "./store.ts";
import type { CoinRow } from "./store.ts";

export const LAUNCH_CLOSED = "Launching is not open yet.";

export function cleanName(nameIn: unknown, tickerIn: unknown): { name: string; ticker: string } {
  const name = String(nameIn ?? "").trim();
  if (name.length < 2 || name.length > 32) throw new HttpError(400, "Give your coin a name (2 to 32 characters).");
  const ticker = String(tickerIn ?? "").trim().replace(/^\$/, "").toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(ticker)) throw new HttpError(400, "Ticker: letters and numbers, 2 to 10.");
  return { name, ticker };
}

export interface Setup {
  description: string;
  website: string | null;
  xUrl: string | null;
  telegram: string | null;
}

const cleanUrl = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString().slice(0, 200) : null;
  } catch {
    return null;
  }
};

export function cleanSetup(input: LaunchInput): Setup {
  const description = String(input.description ?? "").replace(/\s+/g, " ").trim();
  if (description.length < 8 || description.length > 140) throw new HttpError(400, "Describe the coin in one line (8 to 140 characters).");
  return { description, website: cleanUrl(input.website), xUrl: cleanUrl(input.x), telegram: cleanUrl(input.telegram) };
}

export function parseImage(dataUrl: unknown): { mime: string; bytes: Buffer } {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ""));
  if (!m) throw new HttpError(400, "Add a PNG, JPG, WEBP or GIF image.");
  const bytes = Buffer.from(m[2], "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new HttpError(400, "The image must be under 4 MB.");
  return { mime: m[1], bytes };
}

export interface LaunchInput {
  name?: string;
  ticker?: string;
  imageDataUrl?: string;
  description?: string;
  website?: string;
  x?: string;
  telegram?: string;
  firstBuySol?: string | number;
}

export interface Prepared {
  id: string;
  firstBuyLamports: string;
  /** base64 wire transaction to sign, or null when there is no first buy (nothing to sign). */
  transaction: string | null;
}

export const launchMemo = (id: string) => `volumepad launch ${id}`;

/** Validates and stores the request. Without LAUNCH_WEBHOOK (or an operator) nothing is stored. */
export async function prepareLaunch(launcher: string | null, input: LaunchInput, db: DatabaseSync = defaultDb(), now = Date.now()): Promise<Prepared> {
  if (!launcher) throw new HttpError(401, "Sign in with your wallet first.");
  const operator = operatorAddress();
  if (!ENV.launchWebhook() || !operator) throw new HttpError(503, LAUNCH_CLOSED);
  const { name, ticker } = cleanName(input.name, input.ticker);
  const setup = cleanSetup(input);
  const image = parseImage(input.imageDataUrl);
  if (launchesSince(db, launcher, now - 86_400_000) >= LAUNCHES_PER_DAY) throw new HttpError(429, `Up to ${LAUNCHES_PER_DAY} launches per wallet a day.`);
  const firstBuy = parseSolAmount(input.firstBuySol, "First buy");
  if (firstBuy > BigInt(100) * BigInt(LAMPORTS_PER_SOL)) throw new HttpError(400, "First buy is capped at 100 SOL.");
  const id = newId();
  insertLaunch(db, {
    id,
    name,
    ticker,
    setup: JSON.stringify(setup),
    imageId: putMedia(db, image.mime, image.bytes),
    launcher,
    firstBuyLamports: firstBuy.toString(),
    status: firstBuy > BigInt(0) ? "awaiting-payment" : "paid",
    createdAt: now,
  });
  return { id, firstBuyLamports: firstBuy.toString(), transaction: firstBuy > BigInt(0) ? await paymentTxBase64(launcher, operator, firstBuy, launchMemo(id)) : null };
}

export interface WebhookReply {
  mint: string;
  signature: string;
  creator: string;
  tokensBought?: string | number;
}

/** Confirms the first buy (if any), calls the engine, stores the coin. */
export async function submitLaunch(
  launcher: string,
  id: string,
  paySig: string | null,
  db: DatabaseSync = defaultDb(),
  fetcher: typeof fetch = fetch,
): Promise<{ coin: CoinRow; mint: string; signature: string; tokensBought: bigint }> {
  const webhook = ENV.launchWebhook();
  const operator = operatorAddress();
  if (!webhook || !operator) throw new HttpError(503, LAUNCH_CLOSED);
  const launch = getLaunch(db, id);
  if (!launch || launch.launcher !== launcher) throw new HttpError(404, "Launch request not found.");
  if (launch.status === "launched" && launch.mint) {
    const c = coinByMint(db, launch.mint)!;
    return { coin: c, mint: launch.mint, signature: launch.sig ?? "", tokensBought: BigInt(0) };
  }
  let firstBuy = BigInt(launch.firstBuyLamports);
  if (launch.status === "awaiting-payment") {
    if (!paySig) throw new HttpError(400, "Sign the first buy in your wallet first.");
    if (paySigUsed(db, paySig)) throw new HttpError(409, "That transfer was already used.");
    firstBuy = await readPayment(paySig, launcher, operator, launchMemo(id));
    if (firstBuy <= BigInt(0)) throw new HttpError(400, "No SOL arrived with that transfer.");
    updateLaunch(db, id, { paySig, firstBuyLamports: firstBuy.toString(), status: "paid" });
    recordPayout(db, { kind: "launch-in", to: operator, mint: null, amount: firstBuy, sig: paySig, note: `first buy of $${launch.ticker} from ${launcher.slice(0, 4)}…${launcher.slice(-4)}` });
  }
  const setup = JSON.parse(launch.setup) as Setup;
  const media = getMedia(db, launch.imageId);
  let reply: WebhookReply;
  try {
    const r = await fetcher(webhook, {
      method: "POST",
      headers: { "content-type": "application/json", "x-volumepad-secret": ENV.launchSecret() },
      body: JSON.stringify({
        id,
        name: launch.name,
        ticker: launch.ticker,
        description: setup.description,
        website: setup.website,
        twitter: setup.xUrl,
        telegram: setup.telegram,
        imageDataUrl: media ? `data:${media.mime};base64,${media.bytes.toString("base64")}` : "",
        launcher,
        firstBuyLamports: firstBuy.toString(),
      }),
      signal: AbortSignal.timeout(50_000),
    });
    if (!r.ok) throw new Error(String(r.status));
    reply = (await r.json()) as WebhookReply;
    new PublicKey(reply.mint);
  } catch {
    updateLaunch(db, id, { error: "engine did not answer" });
    throw new HttpError(502, "The launch engine did not answer. Your request is saved; try again in a minute.");
  }
  updateLaunch(db, id, { status: "launched", mint: reply.mint, sig: reply.signature, error: null });
  const c =
    coinByMint(db, reply.mint) ??
    insertCoin(db, {
      mint: reply.mint,
      name: launch.name,
      ticker: launch.ticker,
      ...setup,
      imageId: launch.imageId,
      owner: launcher,
      creator: reply.creator || operator,
      launchSig: reply.signature,
    });
  return { coin: c, mint: reply.mint, signature: reply.signature, tokensBought: BigInt(String(reply.tokensBought ?? "0")) };
}
