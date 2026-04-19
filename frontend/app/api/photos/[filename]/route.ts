import { auth } from "@/lib/auth";
import type { NextRequest } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/photos/[filename]">,
) {
  const { filename } = await ctx.params;

  const session = await auth();
  if (!session?.accessToken) {
    return new Response("Unauthorized", { status: 401 });
  }

  const upstream = await fetch(`${API_URL}/api/v1/photos/${filename}`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });

  if (!upstream.ok) {
    return new Response("Not found", { status: upstream.status });
  }

  const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
  const buffer = await upstream.arrayBuffer();

  return new Response(buffer, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
