import React from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useMobileWallet } from "../hooks/useMobileWallet";
import {
  useJob,
  useAcceptJob,
  useVerifyDeliverable,
} from "../hooks/useAgentMarketplace";
import { DeliverableViewer } from "../components/DeliverableViewer";
import { CAPABILITY_LABELS } from "../utils/constants";
import type { RootStackParamList } from "../types";

type Route = RouteProp<RootStackParamList, "JobDetail">;

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

export function JobDetailScreen() {
  const route = useRoute<Route>();
  const { jobId } = route.params;
  const wallet = useMobileWallet();
  const { data: jobRes, isLoading } = useJob(jobId);
  const acceptJob = useAcceptJob();
  const verifyDeliverable = useVerifyDeliverable();

  const job = jobRes?.data;

  if (isLoading || !job) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#9945ff" />
      </View>
    );
  }

  const isBuyer = wallet.account?.address === job.buyerWallet;
  const statusColor = STATUS_COLORS[job.status] ?? "#888";

  const handleAccept = async () => {
    if (!wallet.connected) {
      Alert.alert("Wallet Required", "Connect your wallet to accept jobs.");
      return;
    }
    try {
      await acceptJob.mutateAsync({
        jobId: job.id,
        sellerAgentId: "self", // Would be the user's agent ID
      });
      Alert.alert("Accepted", "You've accepted this job. Start your analysis.");
    } catch (err: any) {
      Alert.alert("Error", err.message);
    }
  };

  const handleVerify = async (accepted: boolean) => {
    try {
      await verifyDeliverable.mutateAsync({
        jobId: job.id,
        accepted,
      });
      Alert.alert(
        accepted ? "Verified" : "Disputed",
        accepted
          ? "Payment released from escrow to seller."
          : "Dispute opened. Funds held in escrow pending review."
      );
    } catch (err: any) {
      Alert.alert("Error", err.message);
    }
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>{job.title}</Text>
        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor: statusColor + "22",
              borderColor: statusColor,
            },
          ]}
        >
          <Text style={[styles.statusText, { color: statusColor }]}>
            {job.status.replace("_", " ").toUpperCase()}
          </Text>
        </View>
      </View>

      <Text style={styles.description}>{job.description}</Text>

      {/* Details Grid */}
      <View style={styles.detailsGrid}>
        <DetailItem
          label="Capability"
          value={CAPABILITY_LABELS[job.capability] ?? job.capability}
        />
        <DetailItem
          label="Pricing"
          value={job.pricingModel === "per_package" ? "Per Package" : "Per Token"}
        />
        <DetailItem
          label="Budget"
          value={`$${job.budgetUsdc.toFixed(2)} USDC`}
          valueColor="#14f195"
        />
        <DetailItem
          label="Buyer"
          value={`${job.buyerWallet.slice(0, 6)}...${job.buyerWallet.slice(-4)}`}
          mono
        />
        {job.sellerAgentId && (
          <DetailItem label="Seller Agent" value={job.sellerAgentId} mono />
        )}
        {job.escrowAddress && (
          <DetailItem
            label="Escrow"
            value={`${job.escrowAddress.slice(0, 6)}...${job.escrowAddress.slice(-4)}`}
            mono
          />
        )}
      </View>

      {/* Timeline */}
      <View style={styles.timeline}>
        <TimelineItem label="Posted" date={job.createdAt} active />
        <TimelineItem
          label="Accepted"
          date={job.acceptedAt}
          active={!!job.acceptedAt}
        />
        <TimelineItem
          label="Delivered"
          date={job.deliverable?.submittedAt}
          active={!!job.deliverable}
        />
        <TimelineItem
          label="Completed"
          date={job.completedAt}
          active={!!job.completedAt}
        />
      </View>

      {/* Actions */}
      {job.status === "open" && !isBuyer && wallet.connected && (
        <TouchableOpacity
          style={styles.acceptButton}
          onPress={handleAccept}
          disabled={acceptJob.isPending}
        >
          <Text style={styles.acceptButtonText}>
            {acceptJob.isPending ? "Accepting..." : "Accept This Job"}
          </Text>
        </TouchableOpacity>
      )}

      {/* Deliverable */}
      {job.deliverable && (
        <View style={styles.deliverableSection}>
          <Text style={styles.sectionTitle}>Deliverable</Text>
          <DeliverableViewer
            deliverable={job.deliverable}
            onVerify={
              isBuyer && job.status === "delivered" ? handleVerify : undefined
            }
            verifying={verifyDeliverable.isPending}
          />
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function DetailItem({
  label,
  value,
  valueColor,
  mono,
}: {
  label: string;
  value: string;
  valueColor?: string;
  mono?: boolean;
}) {
  return (
    <View style={styles.detailItem}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text
        style={[
          styles.detailValue,
          valueColor ? { color: valueColor } : undefined,
          mono ? { fontFamily: "monospace" } : undefined,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function TimelineItem({
  label,
  date,
  active,
}: {
  label: string;
  date?: string;
  active: boolean;
}) {
  return (
    <View style={styles.timelineItem}>
      <View
        style={[styles.timelineDot, active && styles.timelineDotActive]}
      />
      <View style={styles.timelineContent}>
        <Text
          style={[
            styles.timelineLabel,
            active && styles.timelineLabelActive,
          ]}
        >
          {label}
        </Text>
        {date && (
          <Text style={styles.timelineDate}>
            {new Date(date).toLocaleString()}
          </Text>
        )}
      </View>
    </View>
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
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  title: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "800",
    flex: 1,
    marginRight: 12,
  },
  statusBadge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "700",
  },
  description: {
    color: "#aaa",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 20,
  },
  detailsGrid: {
    backgroundColor: "#1a1a2e",
    borderRadius: 16,
    padding: 16,
    gap: 12,
    marginBottom: 20,
  },
  detailItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  detailLabel: {
    color: "#888",
    fontSize: 13,
  },
  detailValue: {
    color: "#ddd",
    fontSize: 14,
    fontWeight: "600",
  },
  timeline: {
    marginBottom: 20,
  },
  timelineItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 12,
    gap: 12,
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#2a2a3e",
    marginTop: 2,
  },
  timelineDotActive: {
    backgroundColor: "#9945ff",
  },
  timelineContent: {
    flex: 1,
  },
  timelineLabel: {
    color: "#666",
    fontSize: 14,
    fontWeight: "600",
  },
  timelineLabelActive: {
    color: "#ddd",
  },
  timelineDate: {
    color: "#888",
    fontSize: 12,
    marginTop: 2,
  },
  acceptButton: {
    backgroundColor: "#14f195",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginBottom: 20,
  },
  acceptButtonText: {
    color: "#0a0a0a",
    fontSize: 17,
    fontWeight: "700",
  },
  deliverableSection: {
    marginBottom: 20,
  },
  sectionTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
  },
});
