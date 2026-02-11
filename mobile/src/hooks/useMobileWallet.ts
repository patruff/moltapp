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
import {
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import { APP_IDENTITY, SOLANA_CLUSTER, USDC_MINT, USDC_DECIMALS } from "../utils/constants";
import type { WalletAccount, WalletState } from "../types";

const connection = new Connection(
  clusterApiUrl(SOLANA_CLUSTER),
  "confirmed"
);

/**
 * Mobile Wallet Adapter hook.
 *
 * Works with any MWA-compliant wallet installed on the device:
 * - Phantom
 * - Solflare
 * - Backpack
 * - Ultimate Wallet
 * - Any other MWA wallet
 *
 * The MWA protocol discovers whichever wallet(s) the user has installed
 * and lets them choose which to authorize with.
 */
export function useMobileWallet() {
  const [walletState, setWalletState] = useState<WalletState>({
    connected: false,
    account: null,
    balanceSol: 0,
    balanceUsdc: 0,
  });
  const [authorizing, setAuthorizing] = useState(false);

  /** Fetch USDC balance for an address */
  const fetchUsdcBalance = useCallback(async (pubkey: PublicKey): Promise<number> => {
    try {
      const ata = await getAssociatedTokenAddress(USDC_MINT, pubkey);
      const account = await getAccount(connection, ata);
      return Number(account.amount) / 10 ** USDC_DECIMALS;
    } catch {
      return 0;
    }
  }, []);

  const connect = useCallback(async () => {
    setAuthorizing(true);
    try {
      const result = await transact(async (wallet: Web3MobileWallet) => {
        // MWA will open the user's installed wallet app (Phantom, Solflare, etc.)
        const authResult = await wallet.authorize({
          cluster: SOLANA_CLUSTER,
          identity: APP_IDENTITY,
        });

        const pubkey = new PublicKey(authResult.accounts[0].address);
        const [solBalance, usdcBalance] = await Promise.all([
          connection.getBalance(pubkey),
          fetchUsdcBalance(pubkey),
        ]);

        return {
          address: authResult.accounts[0].address,
          publicKey: pubkey,
          label: authResult.accounts[0].label ?? authResult.wallet_uri_base,
          authToken: authResult.auth_token,
          balanceLamports: solBalance,
          usdcBalance,
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
        balanceUsdc: result.usdcBalance,
      });

      return account;
    } catch (error) {
      console.error("Wallet authorization failed:", error);
      throw error;
    } finally {
      setAuthorizing(false);
    }
  }, [fetchUsdcBalance]);

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
      const [solBalance, usdcBalance] = await Promise.all([
        connection.getBalance(walletState.account.publicKey),
        fetchUsdcBalance(walletState.account.publicKey),
      ]);
      setWalletState((prev) => ({
        ...prev,
        balanceSol: solBalance / 1e9,
        balanceUsdc: usdcBalance,
      }));
    } catch (error) {
      console.error("Failed to refresh balance:", error);
    }
  }, [walletState.account, fetchUsdcBalance]);

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
