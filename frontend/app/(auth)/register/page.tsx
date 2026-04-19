"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

const schema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  age: z.number().int().min(18, "Must be 18 or older").max(100),
  gender: z.enum(["man", "woman", "non-binary", "other"]),
});
type FormData = z.infer<typeof schema>;

const wobblySelect: React.CSSProperties = {
  height: "3rem",
  width: "100%",
  border: "2px solid #2d2d2d",
  background: "#ffffff",
  color: "#2d2d2d",
  padding: "0 0.75rem",
  fontSize: "1rem",
  outline: "none",
  fontFamily: "'Patrick Hand', system-ui, sans-serif",
  borderRadius: "var(--radius-wobbly-sm)",
  boxShadow: "2px 2px 0px 0px #2d2d2d",
  appearance: "auto",
};

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(data: FormData) {
    setIsLoading(true);
    setError(null);
    try {
      await api.post("/api/v1/auth/register", data);
      const result = await signIn("credentials", {
        email: data.email,
        password: data.password,
        redirect: false,
      });
      if (result?.error) throw new Error("Sign-in failed after registration");
      router.push("/onboarding");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm mx-auto space-y-8">
      {/* Brand mark */}
      <div className="text-center space-y-3">
        <div
          className="inline-flex items-center justify-center w-14 h-14 border-2 border-[#2d2d2d] mx-auto"
          style={{ borderRadius: "50%", background: "var(--postit)", boxShadow: "var(--shadow-hard-sm)" }}
        >
          <span className="font-heading text-2xl font-bold">⚖</span>
        </div>
        <div>
          <h1 className="font-heading text-4xl font-bold" style={{ color: "var(--ink)" }}>
            Create account
          </h1>
          <p className="text-base mt-1" style={{ color: "var(--muted)" }}>
            Start your journey to a meaningful match
          </p>
        </div>
      </div>

      {/* Form card */}
      <div
        className="p-7 space-y-5 bg-white border-2 border-[#2d2d2d] rotate-[0.5deg]"
        style={{ borderRadius: "var(--radius-wobbly)", boxShadow: "var(--shadow-hard)" }}
      >
        {/* Google */}
        <button
          onClick={() => signIn("google", { callbackUrl: "/onboarding" })}
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
            <label className="text-sm font-medium block" style={{ color: "var(--ink)" }}>Full name</label>
            <Input placeholder="Alex Johnson" {...register("name")} />
            {errors.name && <p className="text-sm" style={{ color: "var(--accent)" }}>{errors.name.message}</p>}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium block" style={{ color: "var(--ink)" }}>Email</label>
            <Input type="email" placeholder="you@example.com" {...register("email")} />
            {errors.email && <p className="text-sm" style={{ color: "var(--accent)" }}>{errors.email.message}</p>}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium block" style={{ color: "var(--ink)" }}>Password</label>
            <Input type="password" placeholder="8+ characters" {...register("password")} />
            {errors.password && <p className="text-sm" style={{ color: "var(--accent)" }}>{errors.password.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium block" style={{ color: "var(--ink)" }}>Age</label>
              <Input type="number" placeholder="25" {...register("age", { valueAsNumber: true })} />
              {errors.age && <p className="text-sm" style={{ color: "var(--accent)" }}>{errors.age.message}</p>}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium block" style={{ color: "var(--ink)" }}>Gender</label>
              <select style={wobblySelect} {...register("gender")}>
                <option value="man">Man</option>
                <option value="woman">Woman</option>
                <option value="non-binary">Non-binary</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          {error && (
            <div
              className="py-3 px-4 border-2 border-[#ff4d4d] text-sm text-center"
              style={{ borderRadius: "var(--radius-wobbly-sm)", background: "rgba(255,77,77,0.05)", color: "#ff4d4d" }}
            >
              {error}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? "Creating account…" : "Create Account"}
          </Button>
        </form>
      </div>

      <p className="text-center text-base" style={{ color: "var(--muted)" }}>
        Already have an account?{" "}
        <Link href="/login" className="font-medium underline" style={{ color: "#2d5da1" }}>
          Sign in
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
