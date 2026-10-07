import { ENV } from "@/config/volumepad";
import { db } from "@/server/db";
import { runTick } from "@/server/tick";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorised(request: Request): boolean {
  const secret = ENV.tickSecret();
  if (!secret) return false;
  const h = request.headers.get("authorization") ?? "";
  return h === `Bearer ${secret}` || request.headers.get("x-tick-secret") === secret;
}

/** Fee sweep → week settlement → prize payouts → buy & burn. Vercel cron calls GET with `Authorization: Bearer CRON_SECRET`. */
async function run(request: Request) {
  if (!authorised(request)) return Response.json({ error: "Not allowed." }, { status: 401 });
  const r = await runTick(db());
  return Response.json(JSON.parse(JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v))));
}

export const GET = run;
export const POST = run;
