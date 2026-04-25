import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    accessToken: string;
    userId: string;
    gender: string | null;
  }
  interface User {
    accessToken?: string;
    refreshToken?: string;
    gender?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    userId?: string;
    accessTokenExpires?: number;
    gender?: string | null;
  }
}
