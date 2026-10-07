import { readFileSync } from "node:fs";

/**
 * Server clock. Real time, plus an offset in ms read from the file named by CLOCK_OFFSET_FILE when that variable
 * is set (the local rig uses it to move past a week boundary; production never sets it).
 */
export function now(): number {
  const file = process.env["CLOCK_OFFSET_FILE"]?.trim();
  if (!file) return Date.now();
  try {
    return Date.now() + (Number(readFileSync(/* turbopackIgnore: true */ file, "utf8").trim()) || 0);
  } catch {
    return Date.now();
  }
}
