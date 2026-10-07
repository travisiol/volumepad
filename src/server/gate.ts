import { HttpError } from "./errors.ts";

/** Throws 403 unless `owner` holds at least `min` base units of `mint`. `readBalance` is injectable for tests. */
export async function assertBalance(
  owner: string,
  mint: string | null,
  min: bigint,
  readBalance: (owner: string, mint: string) => Promise<bigint>,
): Promise<bigint> {
  if (min <= BigInt(0)) return BigInt(0);
  if (!mint) throw new HttpError(403, "Holding the coin is required for this.");
  const balance = await readBalance(owner, mint);
  if (balance < min) throw new HttpError(403, "Holding more of the coin is required for this.");
  return balance;
}
