interface ScoreCardProps {
  label: string;
  score: number;
}

export default function ScoreCard({ label, score }: ScoreCardProps) {
  const percentage = (score / 10) * 100;
  const color =
    score >= 8 ? "from-green-400 to-emerald-500" :
    score >= 6 ? "from-[#4facfe] to-[#00f2fe]" :
    score >= 4 ? "from-amber-400 to-orange-500" :
    "from-red-400 to-red-500";

  return (
    <div className="bg-white/20 backdrop-blur-xl border border-white/40 rounded-2xl p-5 shadow-[0_8px_32px_rgba(0,0,0,0.08)]">
      <div className="flex justify-between items-center mb-3">
        <span className="text-white font-medium text-sm capitalize [text-shadow:0_1px_2px_rgba(0,0,0,0.2)]">
          {label.replace(/_/g, " ")}
        </span>
        <span className="text-white font-bold text-lg [text-shadow:0_1px_2px_rgba(0,0,0,0.2)]">
          {score}/10
        </span>
      </div>
      <div className="w-full h-2.5 bg-white/20 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${color} transition-all duration-700`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
