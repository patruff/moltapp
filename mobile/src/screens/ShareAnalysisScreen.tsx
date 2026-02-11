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
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { RootStackParamList, ShareVisibility, AgentCapability } from "../types";
import { CAPABILITY_LABELS } from "../utils/constants";
import * as api from "../services/api";

type Route = RouteProp<RootStackParamList, "ShareAnalysis">;

const VISIBILITY_OPTIONS: { value: ShareVisibility; label: string; desc: string }[] = [
  { value: "public", label: "Public", desc: "Visible in marketplace, anyone can buy" },
  { value: "unlisted", label: "Unlisted", desc: "Only accessible via direct link" },
  { value: "private", label: "Private", desc: "Only you can see it" },
];

export function ShareAnalysisScreen() {
  const route = useRoute<Route>();
  const nav = useNavigation();
  const { analysisId } = route.params;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [previewSummary, setPreviewSummary] = useState("");
  const [priceUsdc, setPriceUsdc] = useState("1.00");
  const [visibility, setVisibility] = useState<ShareVisibility>("public");
  const [maxPurchases, setMaxPurchases] = useState("0");
  const [hasExpiry, setHasExpiry] = useState(false);
  const [expiryDays, setExpiryDays] = useState("7");
  const [submitting, setSubmitting] = useState(false);

  const handleShare = async () => {
    if (!title.trim()) {
      Alert.alert("Title Required", "Give your shared analysis a title.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.shareAnalysis({
        analysisRunId: analysisId,
        title: title.trim(),
        description: description.trim(),
        previewSummary: previewSummary.trim(),
        priceUsdc: parseFloat(priceUsdc) || 0,
        visibility,
        maxPurchases: parseInt(maxPurchases, 10) || 0,
        expiresInDays: hasExpiry ? parseInt(expiryDays, 10) || 7 : undefined,
      });

      if (result.success) {
        Alert.alert(
          "Analysis Shared",
          visibility === "public"
            ? "Your analysis is now live on the marketplace."
            : "Your analysis has been shared.",
          [{ text: "OK", onPress: () => nav.goBack() }]
        );
      }
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <Text style={styles.heading}>Share Analysis</Text>
      <Text style={styles.subheading}>
        Package and sell your analysis on the marketplace
      </Text>

      {/* Title */}
      <View style={styles.field}>
        <Text style={styles.label}>Title</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. NVDA Deep Dive: Feb 2026 Earnings Preview"
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
          placeholder="What does this analysis cover?"
          placeholderTextColor="#555"
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
          maxLength={500}
        />
      </View>

      {/* Preview Summary */}
      <View style={styles.field}>
        <Text style={styles.label}>Preview Summary (shown before purchase)</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="A teaser to entice buyers..."
          placeholderTextColor="#555"
          value={previewSummary}
          onChangeText={setPreviewSummary}
          multiline
          numberOfLines={3}
          maxLength={300}
        />
      </View>

      {/* Visibility */}
      <View style={styles.field}>
        <Text style={styles.label}>Visibility</Text>
        <View style={styles.visRow}>
          {VISIBILITY_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[
                styles.visOption,
                visibility === opt.value && styles.visActive,
              ]}
              onPress={() => setVisibility(opt.value)}
            >
              <Text
                style={[
                  styles.visLabel,
                  visibility === opt.value && styles.visLabelActive,
                ]}
              >
                {opt.label}
              </Text>
              <Text style={styles.visDesc}>{opt.desc}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Price */}
      <View style={styles.field}>
        <Text style={styles.label}>Price (USDC)</Text>
        <View style={styles.priceRow}>
          <Text style={styles.dollar}>$</Text>
          <TextInput
            style={[styles.input, styles.priceInput]}
            value={priceUsdc}
            onChangeText={setPriceUsdc}
            keyboardType="decimal-pad"
            placeholder="1.00"
            placeholderTextColor="#555"
          />
          <Text style={styles.usdc}>USDC</Text>
        </View>
        <Text style={styles.hint}>Set to 0 for free sharing</Text>
      </View>

      {/* Max Purchases */}
      <View style={styles.field}>
        <Text style={styles.label}>Max Purchases (0 = unlimited)</Text>
        <TextInput
          style={styles.input}
          value={maxPurchases}
          onChangeText={setMaxPurchases}
          keyboardType="number-pad"
          placeholder="0"
          placeholderTextColor="#555"
        />
      </View>

      {/* Expiry */}
      <View style={styles.switchRow}>
        <View style={styles.switchContent}>
          <Text style={styles.label}>Set Expiry</Text>
          <Text style={styles.switchDesc}>
            Auto-remove listing after a time period
          </Text>
        </View>
        <Switch
          value={hasExpiry}
          onValueChange={setHasExpiry}
          trackColor={{ false: "#2a2a3e", true: "#9945ff44" }}
          thumbColor={hasExpiry ? "#9945ff" : "#666"}
        />
      </View>

      {hasExpiry && (
        <View style={styles.field}>
          <Text style={styles.label}>Expires in (days)</Text>
          <TextInput
            style={styles.input}
            value={expiryDays}
            onChangeText={setExpiryDays}
            keyboardType="number-pad"
            placeholder="7"
            placeholderTextColor="#555"
          />
        </View>
      )}

      {/* Submit */}
      <TouchableOpacity
        style={[styles.shareButton, submitting && styles.shareDisabled]}
        onPress={handleShare}
        disabled={submitting}
      >
        <Text style={styles.shareButtonText}>
          {submitting
            ? "Sharing..."
            : parseFloat(priceUsdc) > 0
            ? `Share for $${parseFloat(priceUsdc).toFixed(2)} USDC`
            : "Share for Free"}
        </Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a", paddingHorizontal: 16, paddingTop: 16 },
  heading: { color: "#ffffff", fontSize: 28, fontWeight: "800", marginBottom: 4 },
  subheading: { color: "#888", fontSize: 14, marginBottom: 24 },
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
  textArea: { minHeight: 80, textAlignVertical: "top" },
  visRow: { gap: 8 },
  visOption: {
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#2a2a3e",
    marginBottom: 8,
  },
  visActive: { borderColor: "#9945ff", backgroundColor: "#9945ff15" },
  visLabel: { color: "#888", fontSize: 15, fontWeight: "700", marginBottom: 2 },
  visLabelActive: { color: "#9945ff" },
  visDesc: { color: "#666", fontSize: 12 },
  priceRow: { flexDirection: "row", alignItems: "center" },
  dollar: { color: "#14f195", fontSize: 20, fontWeight: "700", marginRight: 8 },
  priceInput: { flex: 1, fontSize: 20, fontWeight: "700", fontFamily: "monospace" },
  usdc: { color: "#888", fontSize: 14, fontWeight: "600", marginLeft: 8 },
  hint: { color: "#555", fontSize: 11, marginTop: 4 },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    padding: 14,
  },
  switchContent: { flex: 1, marginRight: 12 },
  switchDesc: { color: "#666", fontSize: 12, marginTop: 2 },
  shareButton: { backgroundColor: "#9945ff", borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 8 },
  shareDisabled: { opacity: 0.6 },
  shareButtonText: { color: "#ffffff", fontSize: 17, fontWeight: "700" },
});
