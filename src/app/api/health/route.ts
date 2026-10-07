import { ENV } from "@/config/volumepad";
import { SITE } from "@/config/site";
import { serverCluster, serverMint } from "@/config/solana";
import { dbInfo } from "@/server/db";
import { operatorAddress } from "@/server/operator";

export const dynamic = "force-dynamic";

export async function GET() {
  const { persistent } = dbInfo();
  return Response.json(
    {
      ok: true,
      name: SITE.name,
      cluster: serverCluster(),
      mint: serverMint(),
      operator: operatorAddress(),
      launching: Boolean(ENV.launchWebhook() && operatorAddress()),
      storage: persistent ? "disk" : "ephemeral",
      at: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
