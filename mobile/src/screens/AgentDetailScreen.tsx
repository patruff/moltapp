import React from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAgent } from "../hooks/useAgentMarketplace";
import { CAPABILITY_LABELS } from "../utils/constants";
import type { RootStackParamList } from "../types";

type Route = RouteProp<RootStackParamList, "AgentDetail">;
type NavProp = NativeStackNavigationProp<RootStackParamList>;

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "#d4a574",
  openai: "#74b9ff",
  xai: "#ff7675",
  google: "#55efc4",
};

export function AgentDetailScreen() {
  const route = useRoute<Route>();
  const nav = useNavigation<NavProp>();
  const { agentId } = route.params;
  const { data: agentRes, isLoading } = useAgent(agentId);

  const agent = agentRes?.data;

  if (isLoading || !agent) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#9945ff" />
      </View>
    );
  }

  const providerColor = PROVIDER_COLORS[agent.provider] ?? "#888";

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Agent Header */}
      <View style={styles.header}>
        <View style={[styles.avatar, { borderColor: providerColor }]}>
          <Text style={[styles.avatarText, { color: providerColor }]}>
            {agent.name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.name}>{agent.name}</Text>
        <View style={[styles.providerBadge, { borderColor: providerColor }]}>
          <Text style={[styles.providerText, { color: providerColor }]}>
            {agent.model}
          </Text>
        </View>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{agent.rating.toFixed(1)}</Text>
          <Text style={styles.statLabel}>Rating</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={styles.statValue}>{agent.jobsCompleted}</Text>
          <Text style={styles.statLabel}>Jobs</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={[styles.statValue, styles.priceValue]}>
            ${agent.pricing.amount.toFixed(2)}
          </Text>
          <Text style={styles.statLabel}>
            {agent.pricing.model === "per_package" ? "Per Package" : "Per 1K Tokens"}
          </Text>
        </View>
      </View>

      {/* Description */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <Text style={styles.description}>{agent.description}</Text>
      </View>

      {/* Capabilities */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Capabilities</Text>
        <View style={styles.capGrid}>
          {agent.capabilities.map((cap) => (
            <View key={cap} style={styles.capBadge}>
              <Text style={styles.capText}>
                {CAPABILITY_LABELS[cap] ?? cap}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Pricing Details */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Pricing</Text>
        <View style={styles.pricingCard}>
          <View style={styles.pricingRow}>
            <Text style={styles.pricingLabel}>Model</Text>
            <Text style={styles.pricingValue}>
              {agent.pricing.model === "per_package"
                ? "Flat Rate Per Package"
                : "Pay Per Token (Discounted)"}
            </Text>
          </View>
          <View style={styles.pricingRow}>
            <Text style={styles.pricingLabel}>Price</Text>
            <Text style={styles.pricingAmount}>
              ${agent.pricing.amount.toFixed(2)} USDC
            </Text>
          </View>
          {agent.pricing.maxTokens && (
            <View style={styles.pricingRow}>
              <Text style={styles.pricingLabel}>Max Tokens</Text>
              <Text style={styles.pricingValue}>
                {agent.pricing.maxTokens.toLocaleString()}
              </Text>
            </View>
          )}
          {agent.pricing.discountPercent && (
            <View style={styles.pricingRow}>
              <Text style={styles.pricingLabel}>Discount</Text>
              <Text style={styles.discountValue}>
                {agent.pricing.discountPercent}% off standard API pricing
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Wallet */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Wallet</Text>
        <Text style={styles.walletAddress}>{agent.ownerWallet}</Text>
      </View>

      {/* CTA */}
      <TouchableOpacity
        style={styles.hireButton}
        onPress={() => nav.navigate("PostJob")}
      >
        <Text style={styles.hireButtonText}>Post a Job for This Agent</Text>
      </TouchableOpacity>

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
  loadingContainer: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    alignItems: "center",
    marginBottom: 20,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    backgroundColor: "#1a1a2e",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: "800",
  },
  name: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 8,
  },
  providerBadge: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  providerText: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "monospace",
  },
  statsRow: {
    flexDirection: "row",
    backgroundColor: "#1a1a2e",
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    alignItems: "center",
  },
  stat: {
    flex: 1,
    alignItems: "center",
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: "#2a2a3e",
  },
  statValue: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 2,
  },
  priceValue: {
    color: "#14f195",
  },
  statLabel: {
    color: "#888",
    fontSize: 12,
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
  description: {
    color: "#aaa",
    fontSize: 15,
    lineHeight: 22,
  },
  capGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  capBadge: {
    backgroundColor: "#9945ff22",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#9945ff44",
  },
  capText: {
    color: "#9945ff",
    fontSize: 13,
    fontWeight: "600",
  },
  pricingCard: {
    backgroundColor: "#1a1a2e",
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  pricingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  pricingLabel: {
    color: "#888",
    fontSize: 13,
  },
  pricingValue: {
    color: "#ddd",
    fontSize: 14,
    fontWeight: "600",
  },
  pricingAmount: {
    color: "#14f195",
    fontSize: 18,
    fontWeight: "700",
  },
  discountValue: {
    color: "#ffd700",
    fontSize: 14,
    fontWeight: "600",
  },
  walletAddress: {
    color: "#888",
    fontSize: 13,
    fontFamily: "monospace",
    backgroundColor: "#1a1a2e",
    borderRadius: 10,
    padding: 12,
    overflow: "hidden",
  },
  hireButton: {
    backgroundColor: "#9945ff",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 4,
  },
  hireButtonText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "700",
  },
});
