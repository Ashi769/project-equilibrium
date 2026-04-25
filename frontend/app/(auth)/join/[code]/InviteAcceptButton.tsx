"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function InviteAcceptButton({ code }: { code: string }) {
  const router = useRouter();

  function accept() {
    // Persist invite code for the identity step — survives page refreshes and OAuth redirects
    sessionStorage.setItem("pending_invite", code);
    sessionStorage.setItem("pending_invite_ts", String(Date.now()));
    router.push("/register");
  }

  return (
    <Button className="w-full" onClick={accept}>
      Accept &amp; create account
    </Button>
  );
}
