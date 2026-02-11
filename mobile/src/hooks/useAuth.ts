import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import * as SecureStore from "expo-secure-store";
import { API_BASE_URL, API_ENDPOINTS, GOOGLE_CLIENT_ID, GITHUB_CLIENT_ID } from "../utils/constants";
import type { AuthState, UserProfile, AuthProvider } from "../types";

WebBrowser.maybeCompleteAuthSession();

const TOKEN_KEY = "moltapp_auth_token";
const USER_KEY = "moltapp_user_profile";

interface AuthContextValue extends AuthState {
  loginWithGoogle: () => Promise<void>;
  loginWithGitHub: () => Promise<void>;
  loginWithWallet: (walletAddress: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}

// Google OAuth discovery
const googleDiscovery = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  revocationEndpoint: "https://oauth2.googleapis.com/revoke",
};

// GitHub OAuth discovery
const githubDiscovery = {
  authorizationEndpoint: "https://github.com/login/oauth/authorize",
  tokenEndpoint: "https://github.com/login/oauth/access_token",
  revocationEndpoint: `https://api.github.com/applications/${GITHUB_CLIENT_ID}/grant`,
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>({
    authenticated: false,
    user: null,
    token: null,
    loading: true,
  });

  // Restore session on mount
  useEffect(() => {
    (async () => {
      try {
        const token = await SecureStore.getItemAsync(TOKEN_KEY);
        const userJson = await SecureStore.getItemAsync(USER_KEY);
        if (token && userJson) {
          setAuthState({
            authenticated: true,
            user: JSON.parse(userJson),
            token,
            loading: false,
          });
          return;
        }
      } catch {}
      setAuthState((s) => ({ ...s, loading: false }));
    })();
  }, []);

  const persistSession = useCallback(
    async (user: UserProfile, token: string) => {
      await SecureStore.setItemAsync(TOKEN_KEY, token);
      await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
      setAuthState({ authenticated: true, user, token, loading: false });
    },
    []
  );

  // Exchange provider token with our backend to get a MoltApp session
  const exchangeToken = useCallback(
    async (provider: AuthProvider, providerToken: string) => {
      const res = await fetch(`${API_BASE_URL}${API_ENDPOINTS.auth}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, providerToken }),
      });
      if (!res.ok) throw new Error("Auth exchange failed");
      const data = await res.json();
      await persistSession(data.user, data.token);
    },
    [persistSession]
  );

  const loginWithGoogle = useCallback(async () => {
    const redirectUri = AuthSession.makeRedirectUri({ scheme: "moltapp" });
    const request = new AuthSession.AuthRequest({
      clientId: GOOGLE_CLIENT_ID,
      scopes: ["openid", "profile", "email"],
      redirectUri,
    });
    const result = await request.promptAsync(googleDiscovery);
    if (result.type === "success" && result.authentication?.accessToken) {
      await exchangeToken("google", result.authentication.accessToken);
    }
  }, [exchangeToken]);

  const loginWithGitHub = useCallback(async () => {
    const redirectUri = AuthSession.makeRedirectUri({ scheme: "moltapp" });
    const request = new AuthSession.AuthRequest({
      clientId: GITHUB_CLIENT_ID,
      scopes: ["read:user", "user:email"],
      redirectUri,
    });
    const result = await request.promptAsync(githubDiscovery);
    if (result.type === "success" && result.params?.code) {
      await exchangeToken("github", result.params.code);
    }
  }, [exchangeToken]);

  const loginWithWallet = useCallback(
    async (walletAddress: string) => {
      // Wallet-based auth: just register/login with the wallet address
      const res = await fetch(`${API_BASE_URL}${API_ENDPOINTS.auth}/wallet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress }),
      });
      if (!res.ok) throw new Error("Wallet auth failed");
      const data = await res.json();
      await persistSession(data.user, data.token);
    },
    [persistSession]
  );

  const logout = useCallback(async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
    setAuthState({
      authenticated: false,
      user: null,
      token: null,
      loading: false,
    });
  }, []);

  const updateProfile = useCallback((updates: Partial<UserProfile>) => {
    setAuthState((prev) => ({
      ...prev,
      user: prev.user ? { ...prev.user, ...updates } : null,
    }));
  }, []);

  return (
    <AuthContext.Provider
      value={{
        ...authState,
        loginWithGoogle,
        loginWithGitHub,
        loginWithWallet,
        logout,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
