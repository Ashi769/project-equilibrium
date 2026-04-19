import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { MatchesClient } from "@/components/matches/MatchesClient";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default async function MatchesPage() {
  const session = await auth();
  if (!session?.accessToken) redirect("/login");

  const res = await fetch(`${API_URL}/api/v1/profile/analysis-status`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: "no-store",
  });

  const initialStatus = res.ok ? await res.json() : { analysis_status: null };

  return (
    <Suspense>
      <MatchesClient accessToken={session.accessToken} initialStatus={initialStatus} />
    </Suspense>
  );
}
