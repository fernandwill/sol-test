import { Buffer } from "buffer";
import {
  AnchorProvider,
  Program,
  type Idl,
  type IdlAccounts,
  type Wallet,
} from "@coral-xyz/anchor";
import type { IdlAccount, IdlType, IdlTypeDef } from "@coral-xyz/anchor/dist/browser/src/idl.js";
import type { Counter } from "../../counter.ts";
import counterIdl from "../../counter.json";
import { clusterApiUrl, Connection, Keypair, PublicKey } from "@solana/web3.js";

// Polyfill Buffer for browser builds (bn.js/@solana/web3.js expects it).
if (typeof globalThis.Buffer === "undefined") {
  (globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;
}

const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

type MutableIdlAccount = IdlAccount & { size?: number; type?: IdlTypeDef["type"] };
type MutableCounterIdl = Idl & Counter;

type StructField = IdlType | { type: IdlType };

function sizeForIdlType(idlType: IdlType): number {
  if (typeof idlType === "string") {
    switch (idlType) {
      case "bool":
      case "u8":
      case "i8":
        return 1;
      case "u16":
      case "i16":
        return 2;
      case "u32":
      case "i32":
      case "f32":
        return 4;
      case "u64":
      case "i64":
      case "f64":
        return 8;
      case "u128":
      case "i128":
        return 16;
      default:
        console.warn(`Unhandled primitive IDL type '${idlType}' when computing account size.`);
        return 0;
    }
  }
  if ("array" in idlType) {
    const [elementType, len] = idlType.array;
    const length = typeof len === "number" ? len : 0;
    return length * sizeForIdlType(elementType);
  }
  if ("option" in idlType || "coption" in idlType) {
    const inner = "option" in idlType ? idlType.option : idlType.coption;
    return 1 + sizeForIdlType(inner);
  }
  if ("vec" in idlType) {
    console.warn("Variable length vectors are unsupported when computing account size.");
    return 0;
  }
  if ("defined" in idlType) {
    console.warn("Custom defined types are unsupported when computing account size.");
    return 0;
  }
  if ("generic" in idlType) {
    console.warn("Generic IDL fields are unsupported when computing account size.");
    return 0;
  }
  console.warn("Unhandled IDL field type when computing account size.", idlType);
  return 0;
}

function computeStructSize(typeDef?: IdlTypeDef): number | null {
  if (!typeDef) {
    return null;
  }
  const { type } = typeDef;
  if (type.kind !== "struct" || !type.fields) {
    return null;
  }
  const fields = type.fields as StructField[];
  return fields.reduce<number>((total, field) => {
    if (typeof field === "object" && field !== null && "type" in field) {
      return total + sizeForIdlType(field.type);
    }
    return total + sizeForIdlType(field as IdlType);
  }, 0);
}

function ensureAccountLayout(idl: MutableCounterIdl): MutableCounterIdl {
  const accountMatches = (name: string) => name === "counter" || name === "Counter";
  const account = idl.accounts?.find((acc) => accountMatches(acc.name)) as MutableIdlAccount | undefined;
  const counterTypeDef = idl.types?.find((ty) => accountMatches(ty.name));

  if (!account) {
    return idl;
  }

  const structSize = computeStructSize(counterTypeDef);
  if (typeof account.size !== "number" && structSize !== null) {
    account.size = 8 + structSize; // 8-byte discriminator prefix
  }
  if (!account.type && counterTypeDef) {
    account.type = counterTypeDef.type;
  }

  return idl;
}

const IDL = ensureAccountLayout(counterIdl as MutableCounterIdl);
const programId = new PublicKey(IDL.address);

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

export const program = new Program<Counter>(IDL, provider);

const COUNTER_SEED = new TextEncoder().encode("counter");
export const [counterPDA] = PublicKey.findProgramAddressSync(
  [COUNTER_SEED],
  programId,
);

export type CounterData = IdlAccounts<Counter>["counter"];
