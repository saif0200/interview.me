import { Router } from "express";
import { pool } from "../config/database.js";
import { chatCompletion } from "../services/llm.js";
import { interviewerSystemPrompt } from "../services/prompts.js";
import type { CreateSessionBody, Session, Message } from "../types/index.js";

const router = Router();

// POST /api/sessions — Create a new interview session
router.post("/", async (req, res, next) => {
  try {
    const { job_title, company, job_description } = req.body as CreateSessionBody;
    if (!job_title) {
      res.status(400).json({ error: "job_title is required" });
      return;
    }

    // Create session
    const sessionResult = await pool.query<Session>(
      `INSERT INTO sessions (job_title, company, job_description) VALUES ($1, $2, $3) RETURNING *`,
      [job_title, company || null, job_description || null],
    );
    const session = sessionResult.rows[0];

    // Store system prompt as first message
    const systemContent = interviewerSystemPrompt(job_title, company);
    await pool.query(
      `INSERT INTO messages (session_id, role, content) VALUES ($1, 'system', $2)`,
      [session.id, systemContent],
    );

    // Generate first interviewer message
    const stream = await chatCompletion([
      { role: "system", content: systemContent },
    ]);

    let fullContent = "";
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content || "";
      fullContent += token;
    }

    // Store assistant message
    const msgResult = await pool.query<Message>(
      `INSERT INTO messages (session_id, role, content) VALUES ($1, 'assistant', $2) RETURNING *`,
      [session.id, fullContent],
    );

    res.status(201).json({
      session,
      firstMessage: msgResult.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/sessions/:id — Get session with message history
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    const sessionResult = await pool.query<Session>(
      `SELECT * FROM sessions WHERE id = $1`,
      [id],
    );
    if (sessionResult.rows.length === 0) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const messagesResult = await pool.query<Message>(
      `SELECT * FROM messages WHERE session_id = $1 AND role != 'system' ORDER BY created_at ASC`,
      [id],
    );

    res.json({
      session: sessionResult.rows[0],
      messages: messagesResult.rows,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/sessions/:id/end — End session and trigger report generation
router.post("/:id/end", async (req, res, next) => {
  try {
    const { id } = req.params;

    const sessionResult = await pool.query<Session>(
      `UPDATE sessions SET status = 'ended', ended_at = NOW() WHERE id = $1 AND status = 'active' RETURNING *`,
      [id],
    );
    if (sessionResult.rows.length === 0) {
      res.status(404).json({ error: "Active session not found" });
      return;
    }

    // Trigger async report generation (fire and forget)
    generateReportAsync(id).catch((err) =>
      console.error("Report generation failed:", err),
    );

    res.json({ session: sessionResult.rows[0] });
  } catch (err) {
    next(err);
  }
});

async function generateReportAsync(sessionId: string) {
  const { reportGenerationPrompt } = await import("../services/prompts.js");
  const { generateReport } = await import("../services/llm.js");

  const sessionResult = await pool.query<Session>(
    `SELECT * FROM sessions WHERE id = $1`,
    [sessionId],
  );
  const session = sessionResult.rows[0];

  const messagesResult = await pool.query<Message>(
    `SELECT role, content FROM messages WHERE session_id = $1 ORDER BY created_at ASC`,
    [sessionId],
  );

  const transcript = messagesResult.rows
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role === "assistant" ? "Interviewer" : "Candidate"}: ${m.content}`)
    .join("\n\n");

  const systemPrompt = reportGenerationPrompt(session.job_title, session.company);
  const reportContent = await generateReport([
    { role: "system", content: systemPrompt },
    { role: "user", content: `Here is the interview transcript:\n\n${transcript}` },
  ]);

  // Parse scores from the response
  let scores: Record<string, number> | null = null;
  let markdownContent = reportContent;

  const scoresMatch = reportContent.match(/SCORES_JSON:\s*(\{[^}]+\})/);
  if (scoresMatch) {
    try {
      scores = JSON.parse(scoresMatch[1]);
      markdownContent = reportContent.replace(/SCORES_JSON:\s*\{[^}]+\}/, "").trim();
    } catch {
      // If parsing fails, keep the full content
    }
  }

  await pool.query(
    `INSERT INTO reports (session_id, content, scores) VALUES ($1, $2, $3)`,
    [sessionId, markdownContent, scores ? JSON.stringify(scores) : null],
  );

  await pool.query(
    `UPDATE sessions SET status = 'report_ready' WHERE id = $1`,
    [sessionId],
  );
}

export default router;
