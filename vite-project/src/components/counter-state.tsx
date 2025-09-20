import { useEffect, useState } from "react";
import { Buffer } from "buffer";
import { useConnection } from "@solana/wallet-adapter-react";
import { program, counterPDA } from "../anchor/setup";
import type { CounterData } from "../anchor/setup";

const ACCOUNT_NAME = "Counter" as const;

export default function CounterState() {
  const { connection } = useConnection();
  const [counterData, setCounterData] = useState<CounterData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const decodeAndSet = (accountData: Buffer) => {
      try {
        const decoded = program.coder.accounts.decode<CounterData>(
          ACCOUNT_NAME,
          accountData,
        );
        if (isMounted) {
          setCounterData(decoded);
          setErrorMessage(null);
        }
      } catch (decodeError) {
        console.error("Error decoding account data:", decodeError);
        if (isMounted) {
          setErrorMessage("Unable to decode counter account data.");
        }
      }
    };

    const fetchCounterData = async () => {
      try {
        const accountInfo = await connection.getAccountInfo(counterPDA);
        if (!accountInfo) {
          if (isMounted) {
            setCounterData(null);
            setErrorMessage("Counter account not found. Run the initialize instruction.");
          }
          return;
        }
        decodeAndSet(Buffer.from(accountInfo.data));
      } catch (fetchError) {
        console.error("Error fetching counter data:", fetchError);
        if (isMounted) {
          setErrorMessage("Failed to fetch counter account.");
        }
      }
    };

    fetchCounterData();

    const subscriptionId = connection.onAccountChange(counterPDA, (accountInfo) => {
      decodeAndSet(Buffer.from(accountInfo.data));
    });

    return () => {
      isMounted = false;
      connection.removeAccountChangeListener(subscriptionId).catch((unsubscribeError) => {
        console.error("Failed to remove account change listener:", unsubscribeError);
      });
    };
  }, [connection]);

  if (errorMessage) {
    return <p className="text-lg text-red-500">{errorMessage}</p>;
  }

  return (
    <p className="text-lg">
      Count: {counterData ? counterData.count.toString() : "--"}
    </p>
  );
}
