import React from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useMobileWallet } from "../hooks/useMobileWallet";
import { useWalletInfo, useMyJobs } from "../hooks/useAgentMarketplace";
import { BalanceDisplay } from "../components/BalanceDisplay";
import { JobCard } from "../components/JobCard";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../types";

type NavProp = NativeStackNavigationProp<RootStackParamList>;

export function WalletScreen() {
  const nav = useNavigation<NavProp>();
  const wallet = useMobileWallet();
  const { data: walletInfo } = useWalletInfo(wallet.account?.address);
  const { data: myJobs } = useMyJobs(wallet.account?.address);

  const copyAddress = async () => {
    if (wallet.account?.address) {
      await Clipboard.setStringAsync(wallet.account.address);
      Alert.alert("Copied", "Wallet address copied to clipboard.");
    }
  };

  if (!wallet.connected) {
    return (
      <View style={styles.disconnectedContainer}>
        <Text style={styles.disconnectedTitle}>Wallet Not Connected</Text>
        <Text style={styles.disconnectedDesc}>
          Connect your Solana wallet to view balances, manage jobs, and make
          payments.
        </Text>
        <TouchableOpacity
          style={styles.connectButton}
          onPress={wallet.connect}
          disabled={wallet.authorizing}
        >
          <Text style={styles.connectButtonText}>
            {wallet.authorizing ? "Connecting..." : "Connect Wallet"}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Balance */}
      <View style={styles.section}>
        <BalanceDisplay
          balanceSol={wallet.balanceSol}
          balanceUsdc={wallet.balanceUsdc}
          totalEarned={walletInfo?.data?.totalEarned}
          totalSpent={walletInfo?.data?.totalSpent}
        />
      </View>

      {/* Address */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Wallet Address</Text>
        <TouchableOpacity style={styles.addressCard} onPress={copyAddress}>
          <Text style={styles.addressText}>
            {wallet.account?.address}
          </Text>
          <Text style={styles.copyHint}>Tap to copy</Text>
        </TouchableOpacity>
      </View>

      {/* Actions */}
      <View style={styles.section}>
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={wallet.refreshBalance}
          >
            <Text style={styles.actionText}>Refresh Balance</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.disconnectButton]}
            onPress={wallet.disconnect}
          >
            <Text style={styles.disconnectText}>Disconnect</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Active Jobs */}
      {walletInfo?.data && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Active Jobs ({walletInfo.data.activeJobs})
          </Text>
        </View>
      )}

      {myJobs?.data?.map((job) => (
        <JobCard
          key={job.id}
          job={job}
          onPress={() => nav.navigate("JobDetail", { jobId: job.id })}
        />
      ))}

      {(!myJobs?.data || myJobs.data.length === 0) && (
        <View style={styles.emptyJobs}>
          <Text style={styles.emptyText}>No jobs yet</Text>
          <TouchableOpacity
            style={styles.postJobButton}
            onPress={() => nav.navigate("PostJob")}
          >
            <Text style={styles.postJobText}>Post Your First Job</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  disconnectedContainer: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  disconnectedTitle: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 12,
  },
  disconnectedDesc: {
    color: "#888",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  connectButton: {
    backgroundColor: "#9945ff",
    borderRadius: 14,
    paddingHorizontal: 32,
    paddingVertical: 14,
  },
  connectButtonText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "700",
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 10,
  },
  addressCard: {
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#2a2a3e",
  },
  addressText: {
    color: "#ccc",
    fontSize: 13,
    fontFamily: "monospace",
    marginBottom: 4,
  },
  copyHint: {
    color: "#9945ff",
    fontSize: 12,
    fontWeight: "500",
  },
  actionsRow: {
    flexDirection: "row",
    gap: 12,
  },
  actionButton: {
    flex: 1,
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2a2a3e",
  },
  actionText: {
    color: "#ccc",
    fontSize: 14,
    fontWeight: "600",
  },
  disconnectButton: {
    borderColor: "#ff767544",
  },
  disconnectText: {
    color: "#ff7675",
    fontSize: 14,
    fontWeight: "600",
  },
  emptyJobs: {
    alignItems: "center",
    paddingVertical: 24,
  },
  emptyText: {
    color: "#888",
    fontSize: 16,
    marginBottom: 12,
  },
  postJobButton: {
    backgroundColor: "#9945ff22",
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#9945ff",
  },
  postJobText: {
    color: "#9945ff",
    fontSize: 14,
    fontWeight: "600",
  },
});
