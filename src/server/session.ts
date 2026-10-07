import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cookies } from "next/headers";
import { serverMint } from "../config/solana.ts";
import { tokenBalance } from "./chain.ts";
import { dbInfo } from "./db.ts";
import { HttpError } from "./errors.ts";
import { assertBalance } from "./gate.ts";

const COOKIE = "sk_session";
const TTL_MS = 7 * 86_400_000;

/**
 * Cookie signing key: SESSION_SECRET (≥ 32 chars) in production. Without it a key is generated
 * once next to the database so sessions survive restarts (per instance on serverless).
 */
function secret(): string {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  const file = join(dirname(dbInfo().path), ".session-secret");
  if (existsSync(file)) return readFileSync(file, "utf8");
  const generated = randomBytes(32).toString("hex");
  writeFileSync(file, generated, { mode: 0o600 });
  return generated;
}

export function signToken(payload: object, key = secret()): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", key).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyToken<T extends { exp: number }>(token: string | undefined, key = secret()): T | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", key).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

export async function startSession(address: string) {
  const jar = await cookies();
  jar.set(COOKIE, signToken({ sub: address, exp: Date.now() + TTL_MS }), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(TTL_MS / 1000),
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

/** The signed-in address (base58, case-sensitive), or null. */
export async function currentAddress(): Promise<string | null> {
  return verifyToken<{ sub: string; exp: number }>((await cookies()).get(COOKIE)?.value)?.sub ?? null;
}

export async function requireSession(): Promise<string> {
  const address = await currentAddress();
  if (!address) throw new HttpError(401, "Sign in with your wallet first.");
  return address;
}

/** Signed in AND holding at least `min` base units of the project's mint. */
export async function requireBalance(min: bigint): Promise<{ address: string; balance: bigint }> {
  const address = await requireSession();
  const balance = await assertBalance(address, serverMint(), min, async (o, m) => (await tokenBalance(o, m)).amount);
  return { address, balance };
}
