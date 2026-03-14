import { motion } from "motion/react";

interface InterviewerAvatarProps {
  isSpeaking: boolean;
  isProcessing: boolean;
}

export default function InterviewerAvatar({ isSpeaking, isProcessing }: InterviewerAvatarProps) {
  return (
    <div className="relative flex items-center justify-center">
      {/* Outer glow */}
      <motion.div
        animate={
          isSpeaking
            ? { scale: [1, 1.15, 1], opacity: [0.3, 0.6, 0.3] }
            : isProcessing
              ? { scale: [1, 1.05, 1], opacity: [0.2, 0.4, 0.2] }
              : { scale: 1, opacity: 0.2 }
        }
        transition={{ duration: isSpeaking ? 0.8 : 2, repeat: Infinity, ease: "easeInOut" }}
        className="absolute w-48 h-48 rounded-full bg-gradient-to-br from-[#4facfe] to-[#00f2fe] blur-2xl"
      />

      {/* Main orb */}
      <motion.div
        animate={
          isSpeaking
            ? { scale: [1, 1.08, 1] }
            : isProcessing
              ? { rotate: 360 }
              : { scale: 1 }
        }
        transition={
          isSpeaking
            ? { duration: 0.6, repeat: Infinity, ease: "easeInOut" }
            : isProcessing
              ? { duration: 3, repeat: Infinity, ease: "linear" }
              : {}
        }
        className="relative w-32 h-32 rounded-full bg-gradient-to-br from-[#4facfe] to-[#00f2fe] shadow-[0_8px_40px_rgba(79,172,254,0.4)] border border-white/30 overflow-hidden"
      >
        {/* Glass highlight */}
        <div className="absolute top-0 inset-x-0 h-[55%] bg-gradient-to-b from-white/50 to-transparent rounded-b-full" />

        {/* Inner pulse for processing */}
        {isProcessing && (
          <motion.div
            animate={{ opacity: [0.3, 0.7, 0.3] }}
            transition={{ duration: 1.2, repeat: Infinity }}
            className="absolute inset-4 rounded-full bg-white/20"
          />
        )}
      </motion.div>
    </div>
  );
}
