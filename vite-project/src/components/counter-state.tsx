import { Buffer } from "buffer";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { PROGRAM_ID, getCounterPDA, getProgram } from "../anchor/setup";
import type { CounterAccountData } from "../anchor/setup";

const MIN_BALANCE_LAMPORTS = 100_000; // 0.0001 SOL cushion

function isAccountDeserializeError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  if (typeof error === "object" && error !== null) {
    const maybeNumber = (error as { code?: number }).code;
    const maybeCode = (error as { errorCode?: { code?: string } }).errorCode?.code;
    if (maybeNumber === 3003 || maybeCode === "AccountDidNotDeserialize") {
      return true;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("AccountDidNotDeserialize") || message.includes("Failed to deserialize the account");
}

function toCamelCase(name: string): string {
  if (!name) {
    return name;
  }
  const lower = name[0].toLowerCase() + name.slice(1);
  return lower.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

type IdlInstructionAccount = { name: string };
type IdlInstruction = {
  name: string;
  accounts?: IdlInstructionAccount[];
};

type CounterParticipant = {
  address: string;
  count: string;
};

function readUint64LE(buffer: Uint8Array, offset: number): bigint {
  if (buffer.length < offset + 8) {
    throw new Error("Insufficient bytes to read u64 value.");
  }
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    const byte = buffer[offset + index];
    value |= BigInt(byte) << BigInt(index * 8);
  }
  return value;
}

export default function CounterState() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const walletAddress = wallet?.publicKey?.toBase58() ?? null;

  const counterPDA = useMemo(() => {
    if (!walletAddress) {
      return null;
    }
    return getCounterPDA(new PublicKey(walletAddress));
  }, [walletAddress]);

  const counterAddress = counterPDA?.toBase58() ?? null;

  const program = useMemo(() => {
    if (!wallet) {
      return null;
    }
    return getProgram(connection, wallet);
  }, [connection, wallet]);

  const [counterData, setCounterData] = useState<CounterAccountData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasCorruptedCounter, setHasCorruptedCounter] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [interactingWallets, setInteractingWallets] = useState<CounterParticipant[]>([]);
  const [isLoadingParticipants, setIsLoadingParticipants] = useState(false);
  const [participantsError, setParticipantsError] = useState<string | null>(null);

  const fetchInteractingWallets = useCallback(async () => {
    setIsLoadingParticipants(true);
    setParticipantsError(null);
    try {
      const programAccounts = await connection.getProgramAccounts(PROGRAM_ID, {
        dataSlice: { offset: 0, length: 48 },
        filters: [{ dataSize: 48 }],
        commitment: "confirmed",
      });

      const participants = programAccounts
        .map(({ account }) => {
          const data = Buffer.from(account.data);
          if (data.length < 48) {
            return null;
          }

          try {
            const authorityBytes = data.slice(8, 40);
            const address = new PublicKey(authorityBytes).toBase58();
            const count = readUint64LE(data, 40).toString();
            return { address, count };
          } catch (decodeError) {
            console.warn("Failed to decode counter account participant:", decodeError);
            return null;
          }
        })
        .filter((participant): participant is CounterParticipant => Boolean(participant));

      const uniqueParticipants: CounterParticipant[] = [];
      const seenAddresses = new Set<string>();
      for (const participant of participants) {
        if (seenAddresses.has(participant.address)) {
          continue;
        }
        seenAddresses.add(participant.address);
        uniqueParticipants.push(participant);
      }
      setInteractingWallets(uniqueParticipants);
    } catch (fetchError) {
      console.error("Failed to load interacting wallets:", fetchError);
      setParticipantsError("Failed to load wallets that interacted with the contract.");
      setInteractingWallets([]);
    } finally {
      setIsLoadingParticipants(false);
    }
  }, [connection]);

  const { createInstruction, updateInstruction } = useMemo(() => {
    if (!program) {
      return { createInstruction: null as IdlInstruction | null, updateInstruction: null as IdlInstruction | null };
    }
    const instructions = (program.idl.instructions ?? []) as IdlInstruction[];
    const hasSystemProgram = (inst: IdlInstruction) =>
      inst.accounts?.some((account) => account.name === "systemProgram" || account.name === "system_program") ?? false;

    const initCandidate = instructions.find((inst) => hasSystemProgram(inst)) ?? null;
    const updateCandidate = instructions.find((inst) => inst !== initCandidate) ?? null;
    return { createInstruction: initCandidate, updateInstruction: updateCandidate };
  }, [program]);

  const fetchCounter = useCallback(async () => {
    if (!program) {
      setErrorMessage(wallet ? "Program unavailable." : "Connect your wallet to load the counter.");
      setCounterData(null);
      return;
    }
    if (!counterPDA) {
      setCounterData(null);
      setHasCorruptedCounter(false);
      setErrorMessage(wallet ? "Unable to derive counter PDA." : "Connect your wallet to derive the counter PDA.");
      return;
    }
    try {
      const account = await program.account.counter.fetchNullable(counterPDA);
      if (!account) {
        setCounterData(null);
        setErrorMessage("Counter account not found yet. Press Increment Counter to create it.");
        setHasCorruptedCounter(false);
        return;
      }
      setCounterData(account as CounterAccountData);
      setErrorMessage(null);
      setHasCorruptedCounter(false);
    } catch (error) {
      console.error("Failed to fetch counter:", error);
      if (isAccountDeserializeError(error)) {
        setCounterData(null);
        setHasCorruptedCounter(true);
        const addressLabel = counterAddress ?? "(unknown)";
        setErrorMessage(
          `Counter account ${addressLabel} exists but holds incompatible data. Close the account (e.g. via \`solana account close ${addressLabel}\`) or redeploy, then refresh and try again.`,
        );
        return;
      }
      setErrorMessage("Failed to fetch counter account.");
    }
  }, [program, wallet, counterAddress, counterPDA]);

  useEffect(() => {
    setCounterData(null);
    setErrorMessage(null);
    setHasCorruptedCounter(false);
    setTxSignature(null);
  }, [walletAddress]);

  useEffect(() => {
    let subscriptionId: number | null = null;

    void fetchCounter();

    if (!program || !counterPDA) {
      return () => {};
    }

    subscriptionId = connection.onAccountChange(counterPDA, () => {
      void fetchCounter();
    });

    return () => {
      if (subscriptionId !== null) {
        connection.removeAccountChangeListener(subscriptionId).catch((unsubscribeError) => {
          console.error("Failed to remove account change listener:", unsubscribeError);
        });
      }
    };
  }, [connection, counterPDA, fetchCounter, program]);

  useEffect(() => {
    void fetchInteractingWallets();
  }, [fetchInteractingWallets, walletAddress]);

  const buildAccounts = useCallback(
    (instruction: IdlInstruction | null) => {
      if (!instruction) {
        return null;
      }
      const accounts: Record<string, PublicKey> = {};
      for (const meta of instruction.accounts ?? []) {
        const name = toCamelCase(meta.name);
        if (name === "authority") {
          if (!wallet?.publicKey) {
            return null;
          }
          accounts[name] = wallet.publicKey as PublicKey;
        } else if (name === "counter") {
          if (!counterPDA) {
            return null;
          }
          accounts[name] = counterPDA;
        } else if (name === "systemProgram") {
          accounts[name] = SystemProgram.programId;
        } else {
          console.warn(`Unhandled account '${meta.name}' for instruction '${instruction.name}'.`);
        }
      }
      return accounts;
    },
    [counterPDA, wallet?.publicKey],
  );

  const incrementCounter = useCallback(async () => {
    if (!program || !wallet?.publicKey) {
      setErrorMessage("Connect your wallet before incrementing the counter.");
      return;
    }
    if (!counterPDA) {
      setErrorMessage("Unable to derive counter PDA.");
      return;
    }
    if (hasCorruptedCounter) {
      const addressLabel = counterAddress ?? "(unknown)";
      setErrorMessage(
        `Counter account ${addressLabel} already exists with incompatible data. Close it first (\`solana account close ${addressLabel}\`) or redeploy the program before trying again.`,
      );
      return;
    }
    if (isProcessing) {
      return;
    }

    setIsProcessing(true);
    setTxSignature(null);

    try {
      setErrorMessage(null);
      const balance = await connection.getBalance(wallet.publicKey);
      if (balance < MIN_BALANCE_LAMPORTS) {
        setErrorMessage("Wallet needs devnet SOL. Fund via https://faucet.solana.com and retry.");
        return;
      }

      const methods = program.methods as unknown as Record<string, () => { accounts(accounts: Record<string, PublicKey>): { rpc(): Promise<string> } }>;
      const shouldInitialize = counterData === null;
      const preferredInstruction = shouldInitialize ? createInstruction ?? updateInstruction : updateInstruction ?? createInstruction;
      if (!preferredInstruction) {
        throw new Error("Counter program IDL is missing usable instructions.");
      }
      const methodName = toCamelCase(preferredInstruction.name);
      const methodFactory = methods[methodName];
      if (!methodFactory) {
        throw new Error(`Counter program does not expose a '${methodName}' method.`);
      }
      const accounts = buildAccounts(preferredInstruction);
      if (!accounts) {
        throw new Error(`Unable to derive accounts for instruction '${preferredInstruction.name}'.`);
      }

      let signature: string;
      try {
        signature = await methodFactory().accounts(accounts as never).rpc();
      } catch (callError) {
        if (!shouldInitialize && createInstruction && preferredInstruction !== createInstruction) {
          const createMethodName = toCamelCase(createInstruction.name);
          const createAccounts = buildAccounts(createInstruction);
          const createFactory = methods[createMethodName];
          if (createFactory && createAccounts) {
            signature = await createFactory().accounts(createAccounts as never).rpc();
          } else {
            throw callError;
          }
        } else {
          throw callError;
        }
      }

      setHasCorruptedCounter(false);
      setTxSignature(signature);
      await fetchCounter();
      await fetchInteractingWallets();
    } catch (error: unknown) {
      console.error("Increment failed:", error);
      if (isAccountDeserializeError(error)) {
        setHasCorruptedCounter(true);
        const addressLabel = counterAddress ?? "(unknown)";
        setErrorMessage(
          `Increment failed because account ${addressLabel} already exists with stale data. Close it first (\`solana account close ${addressLabel}\`) or redeploy the program, then refresh and try again.`,
        );
      } else if (error instanceof Error && error.message.includes("DeclaredProgramIdMismatch")) {
        setErrorMessage(
          `Program ID mismatch. The frontend expects ${PROGRAM_ID.toBase58()}. Confirm the deployed program declares this id, or update counter.json to match the on-chain program.`,
        );
      } else {
        const message = error instanceof Error ? error.message : String(error);
        setErrorMessage(`Increment failed: ${message}`);
      }
    } finally {
      setIsProcessing(false);
    }
  }, [
    buildAccounts,
    connection,
    counterAddress,
    counterData,
    counterPDA,
    createInstruction,
    fetchCounter,
    fetchInteractingWallets,
    hasCorruptedCounter,
    isProcessing,
    program,
    updateInstruction,
    wallet,
  ]);

  return (
    <div className="space-y-3">
      <p className="text-lg">
        Count: {counterData ? counterData.count.toString() : "--"}
      </p>
      {counterData?.authority && (
        <p className="text-xs text-slate-500">Authority: {counterData.authority.toBase58()}</p>
      )}
      {counterAddress && <p className="text-xs text-slate-500">Counter PDA: {counterAddress}</p>}
      {errorMessage && <p className="text-sm text-red-500 whitespace-pre-line">{errorMessage}</p>}
      <div className="space-x-2">
        <button
          type="button"
          onClick={incrementCounter}
          disabled={isProcessing || !wallet}
          className="rounded bg-indigo-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-60"
        >
          {!wallet ? "Connect Wallet" : isProcessing ? "Processing..." : counterData ? "Update Counter" : "Create Counter"}
        </button>
        {txSignature && (
          <a
            href={`https://solscan.io/tx/${txSignature}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-indigo-600 hover:underline"
          >
            View transaction
          </a>
        )}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold">Wallets that interacted with this contract</p>
        {participantsError ? (
          <p className="text-sm text-red-500">{participantsError}</p>
        ) : isLoadingParticipants ? (
          <p className="text-sm text-slate-500">Loading wallets…</p>
        ) : interactingWallets.length === 0 ? (
          <p className="text-sm text-slate-500">No wallets have interacted yet.</p>
        ) : (
          <ul className="space-y-1 text-xs text-slate-500">
            {interactingWallets.map(({ address, count }) => (
              <li key={address} className="break-all">
                {address}
                <span className="ml-2 text-slate-400">(Count: {count})</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
