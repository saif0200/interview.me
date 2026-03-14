import { motion } from "motion/react";

type InterviewStatus = "initializing" | "ai_speaking" | "listening" | "processing" | "ended";

interface StatusIndicatorProps {
  status: InterviewStatus;
}

const statusConfig: Record<InterviewStatus, { label: string; color: string }> = {
  initializing: { label: "Setting up your interview...", color: "text-white/60" },
  ai_speaking: { label: "Interviewer is speaking", color: "text-[#4facfe]" },
  listening: { label: "Listening...", color: "text-green-400" },
  processing: { label: "Thinking...", color: "text-amber-400" },
  ended: { label: "Interview complete", color: "text-white/80" },
};

export default function StatusIndicator({ status }: StatusIndicatorProps) {
  const { label, color } = statusConfig[status];

  return (
    <div className={`flex items-center gap-2 text-sm font-medium ${color}`}>
      {status !== "ended" && status !== "initializing" && (
        <motion.span
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="inline-block w-2 h-2 rounded-full bg-current"
        />
      )}
      <span>{label}</span>
    </div>
  );
}

export type { InterviewStatus };
