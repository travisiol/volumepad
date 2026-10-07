"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ensureSession, errorText } from "@/components/actions";
import { useWallet } from "@/components/wallet/store";
import { sol } from "@/lib/show";

interface Chip {
  id: string;
  slug: string;
  name: string;
  ticker: string;
  avatar: string;
}

interface Me {
  address: string | null;
  coins?: { coin: Chip; rank: number | null; counted: string; traders: number; qualifies: boolean; fees: string }[];
  balance?: { earned: string; paid: string; available: string };
  prizes?: { week: number; rank: number; lamports: string; status: string; sig: string | null; coin: Chip | null }[];
  prizePaid?: string;
  prizeOwed?: string;
}

const solscan = (sig: string, cluster: string) => `https://solscan.io/tx/${sig}${cluster === "devnet" ? "?cluster=devnet" : ""}`;

function useMe(session: string | null) {
  const [me, setMe] = useState<Me | null>(null);
  const load = useCallback(() => {
    fetch("/api/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: Me) => setMe(j))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    let live = true;
    fetch("/api/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: Me) => {
        if (live) setMe(j);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [session]);
  return { me, reload: load };
}

function SignInFirst() {
  const w = useWallet();
  const [err, setErr] = useState("");
  return (
    <div className="card mt-8 grid place-items-center px-6 py-14 text-center">
      <p className="display-lg text-[30px]">Sign in to see your coins</p>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">Connect the wallet you launched with and sign a short message. It costs nothing.</p>
      <button type="button" className="btn-white mt-6 inline-flex h-11 items-center rounded-full px-6 text-[14px]" data-testid="manage-signin" onClick={() => ensureSession(w).catch((e) => setErr(errorText(e)))}>
        Connect wallet
      </button>
      {err && <p className="notice notice-alert mt-4">{err}</p>}
    </div>
  );
}

/** /manage: the signed-in launcher's coins, fee share, prizes and withdraw. */
export function MyCoins({ cluster }: { cluster: string }) {
  const w = useWallet();
  const { me, reload } = useMe(w.session);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  if (!w.session) return <SignInFirst />;
  if (!me || !me.balance) return <p className="mt-8 text-muted-foreground">Loading…</p>;
  const available = BigInt(me.balance.available);
  const coins = me.coins ?? [];
  const prizes = me.prizes ?? [];

  async function take() {
    setMsg("");
    setBusy(true);
    try {
      const r = await api<{ lamports: string; sig: string }>("/api/withdraw", {});
      setMsg(`Sent ${sol(r.lamports, 4)} to your wallet.`);
      reload();
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="min-w-0 space-y-6">
        <div className="grid gap-3" data-testid="my-coins">
          {coins.length === 0 && (
            <div className="card px-6 py-12 text-center">
              <p className="display-lg text-[28px]">No coins launched from this wallet</p>
              <Link href="/launch" className="btn-hot mt-5 inline-flex h-11 items-center rounded-full px-6 text-[14px]">
                Launch a coin
              </Link>
            </div>
          )}
          {coins.map((c) => (
            <Link key={c.coin.id} href={`/c/${c.coin.slug}`} className="card flex flex-wrap items-center gap-4 p-4 hover:border-foreground" data-testid="my-coin">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.coin.avatar} alt="" className="h-12 w-12 rounded-xl object-cover" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{c.coin.name}</div>
                <div className="mono text-[12px] text-muted-foreground">${c.coin.ticker}</div>
              </div>
              <div className="text-right">
                <div className="label">rank this week</div>
                <div className="num text-[26px] leading-none" data-testid="my-coin-rank">
                  {c.rank ? `#${c.rank}` : "—"}
                </div>
              </div>
              <div className="text-right">
                <div className="label">counted</div>
                <div className="mono text-[14px]">{sol(c.counted, 2)}</div>
              </div>
              <div className="text-right">
                <div className="label">your fees</div>
                <div className="mono text-[14px]">{sol(c.fees, 4)}</div>
              </div>
            </Link>
          ))}
        </div>

        <div className="card p-5" data-testid="my-prizes">
          <div className="label">Prizes</div>
          {prizes.length === 0 ? (
            <p className="mt-3 text-[14px] text-muted-foreground">No prizes yet. The top coins&apos; launchers are paid when each week closes.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {prizes.map((p) => (
                <li key={`${p.week}-${p.rank}`} className="flex flex-wrap items-center justify-between gap-3 py-3 text-[14px]" data-testid="my-prize">
                  <span>
                    Week {p.week} · #{p.rank}
                    {p.coin ? ` · $${p.coin.ticker}` : ""}
                  </span>
                  <span className="num text-[20px]">{sol(p.lamports, 4)}</span>
                  {p.sig ? (
                    <a className="link mono text-[12.5px]" href={solscan(p.sig, cluster)} target="_blank" rel="noreferrer">
                      paid · {p.sig.slice(0, 8)}…
                    </a>
                  ) : (
                    <span className="mono text-[12.5px] text-warn">owed · sent on the next update</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <aside className="space-y-4">
        <div className="card p-5" data-testid="balance-card">
          <div className="label">Your fee share, available</div>
          <div className="num mt-3 text-[44px] leading-none" data-testid="available">
            {sol(me.balance.available, 4)}
          </div>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Earned {sol(me.balance.earned, 4)} · withdrawn {sol(me.balance.paid, 4)}
          </p>
          <button type="button" className="btn-hot mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full text-[14px]" data-testid="withdraw" disabled={busy || available <= BigInt(0)} onClick={take}>
            {busy && <span className="spinner" />}
            Withdraw to my wallet
          </button>
          {msg && (
            <p className="notice mt-4 text-[13px]" data-testid="withdraw-msg">
              {msg}
            </p>
          )}
        </div>
        <div className="card p-5">
          <div className="label">Prizes received</div>
          <div className="num mt-3 text-[32px] leading-none" data-testid="prize-paid">
            {sol(me.prizePaid ?? "0", 4)}
          </div>
          {BigInt(me.prizeOwed ?? "0") > BigInt(0) && <p className="mono mt-2 text-[12.5px] text-warn">{sol(me.prizeOwed ?? "0", 4)} owed, sent on the next update</p>}
          <p className="mt-3 text-[12.5px] text-muted-foreground">Prizes are sent straight to your wallet; they are not part of the withdrawable balance.</p>
        </div>
      </aside>
    </div>
  );
}
