/**
 * An in-process Solana JSON-RPC server with canned accounts, for tests and for scripts/play-ui.mjs.
 * Answers the methods the base uses, in the shapes @solana/web3.js 1.98 validates. Tests listen on an
 * OS-assigned port (0); standalone it listens on FAKE_RPC_PORT (8976 = project port 3976 + 5000).
 *
 *   node tests/fake-rpc.ts            -> prints {"url": "..."} and serves until killed
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import bs58 from "bs58";
import { VersionedTransaction } from "@solana/web3.js";

export interface FakeAccount {
  lamports: number;
  owner: string;
  data?: Buffer;
}

export interface FakeState {
  slot: number;
  blockhash: string;
  accounts: Map<string, FakeAccount>;
  largest: Map<string, { address: string; amount: bigint; decimals: number }[]>;
  supply: Map<string, { amount: bigint; decimals: number }>;
  sent: { signature: string; raw: Buffer }[];
  calls: string[];
  /** Canned transactions by signature (logs only), e.g. pump.fun trades. */
  txs: Map<string, { slot: number; logs: string[] }>;
  /** Signatures touching an address, newest first. */
  sigsFor: Map<string, string[]>;
  /** When set, simulateTransaction answers this error. */
  simulateErr?: unknown;
}

export const SYSTEM = "11111111111111111111111111111111";

/** A 165-byte SPL token account: mint, owner, amount (offset 64). */
export function tokenAccountData(mint: string, owner: string, amount: bigint): Buffer {
  const b = Buffer.alloc(165);
  Buffer.from(bs58.decode(mint)).copy(b, 0);
  Buffer.from(bs58.decode(owner)).copy(b, 32);
  b.writeBigUInt64LE(amount, 64);
  b[108] = 1; // initialized
  return b;
}

/** An 82-byte mint account with `decimals` at offset 44. */
export function mintData(decimals: number, supply: bigint): Buffer {
  const b = Buffer.alloc(82);
  b.writeBigUInt64LE(supply, 36);
  b[44] = decimals;
  b[45] = 1;
  return b;
}

export function newState(): FakeState {
  return {
    slot: 1000,
    blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi",
    accounts: new Map(),
    largest: new Map(),
    supply: new Map(),
    sent: [],
    calls: [],
    txs: new Map(),
    sigsFor: new Map(),
  };
}

function encodeAccount(a: FakeAccount | undefined) {
  if (!a) return null;
  const data = a.data ?? Buffer.alloc(0);
  return { data: [data.toString("base64"), "base64"], executable: false, lamports: a.lamports, owner: a.owner, rentEpoch: 0, space: data.length };
}

/** First signature of a wire transaction = its id. */
function signatureOf(raw: Buffer): string {
  return bs58.encode(raw.subarray(1, 65));
}

type Params = unknown[];

export const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const COLLECT_CREATOR_FEE = Buffer.from([20, 22, 86, 123, 198, 28, 219, 132]);
const VAULT_RENT = 890_880;

/** Every SPL token account (165 bytes) whose mint/owner pass `pick`. */
export function tokenAccountsOf(state: FakeState, pick: (mint: string, owner: string) => boolean): { address: string; mint: string; owner: string; amount: bigint }[] {
  const out: { address: string; mint: string; owner: string; amount: bigint }[] = [];
  for (const [address, a] of state.accounts) {
    if (a.owner !== TOKEN || !a.data || a.data.length !== 165) continue;
    const mint = bs58.encode(a.data.subarray(0, 32));
    const owner = bs58.encode(a.data.subarray(32, 64));
    if (pick(mint, owner)) out.push({ address, mint, owner, amount: a.data.readBigUInt64LE(64) });
  }
  return out;
}

function moveTokens(state: FakeState, src: string, dst: string, amount: bigint) {
  const s = state.accounts.get(src)?.data;
  const d = state.accounts.get(dst)?.data;
  if (!s || !d) return;
  s.writeBigUInt64LE(s.readBigUInt64LE(64) - amount, 64);
  d.writeBigUInt64LE(d.readBigUInt64LE(64) + amount, 64);
}

/**
 * Applies the effects the base relies on: System CreateAccount / Transfer, SPL InitializeMint2 /
 * MintTo / Transfer / TransferChecked / Burn(Checked), ATA Create(Idempotent). Everything else is
 * accepted without effect (pump.fun, Memo).
 */
export function applyTx(state: FakeState, raw: Buffer) {
  let vtx: VersionedTransaction;
  try {
    vtx = VersionedTransaction.deserialize(raw);
  } catch {
    return;
  }
  const keys = vtx.message.staticAccountKeys.map((k) => k.toBase58());
  for (const ix of vtx.message.compiledInstructions) {
    const program = keys[ix.programIdIndex];
    const acc = ix.accountKeyIndexes.map((i) => keys[i]);
    const data = Buffer.from(ix.data);
    if (program === SYSTEM && data.length >= 4) {
      const op = data.readUInt32LE(0);
      if (op === 0) {
        const lamports = Number(data.readBigUInt64LE(4));
        const space = Number(data.readBigUInt64LE(12));
        const owner = bs58.encode(data.subarray(20, 52));
        const from = state.accounts.get(acc[0]);
        if (from) from.lamports -= lamports;
        state.accounts.set(acc[1], { lamports, owner, data: Buffer.alloc(space) });
      } else if (op === 2) {
        const lamports = Number(data.readBigUInt64LE(4));
        const from = state.accounts.get(acc[0]);
        if (from) from.lamports -= lamports;
        const to = state.accounts.get(acc[1]) ?? { lamports: 0, owner: SYSTEM };
        to.lamports += lamports;
        state.accounts.set(acc[1], to);
      }
    } else if (program === TOKEN) {
      const op = data[0];
      if (op === 20) {
        const m = state.accounts.get(acc[0]);
        const md = mintData(data[1], BigInt(0));
        if (m) m.data = md;
        state.supply.set(acc[0], { amount: BigInt(0), decimals: data[1] });
      } else if (op === 7) {
        const amount = data.readBigUInt64LE(1);
        const d = state.accounts.get(acc[1])?.data;
        if (d) d.writeBigUInt64LE(d.readBigUInt64LE(64) + amount, 64);
        const s = state.supply.get(acc[0]);
        if (s) s.amount += amount;
      } else if (op === 3) moveTokens(state, acc[0], acc[1], data.readBigUInt64LE(1));
      else if (op === 12) moveTokens(state, acc[0], acc[2], data.readBigUInt64LE(1));
      else if (op === 8 || op === 15) {
        const amount = data.readBigUInt64LE(1);
        const d = state.accounts.get(acc[0])?.data;
        if (d) d.writeBigUInt64LE(d.readBigUInt64LE(64) - amount, 64);
      }
    } else if (program === PUMP && data.subarray(0, 8).equals(COLLECT_CREATOR_FEE)) {
      // collectCreatorFee: the creator vault (acc[1]) pays everything above rent to the creator (acc[0]).
      const vault = state.accounts.get(acc[1]);
      if (vault && vault.lamports > VAULT_RENT) {
        const moved = vault.lamports - VAULT_RENT;
        vault.lamports = VAULT_RENT;
        const to = state.accounts.get(acc[0]) ?? { lamports: 0, owner: SYSTEM };
        to.lamports += moved;
        state.accounts.set(acc[0], to);
      }
    } else if (program === ATA) {
      const [, ata, owner, mint] = acc;
      if (!state.accounts.has(ata)) state.accounts.set(ata, { lamports: 2_039_280, owner: TOKEN, data: tokenAccountData(mint, owner, BigInt(0)) });
    }
  }
}

export function answer(state: FakeState, method: string, params: Params): { result?: unknown; error?: { code: number; message: string } } {
  state.calls.push(method);
  const context = { slot: state.slot, apiVersion: "2.2.0" };
  switch (method) {
    case "getHealth":
      return { result: "ok" };
    case "getSlot":
      return { result: state.slot };
    case "getBlockHeight":
      return { result: state.slot };
    case "getBalance":
      return { result: { context, value: state.accounts.get(String(params[0]))?.lamports ?? 0 } };
    case "getAccountInfo":
      return { result: { context, value: encodeAccount(state.accounts.get(String(params[0]))) } };
    case "getMultipleAccounts":
      return { result: { context, value: (params[0] as string[]).map((k) => encodeAccount(state.accounts.get(k))) } };
    case "getTokenAccountBalance": {
      const a = state.accounts.get(String(params[0]));
      if (!a?.data) return { error: { code: -32602, message: "Invalid param: could not find account" } };
      const amount = a.data.readBigUInt64LE(64);
      const mint = bs58.encode(a.data.subarray(0, 32));
      const decimals = state.supply.get(mint)?.decimals ?? 6;
      return { result: { context, value: { amount: amount.toString(), decimals, uiAmount: Number(amount) / 10 ** decimals, uiAmountString: String(Number(amount) / 10 ** decimals) } } };
    }
    case "getTokenSupply": {
      const s = state.supply.get(String(params[0]));
      if (!s) return { error: { code: -32602, message: "Invalid param: not a Token mint" } };
      return { result: { context, value: { amount: s.amount.toString(), decimals: s.decimals, uiAmount: Number(s.amount) / 10 ** s.decimals, uiAmountString: String(Number(s.amount) / 10 ** s.decimals) } } };
    }
    case "getTokenLargestAccounts": {
      const list = state.largest.get(String(params[0])) ?? tokenAccountsOf(state, (mint) => mint === String(params[0])).map((t) => ({ address: t.address, amount: t.amount, decimals: state.supply.get(t.mint)?.decimals ?? 0 })).sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
      return {
        result: {
          context,
          value: list.map((l) => ({ address: l.address, amount: l.amount.toString(), decimals: l.decimals, uiAmount: Number(l.amount) / 10 ** l.decimals, uiAmountString: String(Number(l.amount) / 10 ** l.decimals) })),
        },
      };
    }
    case "getTokenAccountsByOwner": {
      const owner = String(params[0]);
      const filter = (params[1] ?? {}) as { mint?: string };
      const value = tokenAccountsOf(state, (mint, o) => o === owner && (!filter.mint || filter.mint === mint)).map((t) => ({ pubkey: t.address, account: encodeAccount(state.accounts.get(t.address)) }));
      return { result: { context, value } };
    }
    case "getMinimumBalanceForRentExemption":
      return { result: 890_880 + Math.max(0, Number(params[0] ?? 0)) * 6960 };
    case "simulateTransaction":
      return { result: { context, value: { err: state.simulateErr ?? null, logs: [], accounts: null, unitsConsumed: 1000, returnData: null } } };
    case "getProgramAccounts": {
      const program = String(params[0]);
      const cfg = (params[1] ?? {}) as { filters?: ({ dataSize: number } | { memcmp: { offset: number; bytes: string } })[]; dataSlice?: { offset: number; length: number } };
      const list = [...state.accounts.entries()].filter(([, a]) => {
        if (a.owner !== program || !a.data) return false;
        for (const f of cfg.filters ?? []) {
          if ("dataSize" in f && a.data.length !== f.dataSize) return false;
          if ("memcmp" in f) {
            const want = Buffer.from(bs58.decode(f.memcmp.bytes));
            if (!a.data.subarray(f.memcmp.offset, f.memcmp.offset + want.length).equals(want)) return false;
          }
        }
        return true;
      });
      return {
        result: list.map(([pubkey, a]) => {
          const d = cfg.dataSlice ? a.data!.subarray(cfg.dataSlice.offset, cfg.dataSlice.offset + cfg.dataSlice.length) : a.data!;
          return { pubkey, account: { data: [d.toString("base64"), "base64"], executable: false, lamports: a.lamports, owner: a.owner, rentEpoch: 0, space: a.data!.length } };
        }),
      };
    }
    case "getLatestBlockhash":
      return { result: { context, value: { blockhash: state.blockhash, lastValidBlockHeight: state.slot + 150 } } };
    case "sendTransaction": {
      const raw = Buffer.from(String(params[0]), "base64");
      const signature = signatureOf(raw);
      state.sent.push({ signature, raw });
      applyTx(state, raw);
      return { result: signature };
    }
    case "getSignatureStatuses": {
      const sigs = params[0] as string[];
      return {
        result: {
          context,
          value: sigs.map((s) => (state.sent.some((t) => t.signature === s) ? { slot: state.slot, confirmations: 1, err: null, status: { Ok: null }, confirmationStatus: "confirmed" } : null)),
        },
      };
    }
    case "getSignaturesForAddress": {
      const all = state.sigsFor.get(String(params[0])) ?? [];
      const opts = (params[1] ?? {}) as { limit?: number; before?: string; until?: string };
      let list = all;
      if (opts.before) list = list.slice(list.indexOf(opts.before) + 1);
      if (opts.until) {
        const i = list.indexOf(opts.until);
        if (i >= 0) list = list.slice(0, i);
      }
      list = list.slice(0, opts.limit ?? 1000);
      return { result: list.map((signature) => ({ signature, slot: state.txs.get(signature)?.slot ?? state.slot, err: null, memo: null, blockTime: 1_759_000_000, confirmationStatus: "confirmed" })) };
    }
    case "getTransaction": {
      const sig = String(params[0]);
      const sent = state.sent.find((t) => t.signature === sig);
      if (sent) {
        const vtx = VersionedTransaction.deserialize(sent.raw);
        const m = vtx.message;
        const keys = m.staticAccountKeys.map((k) => k.toBase58());
        return {
          result: {
            slot: state.slot,
            blockTime: 1_759_000_000,
            meta: { err: null, fee: 5000, preBalances: keys.map(() => 0), postBalances: keys.map(() => 0), logMessages: [], innerInstructions: [], preTokenBalances: [], postTokenBalances: [] },
            transaction: {
              signatures: vtx.signatures.map((x) => bs58.encode(x)),
              message: {
                accountKeys: keys,
                header: m.header,
                instructions: m.compiledInstructions.map((ix) => ({ programIdIndex: ix.programIdIndex, accounts: ix.accountKeyIndexes, data: bs58.encode(ix.data) })),
                recentBlockhash: m.recentBlockhash,
              },
            },
          },
        };
      }
      const canned = state.txs.get(sig);
      if (!canned) return { result: null };
      return {
        result: {
          slot: canned.slot,
          blockTime: 1_759_000_000,
          meta: { err: null, fee: 5000, preBalances: [0], postBalances: [0], logMessages: canned.logs, innerInstructions: [], preTokenBalances: [], postTokenBalances: [] },
          transaction: {
            signatures: [sig],
            message: { accountKeys: [SYSTEM], header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 0 }, instructions: [], recentBlockhash: state.blockhash },
          },
        },
      };
    }
    default:
      return { error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

export async function startFakeRpc(state: FakeState = newState(), listenPort = 0): Promise<{ url: string; state: FakeState; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    // The stub wallet in play-ui sends from the page's origin.
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400).end();
        return;
      }
      const one = (call: { id?: unknown; method: string; params?: Params }) => ({ jsonrpc: "2.0", id: call.id ?? null, ...answer(state, call.method, call.params ?? []) });
      const out = Array.isArray(parsed) ? parsed.map(one) : one(parsed as { method: string });
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
    });
  });
  await new Promise<void>((r) => server.listen(listenPort, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

// Standalone mode for scripts/play-ui.mjs: seeds a wallet balance given as FAKE_WALLET (+ FAKE_LAMPORTS).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "")) {
  const state = newState();
  const wallet = process.env.FAKE_WALLET;
  if (wallet) state.accounts.set(wallet, { lamports: Number(process.env.FAKE_LAMPORTS ?? 2_500_000_000), owner: SYSTEM });
  const { url } = await startFakeRpc(state, Number(process.env.FAKE_RPC_PORT ?? 8976));
  console.log(JSON.stringify({ url }));
}
