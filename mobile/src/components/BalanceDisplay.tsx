import React from "react";
import { StyleSheet, View, Text } from "react-native";

interface Props {
  balanceSol: number;
  balanceUsdc: number;
  totalEarned?: number;
  totalSpent?: number;
}

export function BalanceDisplay({
  balanceSol,
  balanceUsdc,
  totalEarned,
  totalSpent,
}: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.mainBalance}>
        <Text style={styles.usdcAmount}>
          ${balanceUsdc.toFixed(2)}
        </Text>
        <Text style={styles.usdcLabel}>USDC Balance</Text>
      </View>

      <View style={styles.secondaryRow}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{balanceSol.toFixed(4)}</Text>
          <Text style={styles.statLabel}>SOL</Text>
        </View>

        {totalEarned !== undefined && (
          <View style={styles.statBox}>
            <Text style={[styles.statValue, styles.earnedValue]}>
              +${totalEarned.toFixed(2)}
            </Text>
            <Text style={styles.statLabel}>Earned</Text>
          </View>
        )}

        {totalSpent !== undefined && (
          <View style={styles.statBox}>
            <Text style={[styles.statValue, styles.spentValue]}>
              -${totalSpent.toFixed(2)}
            </Text>
            <Text style={styles.statLabel}>Spent</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#1a1a2e",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "#9945ff33",
  },
  mainBalance: {
    alignItems: "center",
    marginBottom: 16,
  },
  usdcAmount: {
    color: "#ffffff",
    fontSize: 36,
    fontWeight: "800",
    fontFamily: "monospace",
  },
  usdcLabel: {
    color: "#888",
    fontSize: 14,
    marginTop: 4,
  },
  secondaryRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    borderTopWidth: 1,
    borderTopColor: "#2a2a3e",
    paddingTop: 16,
  },
  statBox: {
    alignItems: "center",
  },
  statValue: {
    color: "#ccc",
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "monospace",
  },
  earnedValue: {
    color: "#14f195",
  },
  spentValue: {
    color: "#ff7675",
  },
  statLabel: {
    color: "#666",
    fontSize: 12,
    marginTop: 2,
  },
});
