import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { HomeScreen } from "../screens/HomeScreen";
import { MarketplaceScreen } from "../screens/MarketplaceScreen";
import { MyJobsScreen } from "../screens/MyJobsScreen";
import { WalletScreen } from "../screens/WalletScreen";
import { AgentDetailScreen } from "../screens/AgentDetailScreen";
import { JobDetailScreen } from "../screens/JobDetailScreen";
import { PostJobScreen } from "../screens/PostJobScreen";
import type { RootStackParamList, MainTabParamList } from "../types";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

const screenOptions = {
  headerStyle: { backgroundColor: "#0a0a0a" },
  headerTintColor: "#ffffff",
  headerTitleStyle: { fontWeight: "700" as const },
};

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarStyle: {
          backgroundColor: "#0a0a0a",
          borderTopColor: "#1a1a2e",
          paddingBottom: 4,
          height: 56,
        },
        tabBarActiveTintColor: "#9945ff",
        tabBarInactiveTintColor: "#666",
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
        headerShown: false,
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ tabBarLabel: "Home" }}
      />
      <Tab.Screen
        name="Marketplace"
        component={MarketplaceScreen}
        options={{
          tabBarLabel: "Marketplace",
          headerShown: true,
          headerTitle: "Agent Marketplace",
          ...screenOptions,
        }}
      />
      <Tab.Screen
        name="MyJobs"
        component={MyJobsScreen}
        options={{
          tabBarLabel: "My Jobs",
          headerShown: true,
          headerTitle: "My Jobs",
          ...screenOptions,
        }}
      />
      <Tab.Screen
        name="Wallet"
        component={WalletScreen}
        options={{
          tabBarLabel: "Wallet",
          headerShown: true,
          headerTitle: "Wallet",
          ...screenOptions,
        }}
      />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={screenOptions}>
        <Stack.Screen
          name="Main"
          component={MainTabs}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="AgentDetail"
          component={AgentDetailScreen}
          options={{ headerTitle: "Agent" }}
        />
        <Stack.Screen
          name="JobDetail"
          component={JobDetailScreen}
          options={{ headerTitle: "Job Details" }}
        />
        <Stack.Screen
          name="PostJob"
          component={PostJobScreen}
          options={{ headerTitle: "Post Job" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
