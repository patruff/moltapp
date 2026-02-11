import { useCallback, useState } from "react";
import {
  transact,
  Web3MobileWallet,
} from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import {
  PublicKey,
  Transaction,
  Connection,
  clusterApiUrl,
} from "@solana/web3.js";
import { APP_IDENTITY, SOLANA_CLUSTER } from "../utils/constants";
import type { WalletAccount, WalletState } from "../types";

const connection = new Connection(
  clusterApiUrl(SOLANA_CLUSTER),
  "confirmed"
);

export function useMobileWallet() {
  const [walletState, setWalletState] = useState<WalletState>({
    connected: false,
    account: null,
    balanceSol: 0,
    balanceUsdc: 0,
  });
  const [authorizing, setAuthorizing] = useState(false);

  const connect = useCallback(async () => {
    setAuthorizing(true);
    try {
      const result = await transact(async (wallet: Web3MobileWallet) => {
        const authResult = await wallet.authorize({
          cluster: SOLANA_CLUSTER,
          identity: APP_IDENTITY,
        });

        const pubkey = new PublicKey(authResult.accounts[0].address);
        const balance = await connection.getBalance(pubkey);

        return {
          address: authResult.accounts[0].address,
          publicKey: pubkey,
          label: authResult.accounts[0].label,
          authToken: authResult.auth_token,
          balanceLamports: balance,
        };
      });

      const account: WalletAccount = {
        address: result.address,
        publicKey: result.publicKey,
        label: result.label,
      };

      setWalletState({
        connected: true,
        account,
        balanceSol: result.balanceLamports / 1e9,
        balanceUsdc: 0, // Fetched separately via token account
      });

      return account;
    } catch (error) {
      console.error("Wallet authorization failed:", error);
      throw error;
    } finally {
      setAuthorizing(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setWalletState({
      connected: false,
      account: null,
      balanceSol: 0,
      balanceUsdc: 0,
    });
  }, []);

  const signAndSendTransaction = useCallback(
    async (transaction: Transaction): Promise<string> => {
      if (!walletState.account) {
        throw new Error("Wallet not connected");
      }

      const signature = await transact(
        async (wallet: Web3MobileWallet) => {
          // Re-authorize with the wallet
          await wallet.authorize({
            cluster: SOLANA_CLUSTER,
            identity: APP_IDENTITY,
          });

          // Get latest blockhash
          const { blockhash, lastValidBlockHeight } =
            await connection.getLatestBlockhash();
          transaction.recentBlockhash = blockhash;
          transaction.lastValidBlockHeight = lastValidBlockHeight;
          transaction.feePayer = walletState.account!.publicKey;

          // Sign and send
          const signatures = await wallet.signAndSendTransactions({
            transactions: [transaction],
          });

          return signatures[0];
        }
      );

      // Confirm the transaction
      const latestBlockhash = await connection.getLatestBlockhash();
      await connection.confirmTransaction({
        signature: signature as unknown as string,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      });

      return signature as unknown as string;
    },
    [walletState.account]
  );

  const signTransaction = useCallback(
    async (transaction: Transaction): Promise<Transaction> => {
      if (!walletState.account) {
        throw new Error("Wallet not connected");
      }

      const signedTx = await transact(
        async (wallet: Web3MobileWallet) => {
          await wallet.authorize({
            cluster: SOLANA_CLUSTER,
            identity: APP_IDENTITY,
          });

          const { blockhash, lastValidBlockHeight } =
            await connection.getLatestBlockhash();
          transaction.recentBlockhash = blockhash;
          transaction.lastValidBlockHeight = lastValidBlockHeight;
          transaction.feePayer = walletState.account!.publicKey;

          const signed = await wallet.signTransactions({
            transactions: [transaction],
          });

          return signed[0];
        }
      );

      return signedTx;
    },
    [walletState.account]
  );

  const refreshBalance = useCallback(async () => {
    if (!walletState.account) return;

    try {
      const balance = await connection.getBalance(
        walletState.account.publicKey
      );
      setWalletState((prev) => ({
        ...prev,
        balanceSol: balance / 1e9,
      }));
    } catch (error) {
      console.error("Failed to refresh balance:", error);
    }
  }, [walletState.account]);

  return {
    ...walletState,
    authorizing,
    connect,
    disconnect,
    signAndSendTransaction,
    signTransaction,
    refreshBalance,
    connection,
  };
}
