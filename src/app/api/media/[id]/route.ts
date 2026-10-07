import { db } from "@/server/db";
import { getMedia } from "@/server/store";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const m = getMedia(db(), (await params).id);
  if (!m) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(m.bytes), { headers: { "content-type": m.mime, "cache-control": "public, max-age=31536000, immutable" } });
}
