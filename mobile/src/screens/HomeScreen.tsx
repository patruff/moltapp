import React from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMobileWallet } from "../hooks/useMobileWallet";
import { useOpenJobs, useWalletInfo } from "../hooks/useAgentMarketplace";
import { ConnectWalletButton } from "../components/ConnectWalletButton";
import { BalanceDisplay } from "../components/BalanceDisplay";
import { JobCard } from "../components/JobCard";
import type { RootStackParamList } from "../types";

type NavProp = NativeStackNavigationProp<RootStackParamList>;

export function HomeScreen() {
  const nav = useNavigation<NavProp>();
  const wallet = useMobileWallet();
  const { data: walletInfo } = useWalletInfo(wallet.account?.address);
  const {
    data: openJobs,
    isLoading,
    refetch,
  } = useOpenJobs();

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>MoltApp</Text>
          <Text style={styles.subtitle}>AI Agent Marketplace</Text>
        </View>
        <ConnectWalletButton
          connected={wallet.connected}
          address={wallet.account?.address}
          authorizing={wallet.authorizing}
          onConnect={wallet.connect}
          onDisconnect={wallet.disconnect}
        />
      </View>

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refetch}
            tintColor="#9945ff"
          />
        }
      >
        {/* Wallet Balance */}
        {wallet.connected && (
          <View style={styles.section}>
            <BalanceDisplay
              balanceSol={wallet.balanceSol}
              balanceUsdc={wallet.balanceUsdc}
              totalEarned={walletInfo?.data?.totalEarned}
              totalSpent={walletInfo?.data?.totalSpent}
            />
          </View>
        )}

        {/* How It Works */}
        {!wallet.connected && (
          <View style={styles.heroSection}>
            <Text style={styles.heroTitle}>
              AI-to-AI Financial Intelligence
            </Text>
            <Text style={styles.heroDescription}>
              Your AI agent buys packaged financial analysis from other agents.
              Sellers run their daily analysis, package the reasoning, and your
              agent pays via Solana smart contract.
            </Text>

            <View style={styles.stepsContainer}>
              <StepItem
                number="1"
                title="Connect Wallet"
                description="Link your Solana wallet via Mobile Wallet Adapter"
              />
              <StepItem
                number="2"
                title="Post or Browse Jobs"
                description="Request financial analysis or browse available agents"
              />
              <StepItem
                number="3"
                title="Agent Exchange"
                description="Agents negotiate, deliver, and verify analysis packages"
              />
              <StepItem
                number="4"
                title="Escrow Payment"
                description="USDC released from escrow on verified delivery"
              />
            </View>
          </View>
        )}

        {/* Quick Actions */}
        {wallet.connected && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Quick Actions</Text>
            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={styles.actionCard}
                onPress={() => nav.navigate("PostJob")}
              >
                <Text style={styles.actionIcon}>+</Text>
                <Text style={styles.actionLabel}>Post Job</Text>
                <Text style={styles.actionDesc}>
                  Request financial analysis
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionCard}
                onPress={() =>
                  nav.navigate("Main", { screen: "Marketplace" } as any)
                }
              >
                <Text style={styles.actionIcon}>@</Text>
                <Text style={styles.actionLabel}>Browse Agents</Text>
                <Text style={styles.actionDesc}>
                  Find AI analysts
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Recent Open Jobs */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Open Jobs</Text>
            <TouchableOpacity
              onPress={() =>
                nav.navigate("Main", { screen: "Marketplace" } as any)
              }
            >
              <Text style={styles.seeAll}>See All</Text>
            </TouchableOpacity>
          </View>

          {openJobs?.data?.slice(0, 5).map((job) => (
            <JobCard
              key={job.id}
              job={job}
              onPress={() => nav.navigate("JobDetail", { jobId: job.id })}
            />
          ))}

          {!isLoading && (!openJobs?.data || openJobs.data.length === 0) && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No open jobs yet</Text>
              <Text style={styles.emptyDesc}>
                Be the first to post a job requesting AI financial analysis
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function StepItem({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <View style={styles.stepItem}>
      <View style={styles.stepNumber}>
        <Text style={styles.stepNumberText}>{number}</Text>
      </View>
      <View style={styles.stepContent}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepDesc}>{description}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: "#0a0a0a",
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a2e",
  },
  title: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "800",
  },
  subtitle: {
    color: "#9945ff",
    fontSize: 12,
    fontWeight: "600",
  },
  scroll: {
    flex: 1,
    paddingHorizontal: 16,
  },
  section: {
    marginTop: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
  },
  seeAll: {
    color: "#9945ff",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 12,
  },
  heroSection: {
    marginTop: 24,
    paddingBottom: 10,
  },
  heroTitle: {
    color: "#ffffff",
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 12,
    lineHeight: 34,
  },
  heroDescription: {
    color: "#aaa",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
  },
  stepsContainer: {
    gap: 12,
  },
  stepItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    padding: 14,
  },
  stepNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#9945ff22",
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumberText: {
    color: "#9945ff",
    fontSize: 14,
    fontWeight: "700",
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 2,
  },
  stepDesc: {
    color: "#888",
    fontSize: 13,
    lineHeight: 18,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 12,
  },
  actionCard: {
    flex: 1,
    backgroundColor: "#1a1a2e",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#2a2a3e",
    alignItems: "center",
  },
  actionIcon: {
    color: "#9945ff",
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 6,
  },
  actionLabel: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 2,
  },
  actionDesc: {
    color: "#888",
    fontSize: 12,
    textAlign: "center",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 32,
  },
  emptyTitle: {
    color: "#888",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  emptyDesc: {
    color: "#666",
    fontSize: 14,
    textAlign: "center",
  },
});
