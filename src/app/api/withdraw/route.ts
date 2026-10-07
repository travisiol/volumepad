import { db } from "@/server/db";
import { assertSameOrigin, handle } from "@/server/http";
import { withdraw } from "@/server/sweep";
import { currentAddress } from "@/server/session";

export const maxDuration = 60;

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    return Response.json(await withdraw(await currentAddress(), db()));
  });
}
