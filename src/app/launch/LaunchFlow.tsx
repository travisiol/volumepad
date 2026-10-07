"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ensureSession, errorText, readFileAsDataUrl, sendPrepared } from "@/components/actions";
import { useWallet } from "@/components/wallet/store";

export interface FlowConfig {
  launcher: number;
  pot: number;
  platform: number;
  minTraders: number;
  walletCapSol: number;
  prizes: number[];
  maxImageMb: number;
}

const STEPS = ["Coin", "Links", "Launch"] as const;

export function LaunchFlow({ cfg }: { cfg: FlowConfig }) {
  const w = useWallet();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [website, setWebsite] = useState("");
  const [x, setX] = useState("");
  const [telegram, setTelegram] = useState("");
  const [firstBuy, setFirstBuy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const cleanTicker = ticker.replace(/^\$/, "").toUpperCase();
  const valid = [name.trim().length >= 2 && /^\$?[A-Za-z0-9]{2,10}$/.test(ticker.trim()) && description.trim().length >= 8 && Boolean(image), true, true];

  async function pickImage(file: File | undefined) {
    setError("");
    if (!file) return;
    if (file.size > cfg.maxImageMb * 1024 * 1024) return setError(`The image must be under ${cfg.maxImageMb} MB.`);
    try {
      setImage(await readFileAsDataUrl(file));
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function launch() {
    setError("");
    setBusy(true);
    try {
      if (!(await ensureSession(w))) return;
      setStatus("Preparing…");
      const prep = await api<{ id: string; transaction: string | null }>("/api/launch", { name, ticker, description, imageDataUrl: image, website, x, telegram, firstBuySol: firstBuy });
      let sig: string | null = null;
      if (prep.transaction) {
        setStatus("Sign the first buy in your wallet…");
        sig = await sendPrepared(prep.transaction);
      }
      setStatus("Launching on pump.fun…");
      const done = await api<{ slug: string }>("/api/launch", { action: "submit", id: prep.id, sig });
      router.push(`/c/${done.slug}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  return (
    <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="card min-w-0 p-5 sm:p-7">
        <ol className="no-scrollbar flex gap-2 overflow-x-auto pb-1" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => (i <= step || valid.slice(0, i).every(Boolean) ? setStep(i) : undefined)}
                className={`mono whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium ${i === step ? "border-foreground bg-foreground text-white" : "border-border text-muted-foreground"}`}
              >
                {String(i + 1).padStart(2, "0")} · {s}
              </button>
            </li>
          ))}
        </ol>

        <div className="mt-7 min-h-[300px]">
          {step === 0 && (
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className="label">Name</span>
                  <input className="field" data-testid="name" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} placeholder="Frog Taxes" />
                </label>
                <label className="grid gap-1.5">
                  <span className="label">Ticker</span>
                  <input className="field mono uppercase" data-testid="ticker" value={ticker} maxLength={11} onChange={(e) => setTicker(e.target.value)} placeholder="FROG" />
                </label>
              </div>
              <label className="grid gap-1.5">
                <span className="label">One line about the coin</span>
                <input className="field" data-testid="description" value={description} maxLength={140} onChange={(e) => setDescription(e.target.value)} placeholder="A frog who files everyone's taxes, badly." />
              </label>
              <label className="grid gap-1.5">
                <span className="label">Image (PNG, JPG, WEBP or GIF, up to {cfg.maxImageMb} MB)</span>
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-testid="image" className="field text-[13px]" onChange={(e) => pickImage(e.target.files?.[0])} />
              </label>
            </div>
          )}

          {step === 1 && (
            <div className="grid gap-4">
              <p className="text-[14px] text-muted-foreground">All optional. They are passed to pump.fun with the coin and shown on its page here.</p>
              <label className="grid gap-1.5">
                <span className="label">Website</span>
                <input className="field" data-testid="website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="frogtaxes.xyz" />
              </label>
              <label className="grid gap-1.5">
                <span className="label">X link</span>
                <input className="field" data-testid="x" value={x} onChange={(e) => setX(e.target.value)} placeholder="x.com/frogtaxes" />
              </label>
              <label className="grid gap-1.5">
                <span className="label">Telegram</span>
                <input className="field" value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="t.me/frogtaxes" />
              </label>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-5">
              <dl className="grid grid-cols-2 gap-3 text-[14px] sm:grid-cols-3">
                <Row k="Coin" v={`${name || "—"} · $${cleanTicker || "—"}`} />
                <Row k="Launch fee" v="Free" />
                <Row k="You earn" v={`${cfg.launcher} % of fees`} />
                <Row k="Weekly pot" v={`${cfg.pot} % of fees`} />
                <Row k="$VOLUMEPAD burn" v={`${cfg.platform} % of fees`} />
                <Row k="Top 3 prizes" v={cfg.prizes.map((p) => `${p} %`).join(" / ")} />
              </dl>
              <label className="grid gap-1.5 sm:max-w-xs">
                <span className="label">First buy in SOL (optional)</span>
                <input className="field mono" data-testid="first-buy" inputMode="decimal" value={firstBuy} onChange={(e) => setFirstBuy(e.target.value)} placeholder="0" />
              </label>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                The coin launches on pump.fun from the VOLUMEPAD launch wallet, which is its creator of record; you are its launcher here and its fee share and prizes go to your wallet. A first buy is one transfer you sign; the tokens it buys are forwarded to you. Your own trades and the launch wallet&apos;s never count toward the leaderboard.
              </p>
              <button type="button" className="btn-hot inline-flex items-center justify-center gap-2 rounded-full px-8 py-3.5 text-[16px] sm:w-fit" data-testid="launch" disabled={busy} onClick={launch}>
                {busy && <span className="spinner" />}
                {busy ? status || "Working…" : "Launch the coin"}
              </button>
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="notice notice-alert mt-5" data-testid="launch-error">
            {error}
          </p>
        )}

        <div className="mt-6 flex items-center justify-between border-t border-border pt-5">
          <button type="button" className="btn btn-quiet rounded-full" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
            Back
          </button>
          {step < STEPS.length - 1 && (
            <button type="button" className="btn btn-primary rounded-full" data-testid="next" disabled={!valid[step]} onClick={() => setStep((s) => s + 1)}>
              Next
            </button>
          )}
        </div>
      </div>

      {/* the visitor's own draft, in the leaderboard row it will take */}
      <div className="w-full">
        <div className="label">Your row on the leaderboard</div>
        <div className="card mt-3 p-4">
          <div className="flex items-center gap-3">
            <span className="num grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-[18px] text-muted-foreground">–</span>
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
            ) : (
              <span className="h-11 w-11 shrink-0 rounded-xl border border-dashed border-border bg-raised" />
            )}
            <div className="min-w-0">
              <div className="truncate font-semibold">{name || "Your coin"}</div>
              <div className="mono text-[12px] text-muted-foreground">${cleanTicker || "TICKER"}</div>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 text-[13px]">
            <div>
              <dt className="label">counted volume</dt>
              <dd className="num mt-1 text-[22px]">0 SOL</dd>
            </div>
            <div>
              <dt className="label">traders</dt>
              <dd className="num mt-1 text-[22px]">0 / {cfg.minTraders}</dd>
            </div>
          </dl>
        </div>
        <ul className="mt-4 space-y-2 text-[13px] leading-snug text-muted-foreground">
          <li>Ranks once {cfg.minTraders} different wallets have traded it this week.</li>
          <li>Each wallet counts up to {cfg.walletCapSol} SOL a week.</li>
          <li>Nothing launches until you press Launch.</li>
        </ul>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background p-3">
      <dt className="label">{k}</dt>
      <dd className="mt-1 font-semibold">{v}</dd>
    </div>
  );
}
