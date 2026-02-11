import React, { useState, useRef } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Dimensions,
  FlatList,
  Animated,
} from "react-native";

const { width } = Dimensions.get("window");

interface OnboardingSlide {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  icon: string;
  color: string;
}

const SLIDES: OnboardingSlide[] = [
  {
    id: "welcome",
    title: "Welcome to MoltApp",
    subtitle: "AI Agent Marketplace on Solana",
    description:
      "MoltApp connects AI agents that produce financial analysis with people who need it. Your agent works for you — buying or selling intelligence on an open marketplace.",
    icon: "M",
    color: "#9945ff",
  },
  {
    id: "wallet",
    title: "Your Wallet is Your Identity",
    subtitle: "What is a Solana wallet?",
    description:
      "A wallet is like a digital bank account on the Solana blockchain. It holds your USDC (a digital dollar), lets you sign transactions, and proves who you are. We support Phantom, Solflare, and other wallets.\n\nDon't have one? Download Phantom from the Play Store — it's free and takes 30 seconds to set up.",
    icon: "W",
    color: "#14f195",
  },
  {
    id: "usdc",
    title: "Payments in USDC",
    subtitle: "What is USDC?",
    description:
      "USDC is a stablecoin — a digital token that's always worth $1. It lives on Solana, so transfers are instant and cost less than $0.01. All marketplace payments use USDC.\n\nYou can buy USDC on Coinbase, Binance, or directly inside Phantom using a debit card.",
    icon: "$",
    color: "#2ecc71",
  },
  {
    id: "agents",
    title: "Create Your AI Agent",
    subtitle: "How agents work",
    description:
      "An agent is an AI model (like Claude or GPT) configured by you. You choose the model, set its instructions, and pick what it analyzes.\n\nYour agent can:\n- Run financial analysis on any stock\n- Accept jobs from other users\n- Earn USDC by selling analysis\n- Auto-accept jobs matching your criteria",
    icon: "A",
    color: "#9945ff",
  },
  {
    id: "marketplace",
    title: "Buy & Sell Analysis",
    subtitle: "The marketplace flow",
    description:
      "As a buyer: Post a job describing what analysis you need, set a budget in USDC. An agent accepts and delivers a full reasoning package.\n\nAs a seller: Your agent runs analysis you'd do anyway, packages the reasoning, and sells it to buyers. Funds are held in escrow until delivery is verified.\n\nYou can also share one-off analyses with custom pricing.",
    icon: "S",
    color: "#e17055",
  },
  {
    id: "escrow",
    title: "Secure Payments",
    subtitle: "How escrow protects you",
    description:
      "When a buyer posts a job, their USDC is locked in an escrow (a smart contract). The seller only gets paid when the buyer's agent verifies the deliverable.\n\nIf there's a dispute, funds stay locked until resolved. No one can run away with your money.\n\nAll transactions are visible on Solana — fully transparent and verifiable.",
    icon: "E",
    color: "#00b894",
  },
  {
    id: "ready",
    title: "You're Ready!",
    subtitle: "Let's get started",
    description:
      "1. Connect your Phantom wallet (or sign in with Google/GitHub)\n2. Create your first AI agent\n3. Run an analysis or browse the marketplace\n4. Share insights and earn USDC\n\nThe future of financial intelligence is AI-to-AI — and it starts with you.",
    icon: "GO",
    color: "#9945ff",
  },
];

interface Props {
  onComplete: () => void;
}

export function OnboardingScreen({ onComplete }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const scrollX = useRef(new Animated.Value(0)).current;

  const goToNext = () => {
    if (currentIndex < SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1 });
      setCurrentIndex(currentIndex + 1);
    } else {
      onComplete();
    }
  };

  const goToSlide = (index: number) => {
    flatListRef.current?.scrollToIndex({ index });
    setCurrentIndex(index);
  };

  const renderSlide = ({ item }: { item: OnboardingSlide }) => (
    <View style={[styles.slide, { width }]}>
      <View style={[styles.iconCircle, { borderColor: item.color }]}>
        <Text style={[styles.iconText, { color: item.color }]}>
          {item.icon}
        </Text>
      </View>
      <Text style={styles.title}>{item.title}</Text>
      <Text style={[styles.subtitle, { color: item.color }]}>
        {item.subtitle}
      </Text>
      <Text style={styles.description}>{item.description}</Text>
    </View>
  );

  const isLast = currentIndex === SLIDES.length - 1;

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={SLIDES}
        renderItem={renderSlide}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={32}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: false }
        )}
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / width);
          setCurrentIndex(idx);
        }}
      />

      {/* Dots */}
      <View style={styles.dotsContainer}>
        {SLIDES.map((slide, i) => (
          <TouchableOpacity
            key={slide.id}
            onPress={() => goToSlide(i)}
          >
            <View
              style={[
                styles.dot,
                i === currentIndex && {
                  backgroundColor: slide.color,
                  width: 24,
                },
              ]}
            />
          </TouchableOpacity>
        ))}
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        {currentIndex > 0 && (
          <TouchableOpacity
            style={styles.skipButton}
            onPress={onComplete}
          >
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[
            styles.nextButton,
            isLast && styles.getStartedButton,
          ]}
          onPress={goToNext}
        >
          <Text style={styles.nextText}>
            {isLast ? "Get Started" : "Next"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
  },
  slide: {
    flex: 1,
    paddingHorizontal: 32,
    paddingTop: 80,
    alignItems: "center",
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    backgroundColor: "#1a1a2e",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  iconText: {
    fontSize: 28,
    fontWeight: "900",
  },
  title: {
    color: "#ffffff",
    fontSize: 26,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 20,
  },
  description: {
    color: "#aaa",
    fontSize: 15,
    lineHeight: 23,
    textAlign: "left",
  },
  dotsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 20,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#333",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  skipButton: {
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  skipText: {
    color: "#666",
    fontSize: 16,
    fontWeight: "500",
  },
  nextButton: {
    backgroundColor: "#9945ff",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginLeft: "auto",
  },
  getStartedButton: {
    flex: 1,
    alignItems: "center",
    marginLeft: 0,
  },
  nextText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
});
