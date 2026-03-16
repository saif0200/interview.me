import type OpenAI from "openai";
import type { Message } from "../types/index.js";

export const MAX_RECENT_MESSAGES = 6;

const BREVITY_CONSTRAINT = `BREVITY CONSTRAINT (mandatory): Your entire response must be 1-2 sentences, under 40 words. Acknowledge briefly (max 5 words), then ask exactly one question. No preamble, no restating what the candidate said.`;

export function detectCandidateBehavior(content: string): "question" | "farewell" | null {
  const lower = content.toLowerCase().trim();

  const farewellPhrases = [
    "thank you for your time",
    "thanks for",
    "enjoyed",
    "looking forward",
    "goodbye",
  ];
  if (farewellPhrases.some((p) => lower.includes(p))) return "farewell";

  const questionPhrases = [
    "can i ask",
    "i have a question",
    "i'd like to know",
    "tell me about",
    "what about",
  ];
  if (lower.endsWith("?") || questionPhrases.some((p) => lower.includes(p))) return "question";

  return null;
}

export function getMaxTokensForTurn(assistantCount: number): number {
  return assistantCount >= 4 ? 384 : 256;
}

export function buildTurnGuidance(existingAssistantCount: number): string | null {
  switch (existingAssistantCount) {
    case 1:
      return "The candidate just answered your opening question. Move into a behavioral question tied to the role responsibilities.";
    case 2:
      return "The candidate just answered the behavioral portion. Move into the strongest technical or role-specific depth question for this role.";
    case 3:
      return "Use this turn for one high-signal technical follow-up or final technical probe. If the previous answer was weak or vague, probe once instead of changing topics.";
    case 4:
      return "Begin closing now. Invite one brief candidate question if appropriate, then wrap up and append [[END_INTERVIEW]] at the very end.";
    default:
      if (existingAssistantCount >= 5) {
        return "The interview should end on this turn. Give a concise wrap-up and append [[END_INTERVIEW]] at the very end.";
      }
      return null;
  }
}

export function isNonSubstantiveUserReply(content: string): boolean {
  const normalized = content
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return true;

  const lowSignalReplies = new Set([
    "hi",
    "hello",
    "hey",
    "good morning",
    "good afternoon",
    "good evening",
    "thanks",
    "thank you",
    "sounds good",
    "sure",
    "ok",
    "okay",
    "yes",
    "yeah",
    "yep",
    "ready",
    "lets start",
    "let s start",
  ]);

  if (lowSignalReplies.has(normalized)) return true;

  const wordCount = normalized.split(" ").filter(Boolean).length;
  return wordCount <= 2 && !normalized.includes("don't know") && !normalized.includes("not sure");
}

export function buildInterviewerRequestMessages(
  messages: Array<Pick<Message, "role" | "content">>,
  interviewBrief: string | null | undefined,
  latestUserContent: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const systemMessages = messages
    .filter((m) => m.role === "system")
    .map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    }));

  const conversationalMessages = messages
    .filter((m) => m.role !== "system")
    .slice(-MAX_RECENT_MESSAGES)
    .map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    }));

  const llmMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    ...systemMessages,
    ...conversationalMessages,
  ];

  if (interviewBrief) {
    llmMessages.push({
      role: "system",
      content: `Factual role context for this interview:\n\n${interviewBrief}`,
    });
  }

  const existingAssistantCount = messages.filter((m) => m.role === "assistant").length;
  const turnGuidance = isNonSubstantiveUserReply(latestUserContent)
    ? "The candidate has not given a substantive answer yet. Briefly acknowledge them and restate or simplify your current question. Do not advance the interview phase, do not close, and do not ask a harder replacement question."
    : buildTurnGuidance(existingAssistantCount);

  if (turnGuidance) {
    llmMessages.push({
      role: "system",
      content: `Runtime guidance: ${turnGuidance}`,
    });
  }

  // Detect candidate-driven turns and inject corrective guidance
  const behavior = detectCandidateBehavior(latestUserContent);
  if (behavior && existingAssistantCount < 4) {
    const correction =
      behavior === "question"
        ? "The candidate asked a question. Answer in one short sentence (max 15 words), then immediately pivot to YOUR next interview question. You drive this interview."
        : "The candidate is trying to end early. Acknowledge briefly, then say you have one more question and ask it. Do not let the candidate close the interview prematurely.";
    llmMessages.push({
      role: "system",
      content: `Runtime correction: ${correction}`,
    });
  }

  // Hard brevity constraint in recency position — always last
  const isClosingTurn = existingAssistantCount >= 4;
  const brevity = isClosingTurn
    ? `BREVITY CONSTRAINT (mandatory): Keep your wrap-up to 1-2 sentences, under 40 words. Thank the candidate, mention that a detailed report/feedback will be prepared, and say goodbye. You MUST append the exact token [[END_INTERVIEW]] at the very end of your message.`
    : BREVITY_CONSTRAINT;
  llmMessages.push({
    role: "system",
    content: brevity,
  });

  return llmMessages;
}
