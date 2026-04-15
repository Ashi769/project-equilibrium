import { InterviewChat } from "@/components/interview/InterviewChat";

export default function OnboardingPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-zinc-900">Your Interview</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Answer naturally — there are no right or wrong answers. This usually takes 20-30 minutes.
        </p>
      </div>
      <div className="bg-white rounded-xl border border-zinc-200 p-4 shadow-sm">
        <InterviewChat />
      </div>
    </div>
  );
}
