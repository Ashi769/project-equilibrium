import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SelectionClient } from "@/components/selection/SelectionClient";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default async function SelectionPage() {
  const session = await auth();
  if (!session?.accessToken) redirect("/login");

  const [statusRes, matchesRes] = await Promise.all([
    fetch(`${API_URL}/api/v1/profile/analysis-status`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      cache: "no-store",
    }),
    fetch(`${API_URL}/api/v1/matches`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      cache: "no-store",
    }),
  ]);

  const status = statusRes.ok ? await statusRes.json() : { analysis_status: null };
  const matches = matchesRes.ok ? await matchesRes.json() : [];

  return (
    <Suspense>
      <SelectionClient
        accessToken={session.accessToken}
        initialStatus={status}
        initialMatches={matches}
      />
    </Suspense>
  );
}
