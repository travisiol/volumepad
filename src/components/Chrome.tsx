"use client";

import Link from "next/link";
import { useState } from "react";
import { shortAddress } from "@/lib/format";
import { IconWallet } from "./Icons";
import { Logo } from "./Logo";
import { openWalletDialog, useWallet } from "./wallet/store";

const NAV = [
  { href: "/launch", label: "Launch" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/weeks", label: "Past weeks" },
  { href: "/manage", label: "My coins" },
  { href: "/docs", label: "Docs" },
];

export function XIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M18.2 2.3h3.4l-7.4 8.4 8.7 11.5h-6.8l-5.3-7-6.1 7H1.3l7.9-9L.8 2.3h7l4.8 6.4zm-1.2 17.9h1.9L7.1 4.2H5.1z" />
    </svg>
  );
}

function WalletButton() {
  const w = useWallet();
  const shown = w.address ?? w.session;
  return (
    <button type="button" onClick={openWalletDialog} className="wallet-connect btn-line inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px]">
      {shown ? <span className="dot" aria-hidden="true" /> : <IconWallet width={15} height={15} />}
      {shown ? <span className="mono">{shortAddress(shown)}</span> : "Connect wallet"}
    </button>
  );
}

export function Header({ xUrl }: { xUrl: string | null }) {
  const [menu, setMenu] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-[76px] max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="inline-flex select-none items-center gap-2.5">
          <Logo className="h-8 w-8" />
          <span className="font-display hidden text-[26px] leading-none min-[420px]:inline">VOLUMEPAD</span>
        </Link>
        <nav className="hidden items-center gap-1 rounded-full border border-border bg-panel p-1 text-[14px] font-medium text-muted-foreground lg:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-full px-3.5 py-1.5 transition-colors hover:bg-raised hover:text-foreground">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {xUrl && (
            <a href={xUrl} aria-label="VOLUMEPAD on X" className="hidden h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground sm:grid">
              <XIcon />
            </a>
          )}
          <WalletButton />
          <Link href="/launch" className="btn-hot hidden h-9 items-center rounded-full px-4 text-[13px] sm:inline-flex">
            Launch a coin
          </Link>
          <button type="button" aria-label="Menu" onClick={() => setMenu((m) => !m)} className="grid h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground hover:text-foreground lg:hidden">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
        </div>
      </div>
      {menu && (
        <nav className="border-t border-border px-4 py-3 lg:hidden">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setMenu(false)} className="flex items-center gap-2 py-2.5 text-[15px] font-medium text-muted-foreground hover:text-foreground">
              {n.label}
            </Link>
          ))}
          <Link href="/launch" onClick={() => setMenu(false)} className="btn-hot mt-2 flex h-11 items-center justify-center rounded-xl text-[15px]">
            Launch a coin
          </Link>
        </nav>
      )}
    </header>
  );
}
