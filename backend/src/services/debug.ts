import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../config/env.js";

function sanitizeLabel(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export async function appendPayloadTrace(
  traceId: string,
  stage: string,
  payload: unknown,
): Promise<void> {
  if (!env.LOG_LLM_PAYLOADS) return;

  const dir = join(process.cwd(), "logs", "payloads");
  await mkdir(dir, { recursive: true });

  const timestamp = new Date().toISOString();
  const path = join(dir, `${sanitizeLabel(traceId)}.jsonl`);
  const line = JSON.stringify({
    timestamp,
    stage,
    payload,
  });

  await appendFile(path, `${line}\n`, "utf-8");
}
