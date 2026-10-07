export function shortAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

/** Integer base units → decimal string, without float rounding. */
export function formatUnits(amount: bigint, decimals: number, maxFraction = 4): string {
  const negative = amount < BigInt(0);
  const abs = negative ? -amount : amount;
  const base = BigInt(10) ** BigInt(decimals);
  const whole = abs / base;
  let fraction = decimals > 0 ? (abs % base).toString().padStart(decimals, "0").slice(0, maxFraction) : "";
  fraction = fraction.replace(/0+$/, "");
  const wholeText = whole.toLocaleString("en-US");
  return `${negative ? "-" : ""}${wholeText}${fraction ? `.${fraction}` : ""}`;
}

export function formatSol(lamports: bigint | number): string {
  return formatUnits(BigInt(lamports), 9, 4);
}

export function formatUsd(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: value < 10 ? 2 : 0 });
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export function isBase58Address(value: unknown): value is string {
  return typeof value === "string" && BASE58.test(value);
}
