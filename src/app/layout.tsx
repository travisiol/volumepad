import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Antonio, IBM_Plex_Mono, Inter } from "next/font/google";
import { Header, XIcon } from "@/components/Chrome";
import { Logo } from "@/components/Logo";
import { WalletDialog } from "@/components/wallet/WalletDialog";
import { SITE } from "@/config/site";
import { CLUSTER } from "@/config/solana";
import "./globals.css";

const display = Antonio({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-antonio" });
const body = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-inter" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name} — ${SITE.hook}`, template: `%s · ${SITE.name}` },
  description: SITE.description,
  openGraph: { title: `${SITE.name} — ${SITE.hook}`, description: SITE.description },
};

export const viewport: Viewport = { themeColor: "#f7f8f4" };

const xUrl = SITE.xHandle ? `https://x.com/${SITE.xHandle}` : null;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="min-h-svh">
        <div className="min-h-screen bg-background">
          <Header xUrl={xUrl} />
          <main>{children}</main>
          <footer className="border-t border-border bg-background">
            <div className="mx-auto grid max-w-[1200px] gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.4fr_1fr_1fr_1fr] lg:px-8">
              <div>
                <Link href="/" className="inline-flex items-center gap-2.5">
                  <Logo className="h-8 w-8" />
                  <span className="font-display text-[26px] leading-none">VOLUMEPAD</span>
                </Link>
                <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">{SITE.disclaimer}</p>
              </div>
              <FooterCol title="Product" links={[["/launch", "Launch"], ["/leaderboard", "Leaderboard"], ["/weeks", "Past weeks"], ["/manage", "My coins"]]} />
              <FooterCol title="Open books" links={[["/docs", "Documentation"], ["/ledger", "Ledger"], ["/api/health", "Status"]]} />
              <FooterCol title="Support" links={[["/docs#faq", "Help"], ...(xUrl ? [[xUrl, `X @${SITE.xHandle}`] as [string, string]] : [])]} />
            </div>
            <div className="border-t border-border">
              <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-muted-foreground sm:px-6 lg:px-8">
                <span className="flex items-center gap-2">
                  © 2026 VOLUMEPAD
                  {xUrl && (
                    <a href={xUrl} className="inline-flex items-center gap-1 hover:text-foreground">
                      · <XIcon className="h-3 w-3" />@{SITE.xHandle}
                    </a>
                  )}
                </span>
                <span className="mono">Built on Solana · {CLUSTER === "devnet" ? "devnet" : "mainnet"} · rankings use counted volume</span>
              </div>
            </div>
          </footer>
        </div>
        <WalletDialog />
      </body>
    </html>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="label">{title}</div>
      <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
        {links.map(([href, label]) => (
          <li key={href}>
            <a href={href} className="hover:text-foreground">
              {label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
