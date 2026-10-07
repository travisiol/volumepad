/**
 * pump.fun instructions the operator sends. Ported from donchain.snipe
 * `src/solana/pump/instructions.js` (collectCreatorFeeInstruction) and `pdas.js` (seeds, discriminator).
 */
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { PUMP_PROGRAM, SEEDS, SYSTEM_PROGRAM } from "../../config/solana.ts";

const PUMP = new PublicKey(PUMP_PROGRAM);
/** pdas.js DISCRIMINATORS.collectCreatorFee */
const COLLECT_CREATOR_FEE = Uint8Array.from([20, 22, 86, 123, 198, 28, 219, 132]);

const pda = (seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, PUMP)[0];
export const eventAuthorityPda = () => pda([Buffer.from("__event_authority")]);
export const creatorVaultPda = (creator: PublicKey) => pda([Buffer.from(SEEDS.creatorVault), creator.toBuffer()]);
export const bondingCurvePda = (mint: PublicKey) => pda([Buffer.from(SEEDS.bondingCurve), mint.toBuffer()]);

/** Moves the creator vault's lamports (minus rent) to the creator. The creator signs the transaction as fee payer. */
export function collectCreatorFeeInstruction(creator: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: PUMP,
    keys: [
      { pubkey: creator, isSigner: false, isWritable: true },
      { pubkey: creatorVaultPda(creator), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(SYSTEM_PROGRAM), isSigner: false, isWritable: false },
      { pubkey: eventAuthorityPda(), isSigner: false, isWritable: false },
      { pubkey: PUMP, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(COLLECT_CREATOR_FEE),
  });
}
