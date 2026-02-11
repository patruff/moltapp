import React from "react";
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { QUEST_CATEGORY_LABELS } from "../utils/constants";
import * as api from "../services/api";
import type { Quest, QuestCategory } from "../types";

const CATEGORY_COLORS: Record<QuestCategory, string> = {
  onboarding: "#14f195",
  trading: "#9945ff",
  social: "#00d4ff",
  marketplace: "#ffeaa7",
  streak: "#ff6b6b",
};

export function QuestsScreen() {
  const queryClient = useQueryClient();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["quests"],
    queryFn: () => api.fetchQuests(),
    refetchInterval: 30_000,
  });

  const { data: pointsData } = useQuery({
    queryKey: ["my-points"],
    queryFn: () => api.fetchMyPoints(),
  });

  const claimMutation = useMutation({
    mutationFn: (questId: string) => api.claimQuest(questId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quests"] });
      queryClient.invalidateQueries({ queryKey: ["my-points"] });
    },
  });

  const quests = data?.data ?? [];
  const totalPoints = pointsData?.data?.totalPoints ?? 0;

  // Group quests by category
  const grouped = quests.reduce(
    (acc, q) => {
      if (!acc[q.category]) acc[q.category] = [];
      acc[q.category].push(q);
      return acc;
    },
    {} as Record<string, Quest[]>
  );

  const sections = Object.entries(grouped).map(([category, items]) => ({
    category,
    items: items.sort((a, b) => a.sortOrder - b.sortOrder),
  }));

  return (
    <View style={styles.container}>
      {/* Points Header */}
      <View style={styles.pointsHeader}>
        <View>
          <Text style={styles.pointsLabel}>Your Points</Text>
          <Text style={styles.pointsValue}>{totalPoints.toLocaleString()}</Text>
        </View>
        <View style={styles.pointsBadge}>
          <Text style={styles.badgeText}>
            {quests.filter((q) => q.status === "completed").length} / {quests.length} Complete
          </Text>
        </View>
      </View>

      <FlatList
        data={sections}
        keyExtractor={(item) => item.category}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#9945ff" />
        }
        renderItem={({ item: section }) => (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View
                style={[
                  styles.categoryDot,
                  { backgroundColor: CATEGORY_COLORS[section.category as QuestCategory] ?? "#888" },
                ]}
              />
              <Text style={styles.sectionTitle}>
                {QUEST_CATEGORY_LABELS[section.category] ?? section.category}
              </Text>
            </View>
            {section.items.map((quest) => (
              <QuestCard
                key={quest.id}
                quest={quest}
                color={CATEGORY_COLORS[quest.category] ?? "#888"}
                onClaim={() => claimMutation.mutate(quest.id)}
                claiming={claimMutation.isPending}
              />
            ))}
          </View>
        )}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No quests available. Check back soon!</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

function QuestCard({
  quest,
  color,
  onClaim,
  claiming,
}: {
  quest: Quest;
  color: string;
  onClaim: () => void;
  claiming: boolean;
}) {
  const progress = Math.min(quest.progress / quest.requirement.count, 1);
  const isClaimable = quest.status === "completed";
  const isClaimed = quest.status === "claimed";

  return (
    <View style={[styles.questCard, isClaimed && styles.questClaimed]}>
      <View style={styles.questTop}>
        <View style={styles.questInfo}>
          <Text style={[styles.questTitle, isClaimed && styles.questTitleDone]}>
            {quest.title}
          </Text>
          <Text style={styles.questDesc}>{quest.description}</Text>
        </View>
        <View style={styles.questReward}>
          <Text style={[styles.rewardPoints, { color }]}>+{quest.pointsReward}</Text>
          <Text style={styles.rewardLabel}>pts</Text>
          {quest.usdcReward != null && quest.usdcReward > 0 && (
            <Text style={styles.usdcBonus}>+${quest.usdcReward} USDC</Text>
          )}
        </View>
      </View>

      {/* Progress bar */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.progressText}>
        {quest.progress} / {quest.requirement.count}
      </Text>

      {isClaimable && !isClaimed && (
        <TouchableOpacity
          style={[styles.claimButton, { backgroundColor: color }]}
          onPress={onClaim}
          disabled={claiming}
        >
          <Text style={styles.claimText}>{claiming ? "Claiming..." : "Claim Reward"}</Text>
        </TouchableOpacity>
      )}

      {isClaimed && (
        <View style={styles.claimedBadge}>
          <Text style={styles.claimedText}>Claimed</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  pointsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 20,
    backgroundColor: "#1a1a2e",
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a3e",
  },
  pointsLabel: { color: "#888", fontSize: 13, fontWeight: "600" },
  pointsValue: { color: "#14f195", fontSize: 32, fontWeight: "800" },
  pointsBadge: {
    backgroundColor: "#9945ff22",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#9945ff",
  },
  badgeText: { color: "#9945ff", fontSize: 13, fontWeight: "700" },
  listContent: { padding: 16, paddingBottom: 100 },
  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  categoryDot: { width: 10, height: 10, borderRadius: 5 },
  sectionTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  questCard: {
    backgroundColor: "#1a1a2e",
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#2a2a3e",
  },
  questClaimed: { opacity: 0.6 },
  questTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  questInfo: { flex: 1, marginRight: 12 },
  questTitle: { color: "#fff", fontSize: 15, fontWeight: "700", marginBottom: 4 },
  questTitleDone: { textDecorationLine: "line-through", color: "#888" },
  questDesc: { color: "#888", fontSize: 13, lineHeight: 18 },
  questReward: { alignItems: "flex-end" },
  rewardPoints: { fontSize: 18, fontWeight: "800" },
  rewardLabel: { color: "#888", fontSize: 11 },
  usdcBonus: { color: "#14f195", fontSize: 11, fontWeight: "600", marginTop: 2 },
  progressBar: {
    height: 6,
    backgroundColor: "#2a2a3e",
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 4,
  },
  progressFill: { height: "100%", borderRadius: 3 },
  progressText: { color: "#666", fontSize: 11, textAlign: "right" },
  claimButton: {
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  claimText: { color: "#000", fontSize: 14, fontWeight: "700" },
  claimedBadge: {
    marginTop: 8,
    alignSelf: "flex-start",
    backgroundColor: "#14f19522",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  claimedText: { color: "#14f195", fontSize: 12, fontWeight: "600" },
  empty: { alignItems: "center", paddingVertical: 40 },
  emptyText: { color: "#666", fontSize: 15, textAlign: "center" },
});
