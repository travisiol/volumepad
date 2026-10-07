"use client";

import { openWalletDialog, signAndSendTransaction, signIn, walletErrorMessage } from "./wallet/store";
import type { WalletState } from "./wallet/store";

export async function api<T>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? "Request failed.");
  return j;
}

/** Connected + signed in, or opens the wallet dialog / asks for the signature. Returns false when the user must act first. */
export async function ensureSession(w: WalletState): Promise<boolean> {
  if (!w.address) {
    openWalletDialog();
    return false;
  }
  if (w.session !== w.address) await signIn();
  return true;
}

export async function sendPrepared(b64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return signAndSendTransaction(bytes);
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("That file could not be read."));
    r.readAsDataURL(file);
  });
}

export const errorText = (e: unknown) => walletErrorMessage(e);
