import { useCallback, useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { SystemProgram } from "@solana/web3.js";
import { getCounterPDA, getProgram } from "../anchor/setup";
import type { CounterAccountData } from "../anchor/setup";

const MIN_BALANCE_LAMPORTS = 100_000; // 0.0001 SOL cushion

export default function CounterState() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  const counterPDA = useMemo(() => getCounterPDA(), []);
  const program = useMemo(() => {
    if (!wallet) {
      return null;
    }
    return getProgram(connection, wallet);
  }, [connection, wallet]);

  const [counterData, setCounterData] = useState<CounterAccountData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
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
        return;
      }
      setCounterData(account as CounterAccountData);
      setErrorMessage(null);
    } catch (error) {
      console.error("Failed to fetch counter:", error);
      setErrorMessage("Failed to fetch counter account.");
    }
  }, [program, wallet, counterPDA]);

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
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`Initialization failed: ${message}`);
    } finally {
      setIsInitializing(false);
    }
  }, [connection, counterPDA, fetchCounter, isInitializing, program, wallet]);

  return (
    <div className="space-y-3">
      <p className="text-lg">
        Count: {counterData ? counterData.count.toString() : "--"}
      </p>
      {errorMessage && <p className="text-sm text-red-500">{errorMessage}</p>}
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
