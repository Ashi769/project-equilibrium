import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { NavLinks } from "@/components/layout/NavLinks";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--paper)" }}>
      <header
        className="sticky top-0 z-20 border-b-2 border-[#2d2d2d]"
        style={{ background: "var(--paper)" }}
      >
        <div className="max-w-full md:max-w-5xl mx-auto px-4 md:px-8 h-12 md:h-14 flex items-center justify-between">
          <Link href="/selection" className="flex items-center gap-2 group">
            <span className="font-heading text-xl md:text-2xl font-bold" style={{ color: "var(--ink)" }}>⚖</span>
            <span
              className="font-heading text-sm md:text-lg font-bold tracking-widest hidden sm:block"
              style={{ color: "var(--ink)", letterSpacing: "0.18em" }}
            >
              EQUILIBRIUM
            </span>
          </Link>
          <NavLinks />
        </div>
      </header>
      <main className="flex-1 max-w-full md:max-w-5xl w-full mx-auto px-4 md:px-8 py-6 md:py-8">
        {children}
      </main>
    </div>
  );
}
