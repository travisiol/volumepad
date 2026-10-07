import { after } from "next/server";
import { db } from "@/server/db";
import { HttpError } from "@/server/errors";
import { assertSameOrigin, handle, readJson } from "@/server/http";
import { prepareLaunch, submitLaunch } from "@/server/launch";
import type { LaunchInput } from "@/server/launch";
import { sendToken } from "@/server/operator";
import { currentAddress } from "@/server/session";

export const maxDuration = 60;

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const body = await readJson<LaunchInput & { action?: string; id?: string; sig?: string }>(request);
    const me = await currentAddress();
    if (body.action === "submit") {
      if (!me) throw new HttpError(401, "Sign in with your wallet first.");
      const out = await submitLaunch(me, String(body.id ?? ""), body.sig ?? null, db());
      if (out.tokensBought > BigInt(0)) {
        after(async () => {
          await sendToken(me, out.mint, out.tokensBought, `first buy of $${out.coin.ticker} forwarded to the launcher`, db()).catch(() => null);
        });
      }
      return Response.json({ slug: out.coin.slug, mint: out.mint, signature: out.signature });
    }
    return Response.json(await prepareLaunch(me, body, db()));
  });
}
