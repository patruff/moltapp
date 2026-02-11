import React, { useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Share,
  RefreshControl,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { POINTS_PER_REFERRAL } from "../utils/constants";
import * as api from "../services/api";
import { useAuth } from "../hooks/useAuth";

export function ReferralsScreen() {
  const { user } = useAuth();
  const referralCode = user?.referralCode ?? "---";

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["my-referrals"],
    queryFn: () => api.fetchMyReferrals(),
    enabled: !!user,
  });

  const referrals = data?.data ?? [];
  const totalEarned = referrals.reduce((sum, r) => sum + r.pointsAwarded, 0);

  const handleShare = useCallback(async () => {
    try {
      await Share.share({
        message: `Join MoltApp — the AI-to-AI financial intelligence marketplace on Solana! Use my referral code: ${referralCode}\n\nhttps://www.patgpt.us/r/${referralCode}`,
        title: "Join MoltApp",
      });
    } catch {}
  }, [referralCode]);

  return (
    <View style={styles.container}>
      {/* Referral Code Card */}
      <View style={styles.codeCard}>
        <Text style={styles.codeLabel}>Your Referral Code</Text>
        <Text style={styles.codeValue}>{referralCode}</Text>
        <Text style={styles.codeHint}>
          Earn {POINTS_PER_REFERRAL} points for each friend who joins
        </Text>

        <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
          <Text style={styles.shareText}>Share Invite Link</Text>
        </TouchableOpacity>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{referrals.length}</Text>
          <Text style={styles.statLabel}>Friends Invited</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{totalEarned.toLocaleString()}</Text>
          <Text style={styles.statLabel}>Points Earned</Text>
        </View>
      </View>

      {/* Referral History */}
      <Text style={styles.sectionTitle}>Referral History</Text>
      <FlatList
        data={referrals}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#9945ff" />
        }
        renderItem={({ item }) => (
          <View style={styles.referralRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {item.referredUserId.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.referralInfo}>
              <Text style={styles.referralUser}>
                User {item.referredUserId.slice(0, 8)}...
              </Text>
              <Text style={styles.referralDate}>
                {new Date(item.createdAt).toLocaleDateString()}
              </Text>
            </View>
            <Text style={styles.referralPoints}>+{item.pointsAwarded} pts</Text>
          </View>
        )}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                No referrals yet. Share your code to start earning!
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  codeCard: {
    margin: 16,
    backgroundColor: "#1a1a2e",
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#9945ff",
  },
  codeLabel: { color: "#888", fontSize: 13, fontWeight: "600", marginBottom: 8 },
  codeValue: {
    color: "#14f195",
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: 4,
    fontFamily: "monospace",
    marginBottom: 8,
  },
  codeHint: { color: "#888", fontSize: 13, textAlign: "center", marginBottom: 16 },
  shareButton: {
    backgroundColor: "#9945ff",
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 12,
  },
  shareText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  statsRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 20,
  },
  statBox: {
    flex: 1,
    backgroundColor: "#1a1a2e",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2a2a3e",
  },
  statValue: { color: "#fff", fontSize: 24, fontWeight: "800" },
  statLabel: { color: "#888", fontSize: 12, marginTop: 4 },
  sectionTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  listContent: { paddingHorizontal: 16, paddingBottom: 100 },
  referralRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#2a2a3e",
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#9945ff33",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  avatarText: { color: "#9945ff", fontSize: 16, fontWeight: "700" },
  referralInfo: { flex: 1 },
  referralUser: { color: "#fff", fontSize: 14, fontWeight: "600" },
  referralDate: { color: "#666", fontSize: 12, marginTop: 2 },
  referralPoints: { color: "#14f195", fontSize: 16, fontWeight: "700" },
  empty: { alignItems: "center", paddingVertical: 40 },
  emptyText: { color: "#666", fontSize: 15, textAlign: "center", paddingHorizontal: 20 },
});
