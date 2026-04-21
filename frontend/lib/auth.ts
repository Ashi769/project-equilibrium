import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const AUTH_URL = process.env.AUTH_URL;
console.log("[DEBUG] API_URL:", API_URL, "AUTH_URL:", AUTH_URL);

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

type BackendTokens = {
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string; name: string };
};

async function getBackendTokens(
  provider: "google" | "credentials" | "refresh",
  payload: Record<string, string>,
): Promise<BackendTokens | null> {
  const endpoint =
    provider === "google"
      ? "/api/v1/auth/google"
      : provider === "refresh"
        ? "/api/v1/auth/refresh"
        : "/api/v1/auth/login";
  console.log("[DEBUG] getBackendTokens:", { provider, endpoint, hasPayload: !!Object.keys(payload).length });
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  console.log("[DEBUG] getBackendTokens response:", { status: res.status, ok: res.ok });
  if (!res.ok) {
    const error = await res.text();
    console.log("[DEBUG] getBackendTokens error:", error);
    return null;
  }
  const data = await res.json();
  console.log("[DEBUG] getBackendTokens success:", { hasAccessToken: !!data.access_token, hasRefreshToken: !!data.refresh_token });
  return data;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      authorization: {
        params: { prompt: "consent", access_type: "offline", response_type: "code" },
      },
    }),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const data = await getBackendTokens("credentials", parsed.data);
        if (!data) return null;

        return {
          id: data.user.id,
          email: data.user.email,
          name: data.user.name,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      console.log("[DEBUG] signIn callback:", { user: !!user, account: !!account, provider: account?.provider });
      if (account?.provider === "google" && account.id_token) {
        const data = await getBackendTokens("google", { id_token: account.id_token });
        if (data) {
          console.log("[DEBUG] Google signin successful, storing tokens");
          (user as any).accessToken = data.access_token;
          (user as any).refreshToken = data.refresh_token;
          (user as any).userId = data.user.id;
        }
      }
      return true;
    },
    async jwt({ token, user, account }) {
      console.log("[DEBUG] jwt callback:", { user: !!user, account: !!account, provider: account?.provider, idToken: !!account?.id_token });
      if (account) {
        console.log("[DEBUG] account details:", { provider: account.provider, idToken: !!account.id_token, accessToken: !!account.access_token });
      }

      // Initial sign-in with credentials
      if (user && (user as any).accessToken) {
        token.accessToken = (user as any).accessToken;
        token.refreshToken = (user as any).refreshToken;
        token.userId = user.id;
        token.accessTokenExpires = Date.now() + 14 * 60 * 1000; // 14 min
        return token;
      }

      // Initial sign-in with Google
      if (account?.provider === "google" && account.id_token) {
        const data = await getBackendTokens("google", { id_token: account.id_token });
        if (data) {
          token.accessToken = data.access_token;
          token.refreshToken = data.refresh_token;
          token.userId = data.user.id;
          token.accessTokenExpires = Date.now() + 14 * 60 * 1000;
        }
        return token;
      }

      // Token still valid — return as-is
      if (Date.now() < (token.accessTokenExpires as number ?? 0)) {
        return token;
      }

      // Access token expired — try to refresh
      if (!token.refreshToken) return token;

      const data = await getBackendTokens("refresh", {
        refresh_token: token.refreshToken as string,
      });

      if (data) {
        token.accessToken = data.access_token;
        token.refreshToken = data.refresh_token;
        token.accessTokenExpires = Date.now() + 14 * 60 * 1000;
      } else {
        // Refresh failed — clear tokens so pages can redirect to login
        token.accessToken = undefined;
        token.refreshToken = undefined;
      }

      return token;
    },

    async session({ session, token }) {
      console.log("[DEBUG] session callback:", {
        hasToken: !!token,
        hasAccessToken: !!token.accessToken,
        hasRefreshToken: !!token.refreshToken,
        hasUserId: !!token.userId,
        accessTokenExpires: token.accessTokenExpires,
        currentTime: Date.now(),
      });
      session.accessToken = (token.accessToken as string) ?? "";
      session.userId = (token.userId as string) ?? "";
      console.log("[DEBUG] session callback - set session:", { accessToken: !!session.accessToken, userId: session.userId });
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});
