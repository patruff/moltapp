import React from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
} from "react-native";
import type { Agent } from "../types";
import { CAPABILITY_LABELS } from "../utils/constants";

interface Props {
  agent: Agent;
  onPress: () => void;
}

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "#d4a574",
  openai: "#74b9ff",
  xai: "#ff7675",
  google: "#55efc4",
};

export function AgentCard({ agent, onPress }: Props) {
  const providerColor = PROVIDER_COLORS[agent.provider] ?? "#888";

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.header}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{agent.name}</Text>
          <View style={[styles.providerBadge, { borderColor: providerColor }]}>
            <Text style={[styles.providerText, { color: providerColor }]}>
              {agent.model}
            </Text>
          </View>
        </View>
        <View style={styles.ratingRow}>
          <Text style={styles.rating}>
            {"*".repeat(Math.round(agent.rating))} {agent.rating.toFixed(1)}
          </Text>
          <Text style={styles.jobCount}>{agent.jobsCompleted} jobs</Text>
        </View>
      </View>

      <Text style={styles.description} numberOfLines={2}>
        {agent.description}
      </Text>

      <View style={styles.capabilities}>
        {agent.capabilities.slice(0, 3).map((cap) => (
          <View key={cap} style={styles.capBadge}>
            <Text style={styles.capText}>
              {CAPABILITY_LABELS[cap] ?? cap}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.pricing}>
        <Text style={styles.priceLabel}>
          {agent.pricing.model === "per_package" ? "Per Package" : "Per 1K Tokens"}
        </Text>
        <Text style={styles.priceAmount}>
          ${agent.pricing.amount.toFixed(2)} USDC
        </Text>
        {agent.pricing.discountPercent ? (
          <Text style={styles.discount}>
            {agent.pricing.discountPercent}% off
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#1a1a2e",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#2a2a3e",
  },
  header: {
    marginBottom: 8,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  name: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
  },
  providerBadge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  providerText: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "monospace",
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rating: {
    color: "#ffd700",
    fontSize: 13,
  },
  jobCount: {
    color: "#888",
    fontSize: 13,
  },
  description: {
    color: "#aaa",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  capabilities: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 12,
  },
  capBadge: {
    backgroundColor: "#2a2a3e",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  capText: {
    color: "#9945ff",
    fontSize: 11,
    fontWeight: "600",
  },
  pricing: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: "#2a2a3e",
    paddingTop: 10,
  },
  priceLabel: {
    color: "#888",
    fontSize: 12,
  },
  priceAmount: {
    color: "#14f195",
    fontSize: 16,
    fontWeight: "700",
  },
  discount: {
    color: "#ffd700",
    fontSize: 12,
    fontWeight: "600",
  },
});
