import { Mic, MicOff } from "lucide-react";
import { motion } from "motion/react";

interface MicButtonProps {
  isListening: boolean;
  onClick: () => void;
  disabled?: boolean;
}

export default function MicButton({ isListening, onClick, disabled }: MicButtonProps) {
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileTap={{ scale: 0.93 }}
      className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300
        ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}
        ${isListening
          ? "bg-red-500 shadow-[0_0_40px_rgba(239,68,68,0.5)]"
          : "bg-white/20 backdrop-blur-xl border border-white/40 shadow-[0_8px_32px_rgba(0,0,0,0.1)] hover:bg-white/30"
        }`}
    >
      {/* Pulse rings when listening */}
      {isListening && (
        <>
          <motion.div
            animate={{ scale: [1, 1.8], opacity: [0.4, 0] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="absolute inset-0 rounded-full bg-red-400"
          />
          <motion.div
            animate={{ scale: [1, 2.2], opacity: [0.2, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: 0.3 }}
            className="absolute inset-0 rounded-full bg-red-400"
          />
        </>
      )}

      <div className="relative z-10">
        {isListening ? (
          <MicOff className="w-8 h-8 text-white" />
        ) : (
          <Mic className="w-8 h-8 text-white drop-shadow-md" />
        )}
      </div>
    </motion.button>
  );
}
