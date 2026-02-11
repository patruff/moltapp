import React from "react";
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  RefreshControl,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import * as api from "../services/api";
import type { LeaderboardEntry } from "../types";

const MEDAL_COLORS = ["#ffd700", "#c0c0c0", "#cd7f32"]; // gold, silver, bronze

export function LeaderboardScreen() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["leaderboard"],
    queryFn: () => api.fetchLeaderboard(),
    refetchInterval: 60_000,
  });

  const { data: myPoints } = useQuery({
    queryKey: ["my-points"],
    queryFn: () => api.fetchMyPoints(),
  });

  const entries = data?.data ?? [];
  const myTotal = myPoints?.data?.totalPoints ?? 0;

  return (
    <View style={styles.container}>
      {/* My rank banner */}
      <View style={styles.myRank}>
        <Text style={styles.myRankLabel}>Your Points</Text>
        <Text style={styles.myRankValue}>{myTotal.toLocaleString()}</Text>
      </View>

      {/* Top 3 podium */}
      {entries.length >= 3 && (
        <View style={styles.podium}>
          <PodiumSpot entry={entries[1]} position={2} />
          <PodiumSpot entry={entries[0]} position={1} />
          <PodiumSpot entry={entries[2]} position={3} />
        </View>
      )}

      {/* Full leaderboard */}
      <FlatList
        data={entries.slice(3)}
        keyExtractor={(item) => item.userId}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#9945ff" />
        }
        renderItem={({ item }) => <LeaderboardRow entry={item} />}
        ListEmptyComponent={
          !isLoading && entries.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                No one on the leaderboard yet. Complete quests to earn points!
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

function PodiumSpot({ entry, position }: { entry: LeaderboardEntry; position: number }) {
  const height = position === 1 ? 100 : position === 2 ? 80 : 65;
  const color = MEDAL_COLORS[position - 1];

  return (
    <View style={[styles.podiumSpot, { height }]}>
      <Text style={[styles.podiumRank, { color }]}>#{position}</Text>
      <View style={[styles.podiumAvatar, { borderColor: color }]}>
        <Text style={styles.podiumInitial}>
          {entry.displayName.charAt(0).toUpperCase()}
        </Text>
      </View>
      <Text style={styles.podiumName} numberOfLines={1}>
        {entry.displayName}
      </Text>
      <Text style={[styles.podiumPoints, { color }]}>
        {entry.points.toLocaleString()}
      </Text>
    </View>
  );
}

function LeaderboardRow({ entry }: { entry: LeaderboardEntry }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowRank}>#{entry.rank}</Text>
      <View style={styles.rowAvatar}>
        <Text style={styles.rowInitial}>
          {entry.displayName.charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={styles.rowInfo}>
        <Text style={styles.rowName}>{entry.displayName}</Text>
        <Text style={styles.rowStats}>
          {entry.agentCount} agents | {entry.salesCount} sales
        </Text>
      </View>
      <Text style={styles.rowPoints}>{entry.points.toLocaleString()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  myRank: {
    alignItems: "center",
    paddingVertical: 16,
    backgroundColor: "#1a1a2e",
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a3e",
  },
  myRankLabel: { color: "#888", fontSize: 13, fontWeight: "600" },
  myRankValue: { color: "#14f195", fontSize: 28, fontWeight: "800" },
  podium: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "flex-end",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    gap: 12,
  },
  podiumSpot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    backgroundColor: "#1a1a2e",
    borderRadius: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#2a2a3e",
  },
  podiumRank: { fontSize: 14, fontWeight: "800", marginBottom: 4 },
  podiumAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#2a2a3e",
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  podiumInitial: { color: "#fff", fontSize: 16, fontWeight: "700" },
  podiumName: { color: "#ccc", fontSize: 11, fontWeight: "600", maxWidth: 80 },
  podiumPoints: { fontSize: 14, fontWeight: "800", marginTop: 2 },
  listContent: { padding: 16, paddingBottom: 100 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#2a2a3e",
  },
  rowRank: { color: "#888", fontSize: 14, fontWeight: "700", width: 36 },
  rowAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#9945ff33",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  rowInitial: { color: "#9945ff", fontSize: 14, fontWeight: "700" },
  rowInfo: { flex: 1 },
  rowName: { color: "#fff", fontSize: 14, fontWeight: "600" },
  rowStats: { color: "#666", fontSize: 12, marginTop: 2 },
  rowPoints: { color: "#14f195", fontSize: 16, fontWeight: "800" },
  empty: { alignItems: "center", paddingVertical: 40 },
  emptyText: { color: "#666", fontSize: 15, textAlign: "center" },
});
