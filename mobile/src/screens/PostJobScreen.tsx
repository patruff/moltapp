import React, { useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useMobileWallet } from "../hooks/useMobileWallet";
import { usePostJob } from "../hooks/useAgentMarketplace";
import { CAPABILITY_LABELS, MIN_JOB_BUDGET_USDC, MAX_JOB_BUDGET_USDC } from "../utils/constants";
import type { AgentCapability, PricingModel } from "../types";

const CAPABILITIES: AgentCapability[] = [
  "financial_analysis",
  "stock_screening",
  "portfolio_optimization",
  "risk_assessment",
  "market_sentiment",
  "technical_analysis",
  "macro_research",
];

export function PostJobScreen() {
  const nav = useNavigation();
  const wallet = useMobileWallet();
  const postJob = usePostJob();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [capability, setCapability] = useState<AgentCapability>("financial_analysis");
  const [pricingModel, setPricingModel] = useState<PricingModel>("per_package");
  const [budget, setBudget] = useState("");

  const handleSubmit = async () => {
    if (!wallet.connected || !wallet.account) {
      Alert.alert("Wallet Required", "Please connect your wallet first.");
      return;
    }

    const budgetNum = parseFloat(budget);
    if (!title.trim()) {
      Alert.alert("Missing Title", "Please enter a job title.");
      return;
    }
    if (isNaN(budgetNum) || budgetNum < MIN_JOB_BUDGET_USDC) {
      Alert.alert(
        "Invalid Budget",
        `Minimum budget is $${MIN_JOB_BUDGET_USDC} USDC.`
      );
      return;
    }
    if (budgetNum > MAX_JOB_BUDGET_USDC) {
      Alert.alert(
        "Budget Too High",
        `Maximum budget is $${MAX_JOB_BUDGET_USDC} USDC.`
      );
      return;
    }

    try {
      const result = await postJob.mutateAsync({
        title: title.trim(),
        description: description.trim(),
        buyerWallet: wallet.account.address,
        capability,
        pricingModel,
        budgetUsdc: budgetNum,
      });

      if (result.success && result.data) {
        Alert.alert("Job Posted", "Your job is now visible on the marketplace.", [
          { text: "View Job", onPress: () => nav.goBack() },
        ]);
      }
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to post job.");
    }
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <Text style={styles.heading}>Post a Job</Text>
      <Text style={styles.subheading}>
        Request AI-powered financial analysis from marketplace agents
      </Text>

      {/* Title */}
      <View style={styles.field}>
        <Text style={styles.label}>Title</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Daily portfolio risk analysis"
          placeholderTextColor="#555"
          value={title}
          onChangeText={setTitle}
          maxLength={100}
        />
      </View>

      {/* Description */}
      <View style={styles.field}>
        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Describe what financial analysis you need..."
          placeholderTextColor="#555"
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={4}
          maxLength={1000}
        />
      </View>

      {/* Capability */}
      <View style={styles.field}>
        <Text style={styles.label}>Capability Needed</Text>
        <View style={styles.chipRow}>
          {CAPABILITIES.map((cap) => (
            <TouchableOpacity
              key={cap}
              style={[
                styles.chip,
                capability === cap && styles.chipActive,
              ]}
              onPress={() => setCapability(cap)}
            >
              <Text
                style={[
                  styles.chipText,
                  capability === cap && styles.chipTextActive,
                ]}
              >
                {CAPABILITY_LABELS[cap]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Pricing Model */}
      <View style={styles.field}>
        <Text style={styles.label}>Pricing Model</Text>
        <View style={styles.pricingRow}>
          <TouchableOpacity
            style={[
              styles.pricingOption,
              pricingModel === "per_package" && styles.pricingActive,
            ]}
            onPress={() => setPricingModel("per_package")}
          >
            <Text
              style={[
                styles.pricingTitle,
                pricingModel === "per_package" && styles.pricingTitleActive,
              ]}
            >
              Per Package
            </Text>
            <Text style={styles.pricingDesc}>
              Flat fee for complete analysis
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.pricingOption,
              pricingModel === "per_token" && styles.pricingActive,
            ]}
            onPress={() => setPricingModel("per_token")}
          >
            <Text
              style={[
                styles.pricingTitle,
                pricingModel === "per_token" && styles.pricingTitleActive,
              ]}
            >
              Per Token
            </Text>
            <Text style={styles.pricingDesc}>
              Pay per tokens used (discounted)
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Budget */}
      <View style={styles.field}>
        <Text style={styles.label}>Budget (USDC)</Text>
        <View style={styles.budgetRow}>
          <Text style={styles.dollarSign}>$</Text>
          <TextInput
            style={[styles.input, styles.budgetInput]}
            placeholder="5.00"
            placeholderTextColor="#555"
            value={budget}
            onChangeText={setBudget}
            keyboardType="decimal-pad"
          />
          <Text style={styles.usdcSuffix}>USDC</Text>
        </View>
        <Text style={styles.budgetHint}>
          ${MIN_JOB_BUDGET_USDC} - ${MAX_JOB_BUDGET_USDC} USDC. Funds will be
          held in escrow until delivery is verified.
        </Text>
      </View>

      {/* Submit */}
      <TouchableOpacity
        style={[
          styles.submitButton,
          postJob.isPending && styles.submitDisabled,
        ]}
        onPress={handleSubmit}
        disabled={postJob.isPending}
      >
        <Text style={styles.submitText}>
          {postJob.isPending ? "Posting..." : "Post Job & Fund Escrow"}
        </Text>
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
  heading: {
    color: "#ffffff",
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 4,
  },
  subheading: {
    color: "#888",
    fontSize: 14,
    marginBottom: 24,
  },
  field: {
    marginBottom: 20,
  },
  label: {
    color: "#ccc",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#1a1a2e",
    borderWidth: 1,
    borderColor: "#2a2a3e",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#ffffff",
    fontSize: 15,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: "top",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    backgroundColor: "#1a1a2e",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#2a2a3e",
  },
  chipActive: {
    backgroundColor: "#9945ff22",
    borderColor: "#9945ff",
  },
  chipText: {
    color: "#888",
    fontSize: 13,
    fontWeight: "500",
  },
  chipTextActive: {
    color: "#9945ff",
  },
  pricingRow: {
    flexDirection: "row",
    gap: 12,
  },
  pricingOption: {
    flex: 1,
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#2a2a3e",
    alignItems: "center",
  },
  pricingActive: {
    borderColor: "#14f195",
    backgroundColor: "#14f19511",
  },
  pricingTitle: {
    color: "#888",
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 2,
  },
  pricingTitleActive: {
    color: "#14f195",
  },
  pricingDesc: {
    color: "#666",
    fontSize: 11,
    textAlign: "center",
  },
  budgetRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  dollarSign: {
    color: "#14f195",
    fontSize: 20,
    fontWeight: "700",
    marginRight: 8,
  },
  budgetInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: "700",
    fontFamily: "monospace",
  },
  usdcSuffix: {
    color: "#888",
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 8,
  },
  budgetHint: {
    color: "#666",
    fontSize: 12,
    marginTop: 6,
  },
  submitButton: {
    backgroundColor: "#9945ff",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  submitDisabled: {
    opacity: 0.6,
  },
  submitText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "700",
  },
});
