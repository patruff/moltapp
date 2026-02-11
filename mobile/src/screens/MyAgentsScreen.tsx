import React from "react";
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../hooks/useAuth";
import { useMobileWallet } from "../hooks/useMobileWallet";
import { useAgents } from "../hooks/useAgentMarketplace";
import { AgentCard } from "../components/AgentCard";
import type { RootStackParamList } from "../types";

type NavProp = NativeStackNavigationProp<RootStackParamList>;

export function MyAgentsScreen() {
  const nav = useNavigation<NavProp>();
  const auth = useAuth();
  const wallet = useMobileWallet();
  const {
    data: allAgents,
    isLoading,
    refetch,
  } = useAgents();

  // Filter to user's agents (by wallet address match)
  const myWallet = wallet.account?.address ?? auth.user?.walletAddress;
  const myAgents = allAgents?.data?.filter(
    (a) => a.ownerWallet === myWallet || auth.user?.agentIds?.includes(a.id)
  );

  if (!auth.authenticated) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>Sign In to Manage Agents</Text>
        <Text style={styles.emptyDesc}>
          Create and customize your own AI agents.
        </Text>
        <TouchableOpacity
          style={styles.loginButton}
          onPress={() => nav.navigate("Login")}
        >
          <Text style={styles.loginText}>Sign In</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Create Button */}
      <TouchableOpacity
        style={styles.createBar}
        onPress={() => nav.navigate("CreateAgent")}
      >
        <Text style={styles.createIcon}>+</Text>
        <Text style={styles.createText}>Create New Agent</Text>
      </TouchableOpacity>

      <FlatList
        data={myAgents ?? []}
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
          <View>
            <AgentCard
              agent={item}
              onPress={() =>
                nav.navigate("AgentDetail", { agentId: item.id })
              }
            />
            {/* Quick Actions per agent */}
            <View style={styles.agentActions}>
              <TouchableOpacity
                style={styles.agentAction}
                onPress={() =>
                  nav.navigate("RunAnalysis", { agentId: item.id })
                }
              >
                <Text style={styles.agentActionText}>Run Analysis</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.agentAction}
                onPress={() =>
                  nav.navigate("EditAgent", { agentId: item.id })
                }
              >
                <Text style={styles.agentActionText}>Edit</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyList}>
              <Text style={styles.emptyListTitle}>No agents yet</Text>
              <Text style={styles.emptyListDesc}>
                Create your first AI agent to start running analysis and
                earning USDC on the marketplace.
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
  createBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#9945ff22",
    borderWidth: 1,
    borderColor: "#9945ff",
    borderRadius: 14,
    paddingVertical: 14,
    marginHorizontal: 16,
    marginTop: 12,
    gap: 8,
  },
  createIcon: { color: "#9945ff", fontSize: 22, fontWeight: "700" },
  createText: { color: "#9945ff", fontSize: 16, fontWeight: "700" },
  listContent: { padding: 16, paddingBottom: 100 },
  agentActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: -4,
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  agentAction: {
    flex: 1,
    backgroundColor: "#1a1a2e",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2a2a3e",
  },
  agentActionText: { color: "#9945ff", fontSize: 13, fontWeight: "600" },
  emptyContainer: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  emptyTitle: { color: "#ffffff", fontSize: 20, fontWeight: "700", marginBottom: 8 },
  emptyDesc: { color: "#888", fontSize: 15, textAlign: "center", marginBottom: 20 },
  loginButton: {
    backgroundColor: "#9945ff",
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 12,
  },
  loginText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  emptyList: { alignItems: "center", paddingVertical: 40 },
  emptyListTitle: { color: "#888", fontSize: 16, fontWeight: "600", marginBottom: 8 },
  emptyListDesc: { color: "#666", fontSize: 14, textAlign: "center", maxWidth: 280, lineHeight: 20 },
});
