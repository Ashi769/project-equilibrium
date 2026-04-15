import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50">
      <header className="sticky top-0 z-10 bg-white border-b border-zinc-200">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/matches" className="font-semibold text-violet-600 flex items-center gap-1.5">
            ⚖️ Equilibrium
          </Link>
          <nav className="flex items-center gap-1">
            <Link href="/matches">
              <Button variant="ghost" size="sm">Matches</Button>
            </Link>
            <Link href="/profile">
              <Button variant="ghost" size="sm">Profile</Button>
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  );
}
