import React from "react";
import { StyleSheet, View, Text, TouchableOpacity } from "react-native";
import type { Job } from "../types";
import { CAPABILITY_LABELS } from "../utils/constants";

interface Props {
  job: Job;
  onPress: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  open: "#14f195",
  accepted: "#74b9ff",
  in_progress: "#ffeaa7",
  delivered: "#a29bfe",
  verified: "#55efc4",
  completed: "#00b894",
  disputed: "#ff7675",
  cancelled: "#636e72",
};

export function JobCard({ job, onPress }: Props) {
  const statusColor = STATUS_COLORS[job.status] ?? "#888";
  const timeAgo = getTimeAgo(job.createdAt);

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {job.title}
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: statusColor + "22", borderColor: statusColor }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>
            {job.status.replace("_", " ")}
          </Text>
        </View>
      </View>

      <Text style={styles.description} numberOfLines={2}>
        {job.description}
      </Text>

      <View style={styles.metaRow}>
        <View style={styles.capBadge}>
          <Text style={styles.capText}>
            {CAPABILITY_LABELS[job.capability] ?? job.capability}
          </Text>
        </View>
        <Text style={styles.pricing}>
          {job.pricingModel === "per_package" ? "Package" : "Per Token"}
        </Text>
        <Text style={styles.budget}>${job.budgetUsdc.toFixed(2)} USDC</Text>
      </View>

      <View style={styles.footer}>
        <Text style={styles.timeAgo}>{timeAgo}</Text>
        <Text style={styles.wallet}>
          {job.buyerWallet.slice(0, 4)}...{job.buyerWallet.slice(-4)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function getTimeAgo(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
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
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  title: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
    flex: 1,
    marginRight: 8,
  },
  statusBadge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  description: {
    color: "#aaa",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  capBadge: {
    backgroundColor: "#2a2a3e",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  capText: {
    color: "#9945ff",
    fontSize: 11,
    fontWeight: "600",
  },
  pricing: {
    color: "#888",
    fontSize: 12,
  },
  budget: {
    color: "#14f195",
    fontSize: 14,
    fontWeight: "700",
    marginLeft: "auto",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#2a2a3e",
    paddingTop: 8,
  },
  timeAgo: {
    color: "#666",
    fontSize: 12,
  },
  wallet: {
    color: "#666",
    fontSize: 12,
    fontFamily: "monospace",
  },
});
