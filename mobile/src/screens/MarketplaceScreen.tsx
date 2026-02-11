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
import { useAgents, useOpenJobs } from "../hooks/useAgentMarketplace";
import { AgentCard } from "../components/AgentCard";
import { JobCard } from "../components/JobCard";
import { CAPABILITY_LABELS } from "../utils/constants";
import type { RootStackParamList, AgentCapability } from "../types";

type NavProp = NativeStackNavigationProp<RootStackParamList>;

type Tab = "agents" | "jobs";

const CAPABILITIES: AgentCapability[] = [
  "financial_analysis",
  "stock_screening",
  "portfolio_optimization",
  "risk_assessment",
  "market_sentiment",
  "technical_analysis",
  "macro_research",
];

export function MarketplaceScreen() {
  const nav = useNavigation<NavProp>();
  const [tab, setTab] = useState<Tab>("agents");
  const [selectedCap, setSelectedCap] = useState<
    AgentCapability | undefined
  >();

  const {
    data: agents,
    isLoading: agentsLoading,
    refetch: refetchAgents,
  } = useAgents(selectedCap);
  const {
    data: jobs,
    isLoading: jobsLoading,
    refetch: refetchJobs,
  } = useOpenJobs(selectedCap);

  const isLoading = tab === "agents" ? agentsLoading : jobsLoading;

  return (
    <View style={styles.container}>
      {/* Tab Selector */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, tab === "agents" && styles.activeTab]}
          onPress={() => setTab("agents")}
        >
          <Text
            style={[styles.tabText, tab === "agents" && styles.activeTabText]}
          >
            Agents
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === "jobs" && styles.activeTab]}
          onPress={() => setTab("jobs")}
        >
          <Text
            style={[styles.tabText, tab === "jobs" && styles.activeTabText]}
          >
            Open Jobs
          </Text>
        </TouchableOpacity>
      </View>

      {/* Capability Filter */}
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
              selectedCap === item && styles.filterChipActive,
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

      {/* Agent List */}
      {tab === "agents" && (
        <FlatList
          data={agents?.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={agentsLoading}
              onRefresh={refetchAgents}
              tintColor="#9945ff"
            />
          }
          renderItem={({ item }) => (
            <AgentCard
              agent={item}
              onPress={() =>
                nav.navigate("AgentDetail", { agentId: item.id })
              }
            />
          )}
          ListEmptyComponent={
            !isLoading ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No agents found</Text>
              </View>
            ) : null
          }
        />
      )}

      {/* Jobs List */}
      {tab === "jobs" && (
        <FlatList
          data={jobs?.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={jobsLoading}
              onRefresh={refetchJobs}
              tintColor="#9945ff"
            />
          }
          renderItem={({ item }) => (
            <JobCard
              job={item}
              onPress={() =>
                nav.navigate("JobDetail", { jobId: item.id })
              }
            />
          )}
          ListEmptyComponent={
            !isLoading ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No open jobs</Text>
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
  },
  tabRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#1a1a2e",
  },
  activeTab: {
    backgroundColor: "#9945ff",
  },
  tabText: {
    color: "#888",
    fontSize: 15,
    fontWeight: "600",
  },
  activeTabText: {
    color: "#ffffff",
  },
  filterList: {
    maxHeight: 44,
    marginTop: 12,
  },
  filterContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  filterChip: {
    backgroundColor: "#1a1a2e",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
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
    fontWeight: "500",
  },
  filterTextActive: {
    color: "#9945ff",
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  empty: {
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyText: {
    color: "#666",
    fontSize: 16,
  },
});
