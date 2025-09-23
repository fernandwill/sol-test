import { useCallback, useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { SystemProgram } from "@solana/web3.js";
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

export default function CounterState() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const walletAddress = wallet?.publicKey?.toBase58() ?? null;

  const counterPDA = useMemo(() => {
    if (!wallet?.publicKey) {
      return null;
    }
    return getCounterPDA(wallet.publicKey);
  }, [walletAddress, wallet?.publicKey]);

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

      const methods = program.methods as unknown as Record<string, (...args: never[]) => any>;
      const incrementMethod = methods.increment ?? methods.createCounter;
      if (!incrementMethod) {
        throw new Error("Counter program does not expose an increment/create method.");
      }

      const signature = await incrementMethod()
        .accounts({
          authority: wallet.publicKey,
          counter: counterPDA,
          systemProgram: SystemProgram.programId,
        } as never)
        .rpc();

      setHasCorruptedCounter(false);
      setTxSignature(signature);
      await fetchCounter();
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
  }, [connection, counterAddress, counterPDA, fetchCounter, hasCorruptedCounter, isProcessing, program, wallet]);

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
          {!wallet ? "Connect Wallet" : isProcessing ? "Processing..." : "Increment Counter"}
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
