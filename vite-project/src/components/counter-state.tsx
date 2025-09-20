import { useCallback, useEffect, useState } from "react";
import { Buffer } from "buffer";
import { useConnection } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { program, counterPDA } from "../anchor/setup";
import type { CounterData } from "../anchor/setup";

const ACCOUNT_NAME = "Counter" as const;

export default function CounterState() {
  const { connection } = useConnection();
  const [counterData, setCounterData] = useState<CounterData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);

  const decodeAndSet = useCallback(
    (accountData: Buffer) => {
      try {
        const decoded = program.coder.accounts.decode<CounterData>(
          ACCOUNT_NAME,
          accountData,
        );
        setCounterData(decoded);
        setErrorMessage(null);
      } catch (decodeError) {
        console.error("Error decoding account data:", decodeError);
        setErrorMessage("Unable to decode counter account data.");
      }
    },
    [],
  );

  const fetchCounterData = useCallback(async () => {
    try {
      const accountInfo = await connection.getAccountInfo(counterPDA);
      if (!accountInfo) {
        setCounterData(null);
        setErrorMessage("Counter account not found. Run the initialize instruction.");
        return;
      }
      decodeAndSet(Buffer.from(accountInfo.data));
    } catch (fetchError) {
      console.error("Error fetching counter data:", fetchError);
      setErrorMessage("Failed to fetch counter account.");
    }
  }, [connection, decodeAndSet]);

  useEffect(() => {
    let subscriptionId: number | null = null;

    fetchCounterData();

    const subscribe = async () => {
      subscriptionId = connection.onAccountChange(counterPDA, (accountInfo) => {
        decodeAndSet(Buffer.from(accountInfo.data));
      });
    };

    subscribe().catch((error) => {
      console.error("Failed to subscribe to account changes:", error);
    });

    return () => {
      if (subscriptionId !== null) {
        connection.removeAccountChangeListener(subscriptionId).catch((unsubscribeError) => {
          console.error("Failed to remove account change listener:", unsubscribeError);
        });
      }
    };
  }, [connection, decodeAndSet, fetchCounterData]);

  const initializeCounter = useCallback(async () => {
    if (isInitializing) {
      return;
    }
    setIsInitializing(true);
    setTxSignature(null);
    try {
      setErrorMessage(null);
      const walletPublicKey = program.provider.wallet.publicKey;
      const balance = await connection.getBalance(walletPublicKey);
      if (balance < LAMPORTS_PER_SOL / 100) {
        const airdropSignature = await connection.requestAirdrop(walletPublicKey, LAMPORTS_PER_SOL);
        await connection.confirmTransaction(airdropSignature, "confirmed");
      }

      const signature = await program.methods
        .initialize()
        .accounts({
          user: walletPublicKey,
          counter: counterPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      setTxSignature(signature);
      await fetchCounterData();
    } catch (initialiseError) {
      console.error("Initialization failed:", initialiseError);
      const message = initialiseError instanceof Error ? initialiseError.message : String(initialiseError);
      setErrorMessage(`Initialization failed: ${message}`);
    } finally {
      setIsInitializing(false);
    }
  }, [connection, fetchCounterData, isInitializing]);

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
          disabled={isInitializing}
          className="rounded bg-indigo-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-60"
        >
          {isInitializing ? "Initializing..." : "Initialize Counter"}
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
