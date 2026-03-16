import OpenAI from "openai";
import { env } from "../config/env.js";

export const openai = new OpenAI({
  baseURL: "https://inference.do-ai.run/v1",
  apiKey: env.DO_MODEL_ACCESS_KEY,
});

export const PROMPT_MODEL = env.MODEL_PROMPT;
export const INTERVIEW_MODEL = env.MODEL_INTERVIEW;
export const REPORT_MODEL = env.MODEL_REPORT;
export const BRIEF_MODEL = env.MODEL_BRIEF;

export async function promptCompletion(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  maxTokens = 1200,
) {
  return openai.chat.completions.create({
    model: PROMPT_MODEL,
    messages,
    max_tokens: maxTokens,
    stream: false,
  });
}

export async function briefCompletion(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  maxTokens = 800,
) {
  return openai.chat.completions.create({
    model: BRIEF_MODEL,
    messages,
    max_tokens: maxTokens,
    stream: false,
  });
}

export async function chatCompletion(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  maxTokens = 384,
) {
  return openai.chat.completions.create({
    model: INTERVIEW_MODEL,
    messages,
    max_tokens: maxTokens,
    stream: true,
  });
}

export async function generateReportStream(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
) {
  return openai.chat.completions.create({
    model: REPORT_MODEL,
    messages,
    max_tokens: 2048,
    stream: true,
  });
}
