import React, { useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { CAPABILITY_LABELS } from "../utils/constants";
import * as api from "../services/api";
import type { RootStackParamList, SharedAnalysis, AgentCapability } from "../types";

type NavProp = NativeStackNavigationProp<RootStackParamList>;

const CAPABILITIES: AgentCapability[] = [
  "financial_analysis",
  "stock_screening",
  "portfolio_optimization",
  "risk_assessment",
  "market_sentiment",
  "technical_analysis",
  "macro_research",
];

export function BrowseSharedScreen() {
  const nav = useNavigation<NavProp>();
  const [selectedCap, setSelectedCap] = useState<AgentCapability | undefined>();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["shared", selectedCap],
    queryFn: () => api.fetchSharedAnalyses({ capability: selectedCap }),
    refetchInterval: 30_000,
  });

  return (
    <View style={styles.container}>
      {/* Filter */}
      <FlatList
        horizontal
        data={CAPABILITIES}
        showsHorizontalScrollIndicator={false}
        style={styles.filterList}
        contentContainerStyle={styles.filterContent}
        keyExtractor={(item) => item}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[
              styles.filterChip,
              selectedCap === item && styles.filterActive,
            ]}
            onPress={() =>
              setSelectedCap(selectedCap === item ? undefined : item)
            }
          >
            <Text
              style={[
                styles.filterText,
                selectedCap === item && styles.filterTextActive,
              ]}
            >
              {CAPABILITY_LABELS[item]}
            </Text>
          </TouchableOpacity>
        )}
      />

      {/* Shared List */}
      <FlatList
        data={data?.data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refetch}
            tintColor="#9945ff"
          />
        }
        renderItem={({ item }) => (
          <SharedAnalysisCard
            shared={item}
            onPress={() =>
              nav.navigate("SharedAnalysisDetail", { sharedId: item.id })
            }
          />
        )}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                No shared analyses yet. Run an analysis and share it!
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

function SharedAnalysisCard({
  shared,
  onPress,
}: {
  shared: SharedAnalysis;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {shared.title}
        </Text>
        {shared.priceUsdc > 0 ? (
          <Text style={styles.cardPrice}>
            ${shared.priceUsdc.toFixed(2)}
          </Text>
        ) : (
          <Text style={styles.freeTag}>FREE</Text>
        )}
      </View>

      <Text style={styles.cardPreview} numberOfLines={2}>
        {shared.previewSummary || shared.description}
      </Text>

      <View style={styles.cardMeta}>
        {shared.tickers.slice(0, 5).map((t) => (
          <Text key={t} style={styles.ticker}>
            {t}
          </Text>
        ))}
      </View>

      <View style={styles.cardFooter}>
        <Text style={styles.footerItem}>
          {CAPABILITY_LABELS[shared.capability] ?? shared.capability}
        </Text>
        <Text style={styles.footerItem}>
          {shared.purchaseCount} purchased
        </Text>
        {shared.rating > 0 && (
          <Text style={styles.footerRating}>
            {shared.rating.toFixed(1)} ({shared.ratingCount})
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  filterList: { maxHeight: 52, paddingTop: 8 },
  filterContent: { paddingHorizontal: 16, gap: 8 },
  filterChip: {
    backgroundColor: "#1a1a2e",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#2a2a3e",
  },
  filterActive: { backgroundColor: "#9945ff22", borderColor: "#9945ff" },
  filterText: { color: "#888", fontSize: 13, fontWeight: "600" },
  filterTextActive: { color: "#9945ff" },
  listContent: { padding: 16, paddingBottom: 100 },
  card: {
    backgroundColor: "#1a1a2e",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#2a2a3e",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  cardTitle: { color: "#fff", fontSize: 16, fontWeight: "700", flex: 1, marginRight: 8 },
  cardPrice: { color: "#14f195", fontSize: 16, fontWeight: "700" },
  freeTag: { color: "#ffeaa7", fontSize: 12, fontWeight: "700", backgroundColor: "#ffeaa722", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  cardPreview: { color: "#aaa", fontSize: 14, lineHeight: 20, marginBottom: 10 },
  cardMeta: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 },
  ticker: { color: "#14f195", fontSize: 12, fontWeight: "700", fontFamily: "monospace", backgroundColor: "#14f19515", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  cardFooter: { flexDirection: "row", gap: 12, borderTopWidth: 1, borderTopColor: "#2a2a3e", paddingTop: 8 },
  footerItem: { color: "#666", fontSize: 12 },
  footerRating: { color: "#ffd700", fontSize: 12, marginLeft: "auto" },
  empty: { alignItems: "center", paddingVertical: 40 },
  emptyText: { color: "#666", fontSize: 15, textAlign: "center" },
});
