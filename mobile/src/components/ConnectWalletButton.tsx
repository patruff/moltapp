import React from "react";
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator } from "react-native";

interface Props {
  connected: boolean;
  address?: string;
  authorizing: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function ConnectWalletButton({
  connected,
  address,
  authorizing,
  onConnect,
  onDisconnect,
}: Props) {
  if (authorizing) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color="#14f195" size="small" />
        <Text style={styles.connectingText}>Connecting wallet...</Text>
      </View>
    );
  }

  if (connected && address) {
    const shortAddr = `${address.slice(0, 4)}...${address.slice(-4)}`;
    return (
      <TouchableOpacity
        style={[styles.button, styles.connectedButton]}
        onPress={onDisconnect}
      >
        <View style={styles.dot} />
        <Text style={styles.addressText}>{shortAddr}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.button, styles.connectButton]}
      onPress={onConnect}
    >
      <Text style={styles.connectText}>Connect Wallet</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  connectButton: {
    backgroundColor: "#9945ff",
  },
  connectedButton: {
    backgroundColor: "#1a1a2e",
    borderWidth: 1,
    borderColor: "#14f195",
  },
  connectText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 14,
  },
  connectingText: {
    color: "#888",
    fontSize: 14,
  },
  addressText: {
    color: "#14f195",
    fontWeight: "600",
    fontSize: 14,
    fontFamily: "monospace",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#14f195",
    marginRight: 8,
  },
});
