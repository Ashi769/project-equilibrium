import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-col flex-1 items-center justify-center min-h-screen bg-gradient-to-br from-violet-50 via-white to-indigo-50 px-4">
      <div className="max-w-2xl w-full text-center space-y-8">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full bg-violet-100 px-4 py-1.5 text-sm font-medium text-violet-700">
            ⚖️ Project Equilibrium
          </div>
          <h1 className="text-5xl font-bold tracking-tight text-zinc-900">
            Find someone who{" "}
            <span className="text-violet-600">actually fits</span>
          </h1>
          <p className="text-xl text-zinc-500 max-w-lg mx-auto">
            No swiping. No superficiality. A 30-minute AI interview builds your psychometric
            profile — then we find your real match.
          </p>
        </div>

        <div className="flex items-center justify-center gap-4">
          <Link href="/register">
            <Button size="lg">Get Started</Button>
          </Link>
          <Link href="/login">
            <Button size="lg" variant="outline">
              Sign In
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-3 gap-6 pt-8 text-sm text-zinc-500">
          <div className="flex flex-col items-center gap-2">
            <div className="text-2xl">🧠</div>
            <div className="font-medium text-zinc-700">OCEAN Profiling</div>
            <div>Big Five personality traits extracted from natural conversation</div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="text-2xl">🔒</div>
            <div className="font-medium text-zinc-700">Private by Design</div>
            <div>Encrypted transcripts, anonymized AI analysis</div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="text-2xl">⚡</div>
            <div className="font-medium text-zinc-700">Vector Matching</div>
            <div>Cosine similarity between who you are and who they want</div>
          </div>
        </div>
      </div>
    </main>
  );
}
