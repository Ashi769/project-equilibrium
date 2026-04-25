"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { api } from "@/lib/api";

interface MeetingResponse {
  id: string;
  status: string;
  proposer_id: string;
  match_id: string;
}

const BASE_LINKS = [
  { href: "/selection", label: "Selection" },
  { href: "/meetings",  label: "Meetings"  },
  { href: "/profile",   label: "Profile"   },
];

export function NavLinks() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const token  = session?.accessToken as string | undefined;
  const userId = session?.userId    as string | undefined;

  const links = session?.gender === "woman"
    ? [...BASE_LINKS, { href: "/invitations", label: "Invitations" }]
    : BASE_LINKS;

  const { data: meetings } = useQuery({
    queryKey: ["meetings-nav"],
    queryFn: () => api.get<MeetingResponse[]>("/api/v1/schedule", token!),
    enabled: !!token,
    refetchInterval: 30000,
  });

  const pendingCount =
    meetings?.filter((m) => m.status === "proposed" && m.match_id === userId).length ?? 0;

  return (
    <nav className="flex items-center gap-7">
      {links.map(({ href, label }: { href: string; label: string }) => {
        const active    = pathname.startsWith(href);
        const showBadge = href === "/meetings" && pendingCount > 0;
        return (
          <Link
            key={href}
            href={href}
            className="relative font-heading text-base font-bold transition-colors duration-75"
            style={{ color: active ? "#2d5da1" : "var(--ink)" }}
          >
            {label}
            {active && (
              <span
                className="absolute -bottom-1 left-0 w-full h-0.5"
                style={{ background: "#2d5da1", borderRadius: "2px" }}
              />
            )}
            {showBadge && (
              <span
                className="absolute -top-2.5 -right-3.5 w-5 h-5 flex items-center justify-center text-xs font-bold text-white border-2 border-[#2d2d2d]"
                style={{ background: "var(--accent)", borderRadius: "50%" }}
              >
                {pendingCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
