"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { sol } from "@/lib/show";
import type { Board, BoardRow } from "@/server/views";

const POLL_MS = 30_000;

/** Polls /api/board every 30 s and hands the latest board to `children`. */
export function useBoard(initial: Board): Board {
  const [b, setB] = useState(initial);
  useEffect(() => {
    let alive = true;
    const t = setInterval(async () => {
      try {
        const r = await fetch("/api/board", { cache: "no-store" });
        if (r.ok && alive) setB((await r.json()) as Board);
      } catch {
        // keep the last board
      }
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return b;
}

const solShort = (l: string | bigint) => sol(l, 2);

function RankBadge({ rank, paid }: { rank: number | null; paid: boolean }) {
  if (rank === null) return <span className="num grid h-9 w-9 shrink-0 place-items-center rounded-full border border-dashed border-border text-[15px] text-muted-foreground">–</span>;
  return <span className={`num grid h-9 w-9 shrink-0 place-items-center rounded-full text-[18px] ${paid ? "bg-accent text-white" : "border border-border bg-panel"}`}>{rank}</span>;
}

function CoinCell({ r }: { r: BoardRow }) {
  return (
    <Link href={`/c/${r.coin.slug}`} className="flex min-w-0 items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={r.coin.avatar} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" />
      <span className="min-w-0">
        <span className="block truncate font-semibold">{r.coin.name}</span>
        <span className="mono block text-[12px] text-muted-foreground">${r.coin.ticker}</span>
      </span>
    </Link>
  );
}

function Qualifies({ r, min }: { r: BoardRow; min: number }) {
  return r.qualifies ? (
    <span className="mono inline-flex items-center gap-1.5 text-[12px] text-up">
      <span className="h-1.5 w-1.5 rounded-full bg-up" /> qualifies
    </span>
  ) : (
    <span className="mono whitespace-nowrap text-[12px] text-warn">needs {Math.max(0, min - r.traders)} more traders</span>
  );
}

export function BoardEmpty() {
  return (
    <div className="relative overflow-hidden rounded-[22px] border border-border bg-background px-6 py-14 text-center" data-testid="board-empty">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-6 top-6 space-y-3 opacity-40">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 rounded-xl border border-dashed border-border" />
        ))}
      </div>
      <div className="relative">
        <svg viewBox="0 0 64 64" className="mx-auto h-12 w-12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5">
          <rect x="10" y="30" width="12" height="22" rx="4" />
          <rect x="26" y="18" width="12" height="34" rx="4" />
          <rect x="42" y="25" width="12" height="27" rx="4" />
          <ellipse cx="32" cy="12" rx="8" ry="3.5" stroke="#FF3D2E" />
        </svg>
        <p className="display-lg mt-4 text-[30px]">No coins on the board yet</p>
        <p className="mx-auto mt-2 max-w-md text-[15px] text-muted-foreground">A coin appears here after its first counted trade this week, and ranks once enough different wallets have traded it.</p>
        <Link href="/launch" className="btn-hot mt-6 inline-flex h-11 items-center rounded-full px-6 text-[14px]">
          Launch the first coin
        </Link>
      </div>
    </div>
  );
}

/** The leaderboard table (desktop) and cards (mobile). `full` adds raw and capped volume. */
export function BoardTable({ rows, minTraders, prizeCount, full = false }: { rows: BoardRow[]; minTraders: number; prizeCount: number; full?: boolean }) {
  if (!rows.length) return <BoardEmpty />;
  return (
    <div data-testid="board">
      <div className="hidden overflow-x-auto md:block">
        <table className="table">
          <thead>
            <tr>
              <th className="w-14">#</th>
              <th>Coin</th>
              <th className="whitespace-nowrap text-right">Counted</th>
              {full && <th className="whitespace-nowrap text-right">Raw</th>}
              <th className="text-right">Traders</th>
              <th>Status</th>
              <th className="whitespace-nowrap text-right">Prize now</th>
              <th className="whitespace-nowrap text-right">Gap</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.coin.id} className="row-hover" data-testid="board-row" data-rank={r.rank ?? ""} data-counted={r.counted}>
                <td>
                  <RankBadge rank={r.rank} paid={r.rank !== null && r.rank <= prizeCount} />
                </td>
                <td>
                  <CoinCell r={r} />
                </td>
                <td className="num whitespace-nowrap text-right text-[20px]">{solShort(r.counted)}</td>
                {full && (
                  <td className="mono whitespace-nowrap text-right text-[13px] text-muted-foreground">
                    {solShort(r.raw)}
                    {BigInt(r.capped) > BigInt(0) && <span className="block text-[11.5px] text-warn">{solShort(r.capped)} over the wallet cap</span>}
                    {BigInt(r.excluded) > BigInt(0) && <span className="block text-[11.5px]">{solShort(r.excluded)} launcher / launch wallet</span>}
                  </td>
                )}
                <td className="mono whitespace-nowrap text-right">
                  {r.traders}
                  <span className="text-muted-foreground"> / {minTraders}</span>
                </td>
                <td>
                  <Qualifies r={r} min={minTraders} />
                </td>
                <td className="mono whitespace-nowrap text-right">{r.projected ? solShort(r.projected) : "—"}</td>
                <td className="mono whitespace-nowrap text-right text-muted-foreground">{r.gap === null ? "—" : `${solShort(r.gap)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid gap-3 md:hidden">
        {rows.map((r) => (
          <li key={r.coin.id} className="rounded-[18px] border border-border bg-panel p-4" data-testid="board-card">
            <div className="flex items-center gap-3">
              <RankBadge rank={r.rank} paid={r.rank !== null && r.rank <= prizeCount} />
              <CoinCell r={r} />
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-[13px]">
              <div>
                <dt className="label">counted</dt>
                <dd className="num mt-0.5 text-[18px]">{solShort(r.counted)}</dd>
              </div>
              <div>
                <dt className="label">traders</dt>
                <dd className="mono mt-0.5">
                  {r.traders}/{minTraders}
                </dd>
              </div>
              <div>
                <dt className="label">prize now</dt>
                <dd className="mono mt-0.5">{r.projected ? solShort(r.projected) : "—"}</dd>
              </div>
            </dl>
            <div className="mt-2 flex items-center justify-between">
              <Qualifies r={r} min={minTraders} />
              {r.gap !== null && <span className="mono text-[12px] text-muted-foreground">{solShort(r.gap)} behind</span>}
            </div>
            {full && BigInt(r.capped) > BigInt(0) && <p className="mono mt-1 text-[11.5px] text-warn">{solShort(r.capped)} over the wallet cap, not counted</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Live board: polls every 30 s. */
export function LiveBoard({ initial, limit, full = false }: { initial: Board; limit?: number; full?: boolean }) {
  const b = useBoard(initial);
  const rows = limit ? b.rows.slice(0, limit) : b.rows;
  return <BoardTable rows={rows} minTraders={b.rules.minTraders} prizeCount={b.rules.prizes.length} full={full} />;
}
