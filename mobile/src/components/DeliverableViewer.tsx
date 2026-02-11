import React, { useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import type { Deliverable, ReasoningStep, Recommendation } from "../types";

interface Props {
  deliverable: Deliverable;
  onVerify?: (accepted: boolean) => void;
  verifying?: boolean;
}

export function DeliverableViewer({ deliverable, onVerify, verifying }: Props) {
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const { content } = deliverable;

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Summary */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Summary</Text>
        <Text style={styles.summary}>{content.summary}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Confidence</Text>
          <View style={styles.confidenceBar}>
            <View
              style={[
                styles.confidenceFill,
                { width: `${content.confidence * 100}%` },
              ]}
            />
          </View>
          <Text style={styles.metaValue}>
            {(content.confidence * 100).toFixed(0)}%
          </Text>
        </View>
        <Text style={styles.tokens}>
          {deliverable.tokensUsed.toLocaleString()} tokens used
        </Text>
      </View>

      {/* Reasoning Chain */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Reasoning Chain</Text>
        {content.reasoning.map((step) => (
          <ReasoningStepCard
            key={step.step}
            step={step}
            expanded={expandedStep === step.step}
            onToggle={() =>
              setExpandedStep(
                expandedStep === step.step ? null : step.step
              )
            }
          />
        ))}
      </View>

      {/* Recommendations */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recommendations</Text>
        {content.recommendations.map((rec, i) => (
          <RecommendationCard key={i} recommendation={rec} />
        ))}
      </View>

      {/* Data Sources */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Data Sources</Text>
        {content.dataSourcesUsed.map((source, i) => (
          <Text key={i} style={styles.source}>
            {source}
          </Text>
        ))}
      </View>

      {/* Verify Actions */}
      {onVerify && (
        <View style={styles.verifyActions}>
          <TouchableOpacity
            style={[styles.verifyButton, styles.acceptButton]}
            onPress={() => onVerify(true)}
            disabled={verifying}
          >
            <Text style={styles.verifyButtonText}>
              {verifying ? "Processing..." : "Accept & Release Payment"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.verifyButton, styles.disputeButton]}
            onPress={() => onVerify(false)}
            disabled={verifying}
          >
            <Text style={styles.disputeButtonText}>Dispute</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

function ReasoningStepCard({
  step,
  expanded,
  onToggle,
}: {
  step: ReasoningStep;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.stepCard}
      onPress={onToggle}
      activeOpacity={0.7}
    >
      <View style={styles.stepHeader}>
        <View style={styles.stepNumber}>
          <Text style={styles.stepNumberText}>{step.step}</Text>
        </View>
        <Text style={styles.stepConclusion} numberOfLines={expanded ? undefined : 2}>
          {step.conclusion}
        </Text>
      </View>
      {expanded && (
        <View style={styles.stepExpanded}>
          <Text style={styles.stepLabel}>Thought</Text>
          <Text style={styles.stepContent}>{step.thought}</Text>
          <Text style={styles.stepLabel}>Evidence</Text>
          <Text style={styles.stepContent}>{step.evidence}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function RecommendationCard({
  recommendation,
}: {
  recommendation: Recommendation;
}) {
  const actionColors = { buy: "#14f195", sell: "#ff7675", hold: "#ffeaa7" };
  const color = actionColors[recommendation.action];

  return (
    <View style={styles.recCard}>
      <View style={styles.recHeader}>
        <Text style={styles.recTicker}>{recommendation.ticker}</Text>
        <View style={[styles.actionBadge, { backgroundColor: color + "22", borderColor: color }]}>
          <Text style={[styles.actionText, { color }]}>
            {recommendation.action.toUpperCase()}
          </Text>
        </View>
        <Text style={styles.recConfidence}>
          {(recommendation.confidenceScore * 100).toFixed(0)}%
        </Text>
      </View>
      <Text style={styles.recReasoning}>{recommendation.reasoning}</Text>
      <Text style={styles.recHorizon}>{recommendation.timeHorizon}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
  },
  summary: {
    color: "#ccc",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 12,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  metaLabel: {
    color: "#888",
    fontSize: 12,
  },
  metaValue: {
    color: "#14f195",
    fontSize: 14,
    fontWeight: "700",
  },
  confidenceBar: {
    flex: 1,
    height: 6,
    backgroundColor: "#2a2a3e",
    borderRadius: 3,
    overflow: "hidden",
  },
  confidenceFill: {
    height: "100%",
    backgroundColor: "#14f195",
    borderRadius: 3,
  },
  tokens: {
    color: "#666",
    fontSize: 12,
    marginTop: 4,
  },
  stepCard: {
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#2a2a3e",
  },
  stepHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#9945ff22",
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumberText: {
    color: "#9945ff",
    fontSize: 13,
    fontWeight: "700",
  },
  stepConclusion: {
    color: "#ddd",
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },
  stepExpanded: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#2a2a3e",
  },
  stepLabel: {
    color: "#9945ff",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 4,
    marginTop: 8,
  },
  stepContent: {
    color: "#aaa",
    fontSize: 13,
    lineHeight: 19,
  },
  recCard: {
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#2a2a3e",
  },
  recHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  recTicker: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "monospace",
  },
  actionBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  actionText: {
    fontSize: 11,
    fontWeight: "700",
  },
  recConfidence: {
    color: "#888",
    fontSize: 12,
    marginLeft: "auto",
  },
  recReasoning: {
    color: "#aaa",
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 4,
  },
  recHorizon: {
    color: "#666",
    fontSize: 11,
    fontStyle: "italic",
  },
  source: {
    color: "#888",
    fontSize: 13,
    paddingVertical: 2,
  },
  verifyActions: {
    gap: 10,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#2a2a3e",
    marginBottom: 40,
  },
  verifyButton: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  acceptButton: {
    backgroundColor: "#14f195",
  },
  disputeButton: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#ff7675",
  },
  verifyButtonText: {
    color: "#0a0a0a",
    fontSize: 16,
    fontWeight: "700",
  },
  disputeButtonText: {
    color: "#ff7675",
    fontSize: 16,
    fontWeight: "600",
  },
});
