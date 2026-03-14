import ScoreCard from "./ScoreCard";

interface ScoreGridProps {
  scores: Record<string, number>;
}

export default function ScoreGrid({ scores }: ScoreGridProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Object.entries(scores).map(([label, score]) => (
        <ScoreCard key={label} label={label} score={score} />
      ))}
    </div>
  );
}
