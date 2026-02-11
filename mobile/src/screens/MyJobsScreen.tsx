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
import { useMobileWallet } from "../hooks/useMobileWallet";
import { useMyJobs } from "../hooks/useAgentMarketplace";
import { JobCard } from "../components/JobCard";
import type { RootStackParamList, JobStatus } from "../types";

type NavProp = NativeStackNavigationProp<RootStackParamList>;

const STATUS_FILTERS: { label: string; value: JobStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Open", value: "open" },
  { label: "Active", value: "in_progress" },
  { label: "Delivered", value: "delivered" },
  { label: "Completed", value: "completed" },
];

export function MyJobsScreen() {
  const nav = useNavigation<NavProp>();
  const wallet = useMobileWallet();
  const [filter, setFilter] = useState<JobStatus | "all">("all");

  const {
    data: jobs,
    isLoading,
    refetch,
  } = useMyJobs(wallet.account?.address);

  const filteredJobs =
    filter === "all"
      ? jobs?.data
      : jobs?.data?.filter((j) => j.status === filter);

  if (!wallet.connected) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>Connect Your Wallet</Text>
        <Text style={styles.emptyDesc}>
          Connect your Solana wallet to see your jobs.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Filter Row */}
      <FlatList
        horizontal
        data={STATUS_FILTERS}
        showsHorizontalScrollIndicator={false}
        style={styles.filterList}
        contentContainerStyle={styles.filterContent}
        keyExtractor={(item) => item.value}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[
              styles.filterChip,
              filter === item.value && styles.filterChipActive,
            ]}
            onPress={() => setFilter(item.value)}
          >
            <Text
              style={[
                styles.filterText,
                filter === item.value && styles.filterTextActive,
              ]}
            >
              {item.label}
            </Text>
          </TouchableOpacity>
        )}
      />

      {/* Jobs List */}
      <FlatList
        data={filteredJobs ?? []}
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
          <JobCard
            job={item}
            onPress={() => nav.navigate("JobDetail", { jobId: item.id })}
          />
        )}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyList}>
              <Text style={styles.emptyListText}>
                {filter === "all"
                  ? "No jobs yet. Post your first job!"
                  : `No ${filter.replace("_", " ")} jobs.`}
              </Text>
              {filter === "all" && (
                <TouchableOpacity
                  style={styles.postButton}
                  onPress={() => nav.navigate("PostJob")}
                >
                  <Text style={styles.postButtonText}>Post a Job</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
  },
  filterList: {
    maxHeight: 52,
    paddingTop: 8,
  },
  filterContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  filterChip: {
    backgroundColor: "#1a1a2e",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#2a2a3e",
  },
  filterChipActive: {
    backgroundColor: "#9945ff22",
    borderColor: "#9945ff",
  },
  filterText: {
    color: "#888",
    fontSize: 13,
    fontWeight: "600",
  },
  filterTextActive: {
    color: "#9945ff",
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  emptyContainer: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  emptyTitle: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
  },
  emptyDesc: {
    color: "#888",
    fontSize: 15,
    textAlign: "center",
  },
  emptyList: {
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyListText: {
    color: "#888",
    fontSize: 15,
    marginBottom: 16,
  },
  postButton: {
    backgroundColor: "#9945ff",
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  postButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
});
