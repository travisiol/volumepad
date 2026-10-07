import { handle } from "@/server/http";
import { currentAddress } from "@/server/session";
import { launcherView } from "@/server/views";

export const dynamic = "force-dynamic";

/** The signed-in wallet's coins (rank this week), launcher balance and prizes. */
export async function GET() {
  return handle(async () => {
    const me = await currentAddress();
    if (!me) return Response.json({ address: null });
    return Response.json({ address: me, ...launcherView(me) });
  });
}
