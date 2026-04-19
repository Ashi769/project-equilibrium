import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();
  return Response.json({
    session,
    hasAccessToken: !!(session as any)?.accessToken,
    userId: (session as any)?.userId,
  });
}
