import React, { useState, useEffect, useCallback } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import * as SecureStore from "expo-secure-store";
import { HomeScreen } from "../screens/HomeScreen";
import { MarketplaceScreen } from "../screens/MarketplaceScreen";
import { MyAgentsScreen } from "../screens/MyAgentsScreen";
import { WalletScreen } from "../screens/WalletScreen";
import { LoginScreen } from "../screens/LoginScreen";
import { OnboardingScreen } from "../screens/OnboardingScreen";
import { AgentDetailScreen } from "../screens/AgentDetailScreen";
import { JobDetailScreen } from "../screens/JobDetailScreen";
import { PostJobScreen } from "../screens/PostJobScreen";
import { CreateAgentScreen } from "../screens/CreateAgentScreen";
import { RunAnalysisScreen } from "../screens/RunAnalysisScreen";
import { ShareAnalysisScreen } from "../screens/ShareAnalysisScreen";
import { BrowseSharedScreen } from "../screens/BrowseSharedScreen";
import { QuestsScreen } from "../screens/QuestsScreen";
import { LeaderboardScreen } from "../screens/LeaderboardScreen";
import { ReferralsScreen } from "../screens/ReferralsScreen";
import type { RootStackParamList, MainTabParamList } from "../types";

const ONBOARDING_KEY = "moltapp_onboarding_complete";

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
        name="MyAgents"
        component={MyAgentsScreen}
        options={{
          tabBarLabel: "My Agents",
          headerShown: true,
          headerTitle: "My Agents",
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
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync(ONBOARDING_KEY).then((val) => {
      setOnboardingDone(val === "true");
    });
  }, []);

  const handleOnboardingComplete = useCallback(async () => {
    await SecureStore.setItemAsync(ONBOARDING_KEY, "true");
    setOnboardingDone(true);
  }, []);

  // Wait for onboarding check before rendering
  if (onboardingDone === null) return null;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={screenOptions}>
        {!onboardingDone && (
          <Stack.Screen
            name="Onboarding"
            options={{ headerShown: false }}
          >
            {() => <OnboardingScreen onComplete={handleOnboardingComplete} />}
          </Stack.Screen>
        )}
        <Stack.Screen
          name="Main"
          component={MainTabs}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ headerTitle: "Sign In", presentation: "modal" }}
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
        <Stack.Screen
          name="CreateAgent"
          component={CreateAgentScreen}
          options={{ headerTitle: "Create Agent" }}
        />
        <Stack.Screen
          name="EditAgent"
          component={CreateAgentScreen}
          options={{ headerTitle: "Edit Agent" }}
        />
        <Stack.Screen
          name="RunAnalysis"
          component={RunAnalysisScreen}
          options={{ headerTitle: "Run Analysis" }}
        />
        <Stack.Screen
          name="ShareAnalysis"
          component={ShareAnalysisScreen}
          options={{ headerTitle: "Share Analysis" }}
        />
        <Stack.Screen
          name="BrowseShared"
          component={BrowseSharedScreen}
          options={{ headerTitle: "Shared Analyses" }}
        />
        <Stack.Screen
          name="Quests"
          component={QuestsScreen}
          options={{ headerTitle: "Quest Board" }}
        />
        <Stack.Screen
          name="Leaderboard"
          component={LeaderboardScreen}
          options={{ headerTitle: "Leaderboard" }}
        />
        <Stack.Screen
          name="Referrals"
          component={ReferralsScreen}
          options={{ headerTitle: "Referrals" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
