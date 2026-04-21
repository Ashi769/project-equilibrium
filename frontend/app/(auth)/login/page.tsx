"use client";

import { useState, useEffect } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Required"),
});
type F = z.infer<typeof schema>;

export default function LoginPage() {
  const { status } = useSession();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<F>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/selection");
    }
  }, [status, router]);

  if (status === "loading") {
    return null;
  }

  async function onSubmit(data: F) {
    setLoading(true); setError(null);
    const res = await signIn("credentials", { ...data, redirect: false });
    setLoading(false);
    if (res?.error) setError("Credentials not recognised.");
    else router.push("/selection");
  }

  return (
    <div className="w-full max-w-sm mx-auto px-4 space-y-6 md:space-y-8">
      {/* Brand mark */}
      <div className="text-center space-y-3">
        <div
          className="w-14 h-14 mx-auto flex items-center justify-center border-2 border-[#2d2d2d]"
          style={{
            borderRadius: "50%",
            background: "var(--postit)",
            boxShadow: "var(--shadow-hard-sm)",
          }}
        >
          <span className="font-heading text-2xl font-bold">⚖</span>
        </div>
        <h1 className="font-heading text-4xl font-bold" style={{ color: "var(--ink)" }}>Sign In</h1>
        <p className="text-base" style={{ color: "var(--muted)" }}>Access your Equilibrium account</p>
      </div>

      {/* Form card */}
      <div
        className="p-5 md:p-7 space-y-4 md:space-y-5 bg-white border-2 border-[#2d2d2d] -rotate-[0.5deg]"
        style={{ borderRadius: "var(--radius-wobbly-alt)", boxShadow: "var(--shadow-hard)" }}
      >
        {/* Google */}
        <button
          onClick={() => signIn("google", { callbackUrl: "/selection" })}
          className="w-full h-12 flex items-center justify-center gap-3 text-base font-medium border-2 border-[#2d2d2d] bg-[#e5e0d8] transition-all duration-75 hover:bg-[#2d5da1] hover:text-white hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
          style={{ borderRadius: "var(--radius-wobbly-btn)", boxShadow: "var(--shadow-hard-sm)" }}
        >
          <GoogleIcon />
          Continue with Google
        </button>

        <div className="flex items-center gap-4">
          <div className="flex-1 border-t-2 border-dashed border-[#e5e0d8]" />
          <span className="text-sm font-medium" style={{ color: "var(--dim)" }}>or</span>
          <div className="flex-1 border-t-2 border-dashed border-[#e5e0d8]" />
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium block" style={{ color: "var(--ink)" }}>Email</label>
            <Input type="email" placeholder="you@example.com" {...register("email")} />
            {errors.email && <p className="text-sm" style={{ color: "var(--accent)" }}>{errors.email.message}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium block" style={{ color: "var(--ink)" }}>Password</label>
            <Input type="password" placeholder="••••••••" {...register("password")} />
            {errors.password && <p className="text-sm" style={{ color: "var(--accent)" }}>{errors.password.message}</p>}
          </div>
          {error && (
            <div
              className="py-3 px-4 border-2 border-[#ff4d4d] text-sm text-center"
              style={{ borderRadius: "var(--radius-wobbly-sm)", background: "rgba(255,77,77,0.05)", color: "#ff4d4d" }}
            >
              {error}
            </div>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in…" : "Sign In"}
          </Button>
        </form>
      </div>

      <p className="text-center text-base" style={{ color: "var(--muted)" }}>
        No account?{" "}
        <Link href="/register" className="font-medium underline" style={{ color: "#2d5da1" }}>
          Apply here
        </Link>
      </p>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}
