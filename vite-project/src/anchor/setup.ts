import { Program, AnchorProvider, type Idl, type IdlAccounts } from "@coral-xyz/anchor";
import type { Wallet } from "@coral-xyz/anchor";
import type { Counter } from "../../counter.ts";
import counterIdl from "../../counter.json";
import { clusterApiUrl, Connection, PublicKey, Keypair } from "@solana/web3.js";
import { Buffer } from "buffer";

// Polyfill Buffer for browser builds (bn.js/@solana/web3.js expects it)
if (typeof globalThis.Buffer === "undefined") {
  (globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;
}

const programId = new PublicKey("FzLMd2FEkKFPnLUy7v23n2BUS8txtXzPs97dEC2CB7q7");
const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

// Ensure account metadata has size/type so Anchor's AccountClient works in the browser
function ensureAccountLayout(idl: Idl & Counter): Idl & Counter {
  const mutable = idl as Idl & Counter & {
    accounts?: Array<Record<string, any>>;
    types?: Array<Record<string, any>>;
  };
  const counterAccount = mutable.accounts?.find((account) => account.name === "counter");
  const counterType = mutable.types?.find((ty) => ty.name === "counter")?.type;
  if (counterAccount && !("size" in counterAccount)) {
    const structSize = counterType?.fields?.reduce((total: number, field: { type: any }) => {
      const fieldType = field.type;
      if (typeof fieldType === "string") {
        switch (fieldType) {
          case "u8":
            return total + 1;
          case "u16":
            return total + 2;
          case "u32":
            return total + 4;
          case "u64":
            return total + 8;
          case "u128":
            return total + 16;
          case "bool":
            return total + 1;
          default:
            console.warn(`Unhandled field type '${fieldType}' when computing account size.`);
            return total;
        }
      }
      console.warn("Unhandled complex field type when computing account size.", fieldType);
      return total;
    }, 0) ?? 0;
    counterAccount.size = 8 + structSize; // 8-byte discriminator + struct body
    if (!counterAccount.type && counterType) {
      counterAccount.type = counterType;
    }
  }
  return mutable;
}

const IDL = ensureAccountLayout(counterIdl as unknown as Idl & Counter);
const keypair = Keypair.generate();
const wallet: Wallet = {
  publicKey: keypair.publicKey,
  signTransaction: (transaction: any) => {
    transaction.partialSign(keypair);
    return transaction;
  },
  signAllTransactions: async (transactions: any[]) => {
    return transactions.map((tx) => {
      tx.partialSign(keypair);
      return tx;
    });
  },
  payer: keypair,
};

const provider = new AnchorProvider(connection, wallet, {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
});

export const program = new Program<Counter>(IDL, programId, provider);

const COUNTER_SEED = new TextEncoder().encode("counter");
export const [counterPDA] = PublicKey.findProgramAddressSync(
  [COUNTER_SEED],
  program.programId,
);

export type CounterData = IdlAccounts<Counter>["counter"];
