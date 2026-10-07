import { board, scheduleWork } from "@/server/views";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** The live leaderboard of the open week (polled by the pages every 30 s). Schedules an overdue tick. */
export async function GET(request: Request) {
  scheduleWork();
  const limit = Math.min(200, Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 100));
  return Response.json(board(limit), { headers: { "cache-control": "no-store" } });
}
