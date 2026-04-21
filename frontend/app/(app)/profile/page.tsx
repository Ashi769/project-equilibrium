import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ProfileForm } from "@/components/profile/ProfileForm";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default async function ProfilePage() {
  const session = await auth();
  // DEBUG ProfilePage:", { hasSession: !!session, hasAccessToken: !!session?.accessToken, userId: session?.userId });

  if (!session?.accessToken) {
    // DEBUG ProfilePage: Redirecting to /login (no access token)");
    redirect("/login");
  }

  const [profileRes, photosRes] = await Promise.all([
    fetch(`${API_URL}/api/v1/profile`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      cache: "no-store",
    }),
    fetch(`${API_URL}/api/v1/photos`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      cache: "no-store",
    }),
  ]);

  if (!profileRes.ok) {
    return (
      <div className="text-center py-20 text-zinc-500">
        <p>Unable to load profile. Please <a href="/login" className="text-violet-600 underline">sign in again</a>.</p>
      </div>
    );
  }

  const profile = await profileRes.json();
  const photos = photosRes.ok ? await photosRes.json() : [];

  return <ProfileForm accessToken={session.accessToken} initialProfile={profile} initialPhotos={photos} />;
}
