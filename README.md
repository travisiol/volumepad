# VOLUMEPAD — Launch. Rank. Win the pot.

A pump.fun launchpad where the launcher has something to win. Every coin's creator fees are split 60 % to its
launcher (withdrawable), 30 % to a weekly pot, 10 % to $VOLUMEPAD buy & burn. Each week coins are ranked by counted
volume (anti-wash rules in code) and the pot is paid to the launchers of the top 3 coins, 50 / 30 / 20.
Next 16 + React 19 + Tailwind 4, `@solana/web3.js`, `node:sqlite`. Port 3976. Off-chain + SPL: no custom program.

## Mechanic

| Piece | Where |
|---|---|
| Constants + env (shares, cap, min traders, prize split, week window) | `src/config/volumepad.ts` |
| Launch wizard (coin → links → launch). Free; optional first buy = one SOL transfer + memo `volumepad launch <id>` read back from chain → `LAUNCH_WEBHOOK`. Operator wallet = creator of record. 3 launches / wallet / day | `src/server/launch.ts`, `POST /api/launch`, `/launch` |
| Sweep: bonding-curve signatures per coin → pump.fun TradeEvents → every trade stored (wallet, SOL, timestamp, week) + each creator fee split launcher / pot (week of the trade) / platform; `collectCreatorFee` claim (vault read fresh) | `src/server/sweep.ts` |
| Week: counted volume (wallet cap, launcher/operator/creator excluded, min traders, tie = earlier first counted trade), settlement (idempotent, frozen JSON standings), prizes owed → operator SOL transfers simulated then sent, rollover of unpaid shares and dust | `src/server/week.ts` |
| Tick = sweep → settle → pay prizes → buy & burn; `/api/tick` (cron, `TICK_SECRET`/`CRON_SECRET`) and `after()` on a page visit when > 10 min old | `src/server/tick.ts`, `src/server/views.ts` |
| Buy & burn of $VOLUMEPAD via Jupiter (held until `NEXT_PUBLIC_MINT`) | `src/server/burn.ts` |
| Pages | `/` `/launch` `/leaderboard` `/weeks` `/c/[slug]` `/manage` `/ledger` `/docs`; JSON `/api/board` polled every 30 s |

Webhook contract: `POST LAUNCH_WEBHOOK`, header `x-volumepad-secret: LAUNCH_SECRET`, body
`{id, name, ticker, description, imageDataUrl, website, twitter, telegram, launcher, firstBuyLamports}` →
`200 {mint, signature, creator, tokensBought?}` (`tokensBought` is forwarded to the launcher).

## Keys

| Key | Unlocks | Without it |
|---|---|---|
| `LAUNCH_WEBHOOK` + `OPERATOR_SECRET_KEY` | launching, claims, prizes, withdrawals | "Launching is not open yet." / prizes stay owed |
| `NEXT_PUBLIC_MINT` | $VOLUMEPAD buy & burn | platform share held, shown as held |
| `TICK_SECRET` / `CRON_SECRET` | `/api/tick` from the cron | ticks only run from page visits |
| `VOLUMEPAD_DB_PATH` | persistent sqlite | `./data/volumepad.db`, or the temp dir on a read-only disk (Vercel: lost per instance) |

## Run

```
npm install
npm test              # node tests on the fake RPC
npx next build && node scripts/play-ui.mjs   # CDP flow proof, screenshots in shots/
npm run dev           # http://localhost:3976
```
