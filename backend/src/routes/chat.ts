import { Router } from "express";
import { pool } from "../config/database.js";
import { buildInterviewerRequestMessages, getMaxTokensForTurn } from "../services/interviewRuntime.js";
import { chatCompletion } from "../services/llm.js";
import type { ChatBody, Message, Session } from "../types/index.js";

const router = Router();
const END_MARKER = "[[END_INTERVIEW]]";
const END_MARKER_PATTERN = /\[\[?\s*END[\s_]?INTERVIEW\s*\]?\]/gi;

function containsLegacyWrapUpSignal(content: string): boolean {
  const lowerContent = content.toLowerCase();
  // Must match multiple signals to avoid false positives (e.g. interviewer casually saying "report")
  const signals = [
    "goodbye",
    "good luck",
    "best of luck",
    "take care",
    "thank you for your time",
    "wraps up",
    "concludes the interview",
  ];
  const matchCount = signals.filter((s) => lowerContent.includes(s)).length;
  return matchCount >= 2;
}

function stripEndMarkers(content: string): string {
  return content.replace(END_MARKER_PATTERN, "").trim();
}

function containsEndMarker(content: string): boolean {
  END_MARKER_PATTERN.lastIndex = 0;
  return END_MARKER_PATTERN.test(content);
}

// POST /api/chat — Send user message, stream LLM response via SSE
router.post("/", async (req, res, next) => {
  try {
    const { session_id, content } = req.body as ChatBody;
    if (!session_id || !content) {
      res.status(400).json({ error: "session_id and content are required" });
      return;
    }

    // Verify session is active
    const sessionResult = await pool.query<Pick<Session, "status" | "interview_brief">>(
      `SELECT status, interview_brief FROM sessions WHERE id = $1`,
      [session_id],
    );
    if (sessionResult.rows.length === 0) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (sessionResult.rows[0].status !== "active") {
      res.status(400).json({ error: "Session is not active" });
      return;
    }

    // Store user message
    const userWordCount = content.trim().split(/\s+/).length;
    console.log(`[CHAT] session=${session_id.slice(0, 8)}… user (${userWordCount}w): "${content.slice(0, 100)}${content.length > 100 ? "…" : ""}"`);
    await pool.query(
      `INSERT INTO messages (session_id, role, content, word_count) VALUES ($1, 'user', $2, $3)`,
      [session_id, content, userWordCount],
    );

    // Fetch full conversation history
    const messagesResult = await pool.query<Message>(
      `SELECT role, content FROM messages WHERE session_id = $1 ORDER BY created_at ASC`,
      [session_id],
    );

    const session = sessionResult.rows[0];
    const llmMessages = buildInterviewerRequestMessages(
      messagesResult.rows,
      session.interview_brief,
      content,
    );

    // Set up SSE
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // Abort generation if client disconnects
    const abortController = new AbortController();
    res.on("close", () => abortController.abort());

    const priorAssistantCount = messagesResult.rows.filter((m) => m.role === "assistant").length;
    const maxTokens = getMaxTokensForTurn(priorAssistantCount);

    const llmStart = Date.now();
    const stream = await chatCompletion(llmMessages, maxTokens);
    let rawContent = "";
    let pendingContent = "";

    for await (const chunk of stream) {
      if (abortController.signal.aborted) break;
      const token = chunk.choices[0]?.delta?.content || "";
      if (token) {
        rawContent += token;
        pendingContent += token;

        const safeLength = Math.max(0, pendingContent.length - END_MARKER.length);
        if (safeLength > 0) {
          const safeChunk = pendingContent.slice(0, safeLength).replace(END_MARKER_PATTERN, "");
          pendingContent = pendingContent.slice(safeLength);
          if (safeChunk) {
            res.write(`data: ${JSON.stringify({ token: safeChunk })}\n\n`);
          }
        }
      }
    }
    if (abortController.signal.aborted) return;

    const finalChunk = pendingContent.replace(END_MARKER_PATTERN, "");
    if (finalChunk) {
      res.write(`data: ${JSON.stringify({ token: finalChunk })}\n\n`);
    }
    const fullContent = stripEndMarkers(rawContent);

    // Store assistant message
    console.log(`[CHAT] session=${session_id.slice(0, 8)}… assistant (${Date.now() - llmStart}ms): "${fullContent.slice(0, 120)}…"`);
    const msgResult = await pool.query<Message>(
      `INSERT INTO messages (session_id, role, content) VALUES ($1, 'assistant', $2) RETURNING id`,
      [session_id, fullContent],
    );

    // Count how many assistant messages (excluding system) to detect interview end
    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM messages WHERE session_id = $1 AND role = 'assistant'`,
      [session_id],
    );
    const assistantCount = parseInt(countResult.rows[0].count, 10);

    // Explicit end markers are the primary completion signal. Keep a legacy fallback
    // so demos still recover if the model ignores the marker instruction.
    const isWrapUp =
      containsEndMarker(rawContent) ||
      (assistantCount >= 5 && containsLegacyWrapUpSignal(fullContent));

    res.write(
      `data: ${JSON.stringify({ done: true, messageId: msgResult.rows[0].id, interviewComplete: isWrapUp })}\n\n`,
    );
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      next(err);
    } else {
      console.error(`[CHAT] SSE stream error:`, err);
      res.end();
    }
  }
});

export default router;
