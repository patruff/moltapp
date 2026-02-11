import React, { useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useAgent } from "../hooks/useAgentMarketplace";
import { CAPABILITY_LABELS, MODEL_OPTIONS } from "../utils/constants";
import type { RootStackParamList, AgentCapability } from "../types";
import * as api from "../services/api";

type Route = RouteProp<RootStackParamList, "RunAnalysis">;

const POPULAR_TICKERS = [
  "AAPL", "NVDA", "TSLA", "MSFT", "GOOGL",
  "AMZN", "META", "AMD", "ORCL", "CRM",
];

export function RunAnalysisScreen() {
  const route = useRoute<Route>();
  const nav = useNavigation();
  const { agentId } = route.params;
  const { data: agentRes, isLoading: agentLoading } = useAgent(agentId);
  const agent = agentRes?.data;

  const [selectedTickers, setSelectedTickers] = useState<string[]>(["NVDA", "AAPL"]);
  const [customTicker, setCustomTicker] = useState("");
  const [capability, setCapability] = useState<AgentCapability>("financial_analysis");
  const [maxTokens, setMaxTokens] = useState("8000");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);

  const toggleTicker = (ticker: string) => {
    setSelectedTickers((prev) =>
      prev.includes(ticker)
        ? prev.filter((t) => t !== ticker)
        : [...prev, ticker]
    );
  };

  const addCustomTicker = () => {
    const t = customTicker.trim().toUpperCase();
    if (t && !selectedTickers.includes(t)) {
      setSelectedTickers((prev) => [...prev, t]);
      setCustomTicker("");
    }
  };

  const handleRun = async () => {
    if (selectedTickers.length === 0) {
      Alert.alert("Select Tickers", "Pick at least one ticker to analyze.");
      return;
    }

    setRunning(true);
    setResult(null);
    try {
      const res = await api.runAnalysis({
        agentId,
        tickers: selectedTickers,
        capability,
        maxTokens: parseInt(maxTokens, 10) || 8000,
      });

      if (res.success && res.data) {
        setResult(res.data);
      } else {
        Alert.alert("Error", res.error ?? "Analysis failed.");
      }
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setRunning(false);
    }
  };

  if (agentLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#9945ff" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <Text style={styles.heading}>Run Analysis</Text>
      {agent && (
        <Text style={styles.agentName}>
          Using: {agent.name} ({agent.model})
        </Text>
      )}

      {/* Ticker Selection */}
      <View style={styles.field}>
        <Text style={styles.label}>Select Tickers</Text>
        <View style={styles.tickerGrid}>
          {POPULAR_TICKERS.map((ticker) => (
            <TouchableOpacity
              key={ticker}
              style={[
                styles.tickerChip,
                selectedTickers.includes(ticker) && styles.tickerActive,
              ]}
              onPress={() => toggleTicker(ticker)}
            >
              <Text
                style={[
                  styles.tickerText,
                  selectedTickers.includes(ticker) && styles.tickerTextActive,
                ]}
              >
                {ticker}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Custom ticker */}
        <View style={styles.customTickerRow}>
          <TextInput
            style={[styles.input, styles.customInput]}
            placeholder="Add ticker..."
            placeholderTextColor="#555"
            value={customTicker}
            onChangeText={setCustomTicker}
            autoCapitalize="characters"
            maxLength={10}
          />
          <TouchableOpacity style={styles.addButton} onPress={addCustomTicker}>
            <Text style={styles.addText}>Add</Text>
          </TouchableOpacity>
        </View>

        {/* Selected */}
        {selectedTickers.length > 0 && (
          <Text style={styles.selectedInfo}>
            Selected: {selectedTickers.join(", ")}
          </Text>
        )}
      </View>

      {/* Capability */}
      <View style={styles.field}>
        <Text style={styles.label}>Analysis Type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.capRow}>
            {(agent?.capabilities ?? ["financial_analysis"]).map((cap) => (
              <TouchableOpacity
                key={cap}
                style={[
                  styles.capChip,
                  capability === cap && styles.capActive,
                ]}
                onPress={() => setCapability(cap as AgentCapability)}
              >
                <Text
                  style={[
                    styles.capText,
                    capability === cap && styles.capTextActive,
                  ]}
                >
                  {CAPABILITY_LABELS[cap] ?? cap}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* Max Tokens */}
      <View style={styles.field}>
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

      {/* Run Button */}
      <TouchableOpacity
        style={[styles.runButton, running && styles.runDisabled]}
        onPress={handleRun}
        disabled={running}
      >
        {running ? (
          <View style={styles.runningRow}>
            <ActivityIndicator color="#0a0a0a" size="small" />
            <Text style={styles.runText}>Running Analysis...</Text>
          </View>
        ) : (
          <Text style={styles.runText}>Run Analysis</Text>
        )}
      </TouchableOpacity>

      {/* Results Preview */}
      {result && (
        <View style={styles.resultSection}>
          <Text style={styles.resultHeading}>Analysis Complete</Text>
          <View style={styles.resultCard}>
            <Text style={styles.resultSummary}>{result.result?.summary ?? "Analysis completed."}</Text>
            <View style={styles.resultMeta}>
              <Text style={styles.resultMetaItem}>
                {result.tokensUsed?.toLocaleString() ?? 0} tokens
              </Text>
              <Text style={styles.resultMetaItem}>
                {result.durationMs ? `${(result.durationMs / 1000).toFixed(1)}s` : ""}
              </Text>
              <Text style={[styles.resultMetaItem, styles.costText]}>
                ${result.costUsdc?.toFixed(4) ?? "0.00"} USDC
              </Text>
            </View>
          </View>

          <View style={styles.resultActions}>
            <TouchableOpacity
              style={styles.viewFullButton}
              onPress={() =>
                nav.navigate("AnalysisResult" as any, {
                  analysisId: result.id,
                })
              }
            >
              <Text style={styles.viewFullText}>View Full Analysis</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.shareButton}
              onPress={() =>
                nav.navigate("ShareAnalysis" as any, {
                  analysisId: result.id,
                })
              }
            >
              <Text style={styles.shareText}>Share / Sell</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a", paddingHorizontal: 16, paddingTop: 16 },
  loadingContainer: { flex: 1, backgroundColor: "#0a0a0a", justifyContent: "center", alignItems: "center" },
  heading: { color: "#ffffff", fontSize: 28, fontWeight: "800", marginBottom: 4 },
  agentName: { color: "#9945ff", fontSize: 14, fontWeight: "600", marginBottom: 20 },
  field: { marginBottom: 18 },
  label: { color: "#ccc", fontSize: 13, fontWeight: "600", marginBottom: 8 },
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
  tickerGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  tickerChip: {
    backgroundColor: "#1a1a2e",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#2a2a3e",
  },
  tickerActive: { borderColor: "#14f195", backgroundColor: "#14f19515" },
  tickerText: { color: "#888", fontSize: 14, fontWeight: "700", fontFamily: "monospace" },
  tickerTextActive: { color: "#14f195" },
  customTickerRow: { flexDirection: "row", gap: 8 },
  customInput: { flex: 1 },
  addButton: {
    backgroundColor: "#2a2a3e",
    borderRadius: 12,
    paddingHorizontal: 20,
    justifyContent: "center",
  },
  addText: { color: "#9945ff", fontWeight: "700", fontSize: 14 },
  selectedInfo: { color: "#14f195", fontSize: 12, marginTop: 8, fontFamily: "monospace" },
  capRow: { flexDirection: "row", gap: 8 },
  capChip: {
    backgroundColor: "#1a1a2e",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#2a2a3e",
  },
  capActive: { backgroundColor: "#9945ff22", borderColor: "#9945ff" },
  capText: { color: "#888", fontSize: 12, fontWeight: "600" },
  capTextActive: { color: "#9945ff" },
  runButton: { backgroundColor: "#14f195", borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 8 },
  runDisabled: { opacity: 0.7 },
  runningRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  runText: { color: "#0a0a0a", fontSize: 17, fontWeight: "700" },
  resultSection: { marginTop: 24 },
  resultHeading: { color: "#14f195", fontSize: 18, fontWeight: "700", marginBottom: 12 },
  resultCard: { backgroundColor: "#1a1a2e", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#14f19533" },
  resultSummary: { color: "#ccc", fontSize: 14, lineHeight: 21, marginBottom: 12 },
  resultMeta: { flexDirection: "row", gap: 16, borderTopWidth: 1, borderTopColor: "#2a2a3e", paddingTop: 10 },
  resultMetaItem: { color: "#888", fontSize: 12 },
  costText: { color: "#14f195", fontWeight: "600" },
  resultActions: { flexDirection: "row", gap: 12, marginTop: 12 },
  viewFullButton: { flex: 1, backgroundColor: "#1a1a2e", borderRadius: 12, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: "#2a2a3e" },
  viewFullText: { color: "#ccc", fontSize: 14, fontWeight: "600" },
  shareButton: { flex: 1, backgroundColor: "#9945ff", borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  shareText: { color: "#fff", fontSize: 14, fontWeight: "700" },
});
