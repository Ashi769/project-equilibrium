import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PhotoUpload } from "@/components/onboarding/PhotoUpload";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ retake?: string }>;
}) {
  const session = await auth();
  if (!session?.accessToken) redirect("/login");
  const params = await searchParams;
  const isRetake = params.retake === "true";

  const [photosRes, profileRes] = await Promise.all([
    fetch(`${API_URL}/api/v1/photos/status`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      cache: "no-store",
    }),
    fetch(`${API_URL}/api/v1/profile/analysis-status`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      cache: "no-store",
    }),
  ]);

  if (!isRetake && profileRes.ok) {
    const profile = await profileRes.json();
    const s = profile.analysis_status;
    if (s === "processing" || s === "complete") {
      redirect("/selection");
    }
  }

  if (photosRes.ok) {
    const status = await photosRes.json();
    if (status.ready) redirect(isRetake ? "/onboarding/interview?retake=true" : "/onboarding/interview");
  }

  return (
    <div className="py-4">
      <PhotoUpload accessToken={session.accessToken} />
    </div>
  );
}
