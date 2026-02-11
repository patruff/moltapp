import React, { useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../hooks/useAuth";
import { useMobileWallet } from "../hooks/useMobileWallet";
import { CAPABILITY_LABELS, MODEL_OPTIONS } from "../utils/constants";
import type { AgentCapability, AgentModelProvider } from "../types";
import * as api from "../services/api";

const CAPABILITIES: AgentCapability[] = [
  "financial_analysis",
  "stock_screening",
  "portfolio_optimization",
  "risk_assessment",
  "market_sentiment",
  "technical_analysis",
  "macro_research",
];

const RISK_LEVELS = [
  { value: "conservative", label: "Conservative", color: "#55efc4" },
  { value: "moderate", label: "Moderate", color: "#ffeaa7" },
  { value: "aggressive", label: "Aggressive", color: "#ff7675" },
] as const;

export function CreateAgentScreen() {
  const nav = useNavigation();
  const auth = useAuth();
  const wallet = useMobileWallet();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedModel, setSelectedModel] = useState(MODEL_OPTIONS[0]);
  const [capabilities, setCapabilities] = useState<AgentCapability[]>([
    "financial_analysis",
  ]);
  const [systemPrompt, setSystemPrompt] = useState(
    "You are a financial analyst AI. Analyze market data, identify trends, and provide actionable recommendations with clear reasoning chains."
  );
  const [temperature, setTemperature] = useState("0.3");
  const [maxTokens, setMaxTokens] = useState("8000");
  const [focusTickers, setFocusTickers] = useState("");
  const [riskTolerance, setRiskTolerance] = useState<
    "conservative" | "moderate" | "aggressive"
  >("moderate");
  const [autoAccept, setAutoAccept] = useState(false);
  const [pricePerPackage, setPricePerPackage] = useState("2.00");
  const [submitting, setSubmitting] = useState(false);

  const toggleCapability = (cap: AgentCapability) => {
    setCapabilities((prev) =>
      prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]
    );
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      Alert.alert("Name Required", "Give your agent a name.");
      return;
    }
    if (capabilities.length === 0) {
      Alert.alert("Capabilities Required", "Select at least one capability.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.registerAgent({
        name: name.trim(),
        model: selectedModel.model,
        provider: selectedModel.provider,
        ownerWallet: wallet.account?.address ?? auth.user?.walletAddress ?? "",
        capabilities,
        pricing: {
          model: "per_package",
          amount: parseFloat(pricePerPackage) || 2.0,
        },
        description: description.trim(),
      });

      if (result.success) {
        Alert.alert("Agent Created", `${name} is now live on the marketplace.`, [
          { text: "OK", onPress: () => nav.goBack() },
        ]);
      }
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <Text style={styles.heading}>Create Your Agent</Text>
      <Text style={styles.subheading}>
        Configure an AI agent that can run analysis and earn USDC
      </Text>

      {/* Name */}
      <View style={styles.field}>
        <Text style={styles.label}>Agent Name</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Alpha Seeker"
          placeholderTextColor="#555"
          value={name}
          onChangeText={setName}
          maxLength={50}
        />
      </View>

      {/* Description */}
      <View style={styles.field}>
        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="What does your agent specialize in?"
          placeholderTextColor="#555"
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
          maxLength={500}
        />
      </View>

      {/* Model Selection */}
      <View style={styles.field}>
        <Text style={styles.label}>AI Model</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.modelRow}>
            {MODEL_OPTIONS.map((m) => (
              <TouchableOpacity
                key={m.model}
                style={[
                  styles.modelChip,
                  selectedModel.model === m.model && styles.modelChipActive,
                ]}
                onPress={() => setSelectedModel(m)}
              >
                <Text
                  style={[
                    styles.modelLabel,
                    selectedModel.model === m.model && styles.modelLabelActive,
                  ]}
                >
                  {m.label}
                </Text>
                <Text style={styles.modelProvider}>{m.provider}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* Capabilities */}
      <View style={styles.field}>
        <Text style={styles.label}>Capabilities</Text>
        <View style={styles.capGrid}>
          {CAPABILITIES.map((cap) => (
            <TouchableOpacity
              key={cap}
              style={[
                styles.capChip,
                capabilities.includes(cap) && styles.capChipActive,
              ]}
              onPress={() => toggleCapability(cap)}
            >
              <Text
                style={[
                  styles.capText,
                  capabilities.includes(cap) && styles.capTextActive,
                ]}
              >
                {CAPABILITY_LABELS[cap]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* System Prompt */}
      <View style={styles.field}>
        <Text style={styles.label}>System Prompt</Text>
        <TextInput
          style={[styles.input, styles.promptArea]}
          placeholder="Instructions for your agent..."
          placeholderTextColor="#555"
          value={systemPrompt}
          onChangeText={setSystemPrompt}
          multiline
          numberOfLines={5}
          maxLength={2000}
        />
        <Text style={styles.charCount}>
          {systemPrompt.length}/2000
        </Text>
      </View>

      {/* Parameters Row */}
      <View style={styles.paramRow}>
        <View style={styles.paramField}>
          <Text style={styles.label}>Temperature</Text>
          <TextInput
            style={styles.input}
            value={temperature}
            onChangeText={setTemperature}
            keyboardType="decimal-pad"
            placeholder="0.3"
            placeholderTextColor="#555"
          />
        </View>
        <View style={styles.paramField}>
          <Text style={styles.label}>Max Tokens</Text>
          <TextInput
            style={styles.input}
            value={maxTokens}
            onChangeText={setMaxTokens}
            keyboardType="number-pad"
            placeholder="8000"
            placeholderTextColor="#555"
          />
        </View>
      </View>

      {/* Focus Tickers */}
      <View style={styles.field}>
        <Text style={styles.label}>Focus Tickers (comma-separated, optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="AAPL, NVDA, TSLA"
          placeholderTextColor="#555"
          value={focusTickers}
          onChangeText={setFocusTickers}
        />
      </View>

      {/* Risk Tolerance */}
      <View style={styles.field}>
        <Text style={styles.label}>Risk Tolerance</Text>
        <View style={styles.riskRow}>
          {RISK_LEVELS.map((r) => (
            <TouchableOpacity
              key={r.value}
              style={[
                styles.riskChip,
                riskTolerance === r.value && {
                  borderColor: r.color,
                  backgroundColor: r.color + "15",
                },
              ]}
              onPress={() => setRiskTolerance(r.value)}
            >
              <Text
                style={[
                  styles.riskText,
                  riskTolerance === r.value && { color: r.color },
                ]}
              >
                {r.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Pricing */}
      <View style={styles.field}>
        <Text style={styles.label}>Price Per Analysis Package (USDC)</Text>
        <View style={styles.priceRow}>
          <Text style={styles.dollar}>$</Text>
          <TextInput
            style={[styles.input, styles.priceInput]}
            value={pricePerPackage}
            onChangeText={setPricePerPackage}
            keyboardType="decimal-pad"
            placeholder="2.00"
            placeholderTextColor="#555"
          />
          <Text style={styles.usdc}>USDC</Text>
        </View>
      </View>

      {/* Auto-Accept */}
      <View style={styles.switchRow}>
        <View style={styles.switchLabel}>
          <Text style={styles.label}>Auto-Accept Jobs</Text>
          <Text style={styles.switchDesc}>
            Automatically accept jobs matching your capabilities
          </Text>
        </View>
        <Switch
          value={autoAccept}
          onValueChange={setAutoAccept}
          trackColor={{ false: "#2a2a3e", true: "#9945ff44" }}
          thumbColor={autoAccept ? "#9945ff" : "#666"}
        />
      </View>

      {/* Submit */}
      <TouchableOpacity
        style={[styles.createButton, submitting && styles.createDisabled]}
        onPress={handleCreate}
        disabled={submitting}
      >
        <Text style={styles.createText}>
          {submitting ? "Creating..." : "Create Agent"}
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
    marginBottom: 18,
  },
  label: {
    color: "#ccc",
    fontSize: 13,
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
  textArea: { minHeight: 80, textAlignVertical: "top" },
  promptArea: { minHeight: 120, textAlignVertical: "top", fontFamily: "monospace", fontSize: 13 },
  charCount: { color: "#555", fontSize: 11, textAlign: "right", marginTop: 4 },
  modelRow: { flexDirection: "row", gap: 8, paddingBottom: 4 },
  modelChip: {
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#2a2a3e",
    alignItems: "center",
    minWidth: 120,
  },
  modelChipActive: {
    borderColor: "#9945ff",
    backgroundColor: "#9945ff15",
  },
  modelLabel: { color: "#888", fontSize: 13, fontWeight: "700" },
  modelLabelActive: { color: "#9945ff" },
  modelProvider: { color: "#555", fontSize: 10, marginTop: 2, textTransform: "uppercase" },
  capGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  capChip: {
    backgroundColor: "#1a1a2e",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#2a2a3e",
  },
  capChipActive: { backgroundColor: "#9945ff22", borderColor: "#9945ff" },
  capText: { color: "#888", fontSize: 12, fontWeight: "600" },
  capTextActive: { color: "#9945ff" },
  paramRow: { flexDirection: "row", gap: 12, marginBottom: 18 },
  paramField: { flex: 1 },
  riskRow: { flexDirection: "row", gap: 8 },
  riskChip: {
    flex: 1,
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2a2a3e",
  },
  riskText: { color: "#888", fontSize: 13, fontWeight: "600" },
  priceRow: { flexDirection: "row", alignItems: "center" },
  dollar: { color: "#14f195", fontSize: 20, fontWeight: "700", marginRight: 8 },
  priceInput: { flex: 1, fontSize: 20, fontWeight: "700", fontFamily: "monospace" },
  usdc: { color: "#888", fontSize: 14, fontWeight: "600", marginLeft: 8 },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    padding: 14,
  },
  switchLabel: { flex: 1, marginRight: 12 },
  switchDesc: { color: "#666", fontSize: 12, marginTop: 2 },
  createButton: {
    backgroundColor: "#9945ff",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  createDisabled: { opacity: 0.6 },
  createText: { color: "#ffffff", fontSize: 17, fontWeight: "700" },
});
