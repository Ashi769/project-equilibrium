import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { InterviewChat } from "@/components/interview/InterviewChat";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default async function InterviewPage({
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

  if (photosRes.ok) {
    const status = await photosRes.json();
    if (!status.ready) redirect("/onboarding");
  }

  if (!isRetake && profileRes.ok) {
    const profile = await profileRes.json();
    const s = profile.analysis_status;
    if (s === "processing" || s === "complete") {
      redirect("/selection");
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-5">
        <h1
          style={{
            fontFamily: "Cormorant Garamond, serif",
            fontSize: "1.5rem",
            fontWeight: 400,
            color: "var(--cream)",
          }}
        >
          Your Interview
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
          Answer naturally — there are no right or wrong answers.
        </p>
      </div>

      <div
        className="rounded-2xl px-5 pt-4 pb-5"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      >
        <InterviewChat accessToken={session.accessToken} />
      </div>
    </div>
  );
}
