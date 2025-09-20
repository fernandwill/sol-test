import { useCallback, useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { SystemProgram } from "@solana/web3.js";
import { getCounterPDA, getProgram } from "../anchor/setup";
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

export default function CounterState() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  const counterPDA = useMemo(() => getCounterPDA(), []);
  const counterAddress = useMemo(() => counterPDA.toBase58(), [counterPDA]);
  const program = useMemo(() => {
    if (!wallet) {
      return null;
    }
    return getProgram(connection, wallet);
  }, [connection, wallet]);

  const [counterData, setCounterData] = useState<CounterAccountData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [hasCorruptedCounter, setHasCorruptedCounter] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);

  const fetchCounter = useCallback(async () => {
    if (!program) {
      setErrorMessage(wallet ? "Program unavailable." : "Connect your wallet to load the counter.");
      setCounterData(null);
      return;
    }
    try {
      const account = await program.account.counter.fetchNullable(counterPDA);
      if (!account) {
        setCounterData(null);
        setErrorMessage("Counter account not found. Press Initialize Counter.");
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
        setErrorMessage(
          `Counter PDA ${counterAddress} exists but holds incompatible data from an older client. Close the PDA (e.g. via \`solana account close ${counterAddress}\`) or redeploy, then refresh and re-run initialize.`,
        );
        return;
      }
      setErrorMessage("Failed to fetch counter account.");
    }
  }, [program, wallet, counterAddress, counterPDA]);

  useEffect(() => {
    let subscriptionId: number | null = null;

    void fetchCounter();

    if (!program) {
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

  const initializeCounter = useCallback(async () => {
    if (!program || !wallet?.publicKey) {
      setErrorMessage("Connect your wallet before initializing.");
      return;
    }
    if (hasCorruptedCounter) {
      setErrorMessage(
        `PDA ${counterAddress} already exists with incompatible data. Close it first (\`solana account close ${counterAddress}\`) or redeploy the program before trying again.`,
      );
      return;
    }
    if (isInitializing) {
      return;
    }

    setIsInitializing(true);
    setTxSignature(null);

    try {
      setErrorMessage(null);
      const balance = await connection.getBalance(wallet.publicKey);
      if (balance < MIN_BALANCE_LAMPORTS) {
        setErrorMessage("Wallet needs devnet SOL. Fund via https://faucet.solana.com and retry.");
        return;
      }

      const signature = await program.methods
        .initialize()
        .accounts({
          user: wallet.publicKey,
          counter: counterPDA,
          systemProgram: SystemProgram.programId,
        } as never)
        .rpc();

      setTxSignature(signature);
      await fetchCounter();
    } catch (error: unknown) {
      console.error("Initialization failed:", error);
      if (isAccountDeserializeError(error)) {
        setHasCorruptedCounter(true);
        setErrorMessage(
          `Initialization failed because PDA ${counterAddress} already exists with stale data. Close it first (\`solana account close ${counterAddress}\`) or redeploy the program, then refresh and try again.`,
        );
      } else {
        const message = error instanceof Error ? error.message : String(error);
        setErrorMessage(`Initialization failed: ${message}`);
      }
    } finally {
      setIsInitializing(false);
    }
  }, [connection, counterAddress, counterPDA, fetchCounter, hasCorruptedCounter, isInitializing, program, wallet]);

  return (
    <div className="space-y-3">
      <p className="text-lg">
        Count: {counterData ? counterData.count.toString() : "--"}
      </p>
      {errorMessage && <p className="text-sm text-red-500 whitespace-pre-line">{errorMessage}</p>}
      <div className="space-x-2">
        <button
          type="button"
          onClick={initializeCounter}
          disabled={isInitializing || !wallet}
          className="rounded bg-indigo-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-60"
        >
          {!wallet ? "Connect Wallet" : isInitializing ? "Initializing..." : "Initialize Counter"}
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
    </div>
  );
}
