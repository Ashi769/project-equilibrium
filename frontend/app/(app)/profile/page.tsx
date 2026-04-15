"use client";

import { useSession, signOut } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

interface UserProfile {
  id: string;
  name: string;
  email: string;
  age: number;
  gender: string;
  analysis_status: "pending" | "processing" | "complete" | null;
  hard_filters: {
    wants_children?: boolean | null;
    max_age_diff?: number;
    seeking_gender?: string[];
  };
}

const hardFiltersSchema = z.object({
  wants_children: z.enum(["yes", "no", "open"]),
  max_age_diff: z.number().int().min(1).max(30),
  seeking_gender: z.string(),
});

type HardFiltersForm = z.infer<typeof hardFiltersSchema>;

export default function ProfilePage() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: () => api.get<UserProfile>("/api/v1/profile", session?.accessToken),
    enabled: !!session?.accessToken,
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<UserProfile["hard_filters"]>) =>
      api.patch("/api/v1/profile", { hard_filters: data }, session?.accessToken),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profile"] }),
  });

  const reinterviewMutation = useMutation({
    mutationFn: () => api.post("/api/v1/interview/reset", {}, session?.accessToken),
  });

  const { register, handleSubmit } = useForm<HardFiltersForm>({
    resolver: zodResolver(hardFiltersSchema),
    defaultValues: {
      wants_children: "open",
      max_age_diff: 10,
      seeking_gender: "any",
    },
  });

  if (isLoading || !profile) {
    return <div className="h-64 rounded-xl bg-zinc-100 animate-pulse" />;
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Your Profile</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-500">Name</span>
            <span className="font-medium">{profile.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Email</span>
            <span className="font-medium">{profile.email}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Age</span>
            <span className="font-medium">{profile.age}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Psychometric Profile</span>
            <Badge
              variant={
                profile.analysis_status === "complete"
                  ? "success"
                  : profile.analysis_status === "processing"
                  ? "secondary"
                  : "outline"
              }
            >
              {profile.analysis_status ?? "Not started"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Deal-Breakers</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit((data) =>
              updateMutation.mutate({
                wants_children: data.wants_children === "yes" ? true : data.wants_children === "no" ? false : null,
                max_age_diff: data.max_age_diff,
                seeking_gender: data.seeking_gender === "any" ? [] : [data.seeking_gender],
              }),
            )}
            className="space-y-4"
          >
            <div className="space-y-1">
              <label className="text-sm font-medium text-zinc-700">Wants Children</label>
              <select
                className="flex h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                {...register("wants_children")}
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="open">Open to it</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-zinc-700">Max Age Difference</label>
              <Input type="number" {...register("max_age_diff", { valueAsNumber: true })} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-zinc-700">Seeking</label>
              <select
                className="flex h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                {...register("seeking_gender")}
              >
                <option value="any">Anyone</option>
                <option value="man">Men</option>
                <option value="woman">Women</option>
                <option value="non-binary">Non-binary people</option>
              </select>
            </div>
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving…" : "Save Preferences"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Re-interview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-zinc-500">
            Retake the interview to refresh your psychometric profile. Recommended every 6-12 months.
          </p>
          <Link href="/onboarding">
            <Button
              variant="outline"
              onClick={() => reinterviewMutation.mutate()}
              disabled={reinterviewMutation.isPending}
            >
              Start New Interview
            </Button>
          </Link>
        </CardContent>
      </Card>

      <div className="pt-2">
        <Button
          variant="ghost"
          className="text-red-500 hover:text-red-600 hover:bg-red-50"
          onClick={() => signOut({ callbackUrl: "/" })}
        >
          Sign Out
        </Button>
      </div>
    </div>
  );
}
