import React from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useAuth } from "../hooks/useAuth";
import { useMobileWallet } from "../hooks/useMobileWallet";

export function LoginScreen() {
  const auth = useAuth();
  const wallet = useMobileWallet();
  const [loading, setLoading] = React.useState<string | null>(null);

  const handleGoogle = async () => {
    setLoading("google");
    try {
      await auth.loginWithGoogle();
    } catch (e) {
      console.error("Google login failed:", e);
    } finally {
      setLoading(null);
    }
  };

  const handleGitHub = async () => {
    setLoading("github");
    try {
      await auth.loginWithGitHub();
    } catch (e) {
      console.error("GitHub login failed:", e);
    } finally {
      setLoading(null);
    }
  };

  const handlePhantom = async () => {
    setLoading("wallet");
    try {
      const account = await wallet.connect();
      if (account) {
        await auth.loginWithWallet(account.address);
      }
    } catch (e) {
      console.error("Wallet login failed:", e);
    } finally {
      setLoading(null);
    }
  };

  return (
    <View style={styles.container}>
      {/* Logo / Branding */}
      <View style={styles.hero}>
        <Text style={styles.logo}>MoltApp</Text>
        <Text style={styles.tagline}>
          AI Agent Marketplace on Solana
        </Text>
        <Text style={styles.description}>
          Create AI agents, run financial analysis, share insights, and trade
          intelligence — all powered by Solana.
        </Text>
      </View>

      {/* Auth Buttons */}
      <View style={styles.authSection}>
        <Text style={styles.authLabel}>Sign in to get started</Text>

        {/* Phantom / Solana Wallet */}
        <TouchableOpacity
          style={[styles.authButton, styles.phantomButton]}
          onPress={handlePhantom}
          disabled={!!loading}
        >
          {loading === "wallet" ? (
            <ActivityIndicator color="#ab9ff2" size="small" />
          ) : (
            <>
              <Text style={styles.phantomIcon}>P</Text>
              <Text style={styles.phantomText}>
                Connect with Phantom
              </Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.orText}>or use a social account</Text>

        {/* Google */}
        <TouchableOpacity
          style={[styles.authButton, styles.googleButton]}
          onPress={handleGoogle}
          disabled={!!loading}
        >
          {loading === "google" ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Text style={styles.socialIcon}>G</Text>
              <Text style={styles.socialText}>Continue with Google</Text>
            </>
          )}
        </TouchableOpacity>

        {/* GitHub */}
        <TouchableOpacity
          style={[styles.authButton, styles.githubButton]}
          onPress={handleGitHub}
          disabled={!!loading}
        >
          {loading === "github" ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Text style={styles.socialIcon}>GH</Text>
              <Text style={styles.socialText}>Continue with GitHub</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <Text style={styles.note}>
        Wallet connection uses Solana Mobile Wallet Adapter.{"\n"}
        Works with Phantom, Solflare, and other MWA wallets.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    paddingHorizontal: 24,
    justifyContent: "center",
  },
  hero: {
    alignItems: "center",
    marginBottom: 40,
  },
  logo: {
    color: "#ffffff",
    fontSize: 42,
    fontWeight: "900",
    marginBottom: 8,
  },
  tagline: {
    color: "#9945ff",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 16,
  },
  description: {
    color: "#888",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    maxWidth: 300,
  },
  authSection: {
    gap: 12,
  },
  authLabel: {
    color: "#ccc",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 4,
  },
  authButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 14,
    gap: 10,
  },
  phantomButton: {
    backgroundColor: "#ab9ff222",
    borderWidth: 2,
    borderColor: "#ab9ff2",
  },
  phantomIcon: {
    color: "#ab9ff2",
    fontSize: 20,
    fontWeight: "800",
  },
  phantomText: {
    color: "#ab9ff2",
    fontSize: 16,
    fontWeight: "700",
  },
  googleButton: {
    backgroundColor: "#4285f4",
  },
  githubButton: {
    backgroundColor: "#333",
  },
  socialIcon: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    width: 28,
    textAlign: "center",
  },
  socialText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  orText: {
    color: "#555",
    fontSize: 13,
    textAlign: "center",
    marginVertical: 4,
  },
  note: {
    color: "#444",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
    marginTop: 32,
  },
});
