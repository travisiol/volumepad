"use client";

import { sol } from "@/lib/show";
import type { Board } from "@/server/views";
import { useBoard } from "./Board";
import { WeekCountdown } from "./Live";

const fmt = (l: string) => sol(l, 3);

/** The hero's live strip: pot, countdown, top prize. Polls with the board. */
export function LiveStrip({ initial }: { initial: Board }) {
  const b = useBoard(initial);
  const empty = BigInt(b.pot.total) === BigInt(0);
  const top = b.rules.prizes[0] ?? 0;
  return (
    <div className="grid grid-cols-1 divide-y divide-border rounded-[22px] border border-border bg-panel sm:grid-cols-3 sm:divide-x sm:divide-y-0" data-testid="live-strip">
      <div className="p-5">
        <div className="label flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" /> weekly pot
        </div>
        <div className="num mt-2 text-[34px] leading-none" data-testid="pot">
          {fmt(b.pot.total)}
        </div>
        <div className="mt-2 text-[12.5px] text-muted-foreground">{empty ? "First fees start the pot." : BigInt(b.pot.uncollected) > BigInt(0) ? `${fmt(b.pot.uncollected)} still to collect from pump.fun` : "All collected from pump.fun"}</div>
      </div>
      <div className="p-5">
        <div className="label">week ends in</div>
        <div className="num mt-2 whitespace-nowrap text-[26px] leading-[34px]">
          <WeekCountdown endAt={b.endAt} serverNow={b.serverNow} />
        </div>
        <div className="mt-2 text-[12.5px] text-muted-foreground">{new Date(b.endAt - 60_000).toUTCString().slice(0, 22)} UTC</div>
      </div>
      <div className="p-5">
        <div className="label">top payout</div>
        <div className="num mt-2 text-[34px] leading-none">{top} %</div>
        <div className="mt-2 text-[12.5px] text-muted-foreground">of the pot to the #1 launcher</div>
      </div>
    </div>
  );
}

/** Pot breakdown for the leaderboard page. */
export function PotPanel({ initial }: { initial: Board }) {
  const b = useBoard(initial);
  return (
    <div className="grid gap-px overflow-hidden rounded-[22px] border border-border bg-border sm:grid-cols-4">
      <Cell k="pot this week" v={fmt(b.pot.total)} big testid="pot" />
      <Cell k="from this week's fees" v={fmt(b.pot.fromFees)} />
      <Cell k="rolled over" v={fmt(b.pot.rollover)} />
      <Cell k="not yet collected" v={fmt(b.pot.uncollected)} note="attributed from trades, collected from pump.fun at the next claim" />
      <div className="bg-panel p-5 sm:col-span-4">
        <div className="label">week ends in</div>
        <div className="num mt-2 text-[40px] leading-none">
          <WeekCountdown endAt={b.endAt} serverNow={b.serverNow} />
        </div>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Week {b.week} · {new Date(b.startAt).toUTCString().slice(0, 16)} 00:00 UTC → {new Date(b.endAt - 60_000).toUTCString().slice(0, 22)} UTC
          {b.lastTick ? ` · last update ${new Date(b.lastTick).toUTCString().slice(17, 22)} UTC` : ""}
        </p>
      </div>
    </div>
  );
}

function Cell({ k, v, note, big, testid }: { k: string; v: string; note?: string; big?: boolean; testid?: string }) {
  return (
    <div className="bg-panel p-5">
      <div className="label">{k}</div>
      <div className={`num mt-2 leading-none ${big ? "text-[34px] text-accent" : "text-[26px]"}`} data-testid={testid}>
        {v}
      </div>
      {note && <p className="mt-2 text-[12px] leading-snug text-muted-foreground">{note}</p>}
    </div>
  );
}
