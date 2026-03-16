import { Router } from "express";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "../config/database.js";
import { buildInterviewerRequestMessages } from "../services/interviewRuntime.js";
import { chatCompletion } from "../services/llm.js";
import { appendPayloadTrace } from "../services/debug.js";
import { generateInterviewerPrompt } from "../services/prompts.js";
import { enrichSession } from "../services/enrichment.js";
import type { CreateSessionBody, Session, Message, EnrichmentContext } from "../types/index.js";

const router = Router();

function isUsableOpening(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length < 20) return false;
  if (!trimmed.includes("?")) return false;
  if (trimmed.endsWith("—") || trimmed.endsWith("-") || trimmed.endsWith(":")) return false;
  return true;
}

// POST /api/sessions — Create a new interview session
router.post("/", async (req, res, next) => {
  try {
    const { job_title, company, job_url, user_context } =
      req.body as CreateSessionBody;

    console.log(`\n${"=".repeat(60)}`);
    console.log(`[SESSION] New session request`);
    console.log(`  Input: title="${job_title || ""}" company="${company || ""}" url="${job_url || ""}"`);

    if (!job_title && !job_url) {
      res.status(400).json({ error: "job_title or job_url is required" });
      return;
    }

    // Run context enrichment if we have a URL or company
    const enrichStart = Date.now();
    const enrichment =
      job_url || company
        ? await enrichSession({ jobUrl: job_url, jobTitle: job_title, company, userContext: user_context })
        : null;
    console.log(`[ENRICHMENT] Completed in ${Date.now() - enrichStart}ms`);
    if (enrichment) {
      console.log(`  Context: title="${enrichment.context?.job_title || "—"}" company="${enrichment.context?.company || "—"}" requirements=${enrichment.context?.requirements?.length || 0} tech_stack=${enrichment.context?.tech_stack?.length || 0}`);
    }

    // Use enriched values, falling back to user input
    const finalTitle = enrichment?.job_title || job_title || "Software Engineer";
    const finalCompany = enrichment?.company || company || null;
    console.log(`[SESSION] Resolved: "${finalTitle}" at "${finalCompany || "—"}"`);

    // Generate system prompt before creating session (so we don't orphan DB rows on failure)
    const promptStart = Date.now();
    const systemContent = await generateInterviewerPrompt(
      finalTitle,
      finalCompany,
      enrichment?.context,
      user_context,
    );
    console.log(`[PROMPT] System prompt generated in ${Date.now() - promptStart}ms (${systemContent.length} chars)`);

    // Create session (interview_brief will be populated by deep enrichment background task)
    const sessionResult = await pool.query<Session>(
      `INSERT INTO sessions (job_title, company, job_url, enrichment_context, user_context)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        finalTitle,
        finalCompany,
        job_url || null,
        enrichment?.context ? JSON.stringify(enrichment.context) : null,
        user_context || null,
      ],
    );
    const session = sessionResult.rows[0];
    console.log(`[SESSION] Created: id=${session.id}`);

    // Fire off deep enrichment in the background (scrapes search result pages, generates brief)
    if (enrichment) {
      enrichment.startDeepEnrichment(session.id);
    }

    await appendPayloadTrace(session.id, "session_setup", {
      job_title: finalTitle,
      company: finalCompany,
      enrichment_context: enrichment?.context ?? null,
      user_context: user_context ?? null,
      generated_system_prompt: systemContent,
    });

    // Store system prompt as first message
    await pool.query(
      `INSERT INTO messages (session_id, role, content) VALUES ($1, 'system', $2)`,
      [session.id, systemContent],
    );

    // Generate first interviewer message (retry once if empty)
    const llmStart = Date.now();
    let fullContent = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      fullContent = "";
      const openingMessages = [
        { role: "system" as const, content: systemContent },
        { role: "user" as const, content: "[The candidate just joined the call. Greet them and ask your first question. Keep it to 1-2 sentences total, under 30 words.]" },
      ];
      await appendPayloadTrace(session.id, "opening_generation_request", {
        attempt,
        messages: openingMessages,
      });
      const stream = await chatCompletion(openingMessages, 150);

      for await (const chunk of stream) {
        const token = chunk.choices[0]?.delta?.content || "";
        fullContent += token;
      }
      fullContent = fullContent.replace(/\[\[?\s*END[\s_]?INTERVIEW\s*\]?\]/gi, "").trim();

      if (isUsableOpening(fullContent)) {
        console.log(`[LLM] Opening message generated (attempt ${attempt}) in ${Date.now() - llmStart}ms (${fullContent.length} chars)`);
        console.log(`  "${fullContent.slice(0, 120)}..."`);
        await appendPayloadTrace(session.id, "opening_generation_response", {
          attempt,
          content: fullContent,
        });
        break;
      }
      console.warn(`[LLM] Opening message attempt ${attempt} returned unusable content, retrying...`);
    }

    if (!isUsableOpening(fullContent)) {
      // Absolute fallback — concise and complete, even if the model opening is malformed.
      fullContent = `Hi, thanks for joining. I'm hiring for the ${finalTitle} role${finalCompany ? ` here at ${finalCompany}` : ""}—what made you interested in this team?`;
      console.warn(`[LLM] Using fallback opening message`);
    }

    // Store assistant message
    const msgResult = await pool.query<Message>(
      `INSERT INTO messages (session_id, role, content) VALUES ($1, 'assistant', $2) RETURNING *`,
      [session.id, fullContent],
    );

    console.log(`[SESSION] Ready — total setup: ${Date.now() - enrichStart}ms`);
    console.log(`${"=".repeat(60)}\n`);

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

// DELETE /api/sessions/:id/messages/last — Remove the last user message (for reconnect after refresh)
router.delete("/:id/messages/last", async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM messages WHERE id = (
        SELECT id FROM messages WHERE session_id = $1 AND role = 'user' ORDER BY created_at DESC LIMIT 1
      ) RETURNING id`,
      [id],
    );
    res.json({ deleted: result.rowCount === 1 });
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

    // Save transcript log
    saveTranscriptLog(id, sessionResult.rows[0]).catch((err) =>
      console.error("Transcript log failed:", err),
    );

    // Report generation is now triggered on-demand via the stream endpoint

    res.json({ session: sessionResult.rows[0] });
  } catch (err) {
    next(err);
  }
});

async function saveTranscriptLog(sessionId: string, session: Session) {
  const messagesResult = await pool.query<Message>(
    `SELECT role, content, created_at FROM messages WHERE session_id = $1 ORDER BY created_at ASC`,
    [sessionId],
  );

  const date = new Date().toISOString().slice(0, 10);
  const company = session.company || "unknown";
  const title = session.job_title || "unknown";
  const shortId = sessionId.slice(0, 8);
  const filename = `${date}_${company}_${title}_${shortId}`.replace(/[^a-zA-Z0-9_-]/g, "_");

  const enrichment = session.enrichment_context as EnrichmentContext | null;

  const lines: string[] = [
    `INTERVIEW TRANSCRIPT`,
    `${"=".repeat(60)}`,
    `Session:  ${sessionId}`,
    `Role:     ${title}`,
    `Company:  ${company}`,
    `Job URL:  ${session.job_url || "—"}`,
    `Started:  ${session.created_at}`,
    `Ended:    ${session.ended_at || "—"}`,
    `Messages: ${messagesResult.rows.length}`,
    `${"=".repeat(60)}`,
    ``,
  ];

  // User-provided context
  if (session.user_context) {
    lines.push(`[USER CONTEXT]`);
    lines.push(`${"-".repeat(40)}`);
    lines.push(session.user_context);
    lines.push(`${"-".repeat(40)}`);
    lines.push(``);
  }

  if (session.interview_brief) {
    lines.push(`[INTERVIEW BRIEF]`);
    lines.push(`${"-".repeat(40)}`);
    lines.push(session.interview_brief);
    lines.push(`${"-".repeat(40)}`);
    lines.push(``);
  }

  // Enrichment context
  if (enrichment) {
    lines.push(`[ENRICHMENT CONTEXT]`);
    lines.push(`${"-".repeat(40)}`);
    if (enrichment.job_title) lines.push(`Title: ${enrichment.job_title}`);
    if (enrichment.company) lines.push(`Company: ${enrichment.company}`);
    if (enrichment.seniority_level) lines.push(`Seniority: ${enrichment.seniority_level}`);
    if (enrichment.company_description) lines.push(`About Company: ${enrichment.company_description}`);
    if (enrichment.team_description) lines.push(`About Team: ${enrichment.team_description}`);
    if (enrichment.requirements?.length) {
      lines.push(``);
      lines.push(`Requirements:`);
      for (const r of enrichment.requirements) lines.push(`  - ${r}`);
    }
    if (enrichment.responsibilities?.length) {
      lines.push(``);
      lines.push(`Responsibilities:`);
      for (const r of enrichment.responsibilities) lines.push(`  - ${r}`);
    }
    if (enrichment.tech_stack?.length) {
      lines.push(``);
      lines.push(`Tech Stack: ${enrichment.tech_stack.join(", ")}`);
    }
    if (enrichment.interview_intel) {
      const intel = enrichment.interview_intel;
      if (intel.questions.length > 0) {
        lines.push(``);
        lines.push(`Interview Questions:`);
        for (const q of intel.questions) lines.push(`  - ${q}`);
      }
      if (intel.process_details) {
        lines.push(``);
        lines.push(`Process Details: ${intel.process_details}`);
      }
      if (intel.culture_notes) {
        lines.push(``);
        lines.push(`Culture Notes: ${intel.culture_notes}`);
      }
    }
    lines.push(`${"-".repeat(40)}`);
    lines.push(``);
  }

  // Messages
  lines.push(`[CONVERSATION]`);
  lines.push(`${"=".repeat(60)}`);
  lines.push(``);

  for (const msg of messagesResult.rows) {
    const label =
      msg.role === "system" ? "[SYSTEM PROMPT]" :
      msg.role === "assistant" ? "INTERVIEWER" :
      "CANDIDATE";

    if (msg.role === "system") {
      lines.push(`${label}`);
      lines.push(`${"-".repeat(40)}`);
      lines.push(msg.content);
      lines.push(`${"-".repeat(40)}`);
    } else {
      const time = new Date(msg.created_at).toLocaleTimeString();
      lines.push(`${label} [${time}]:`);
      lines.push(msg.content);
    }
    lines.push(``);
  }

  const systemPrompt = messagesResult.rows.find((msg) => msg.role === "system")?.content;
  if (systemPrompt) {
    lines.push(`[INTERVIEWER REQUEST PAYLOADS]`);
    lines.push(`${"=".repeat(60)}`);
    lines.push(``);

    const openingMessages = [{ role: "system", content: systemPrompt }];
    lines.push(`[OPENING REQUEST]`);
    lines.push(`${"-".repeat(40)}`);
    lines.push(JSON.stringify(openingMessages, null, 2));
    lines.push(`${"-".repeat(40)}`);
    lines.push(``);

    for (let i = 0; i < messagesResult.rows.length; i++) {
      const msg = messagesResult.rows[i];
      if (msg.role !== "user") continue;

      const priorMessages = messagesResult.rows
        .slice(0, i + 1)
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));
      const requestMessages = buildInterviewerRequestMessages(
        priorMessages,
        session.interview_brief,
        msg.content,
      );
      const userTurn = priorMessages.filter((m) => m.role === "user").length;

      lines.push(`[TURN ${userTurn} REQUEST]`);
      lines.push(`${"-".repeat(40)}`);
      lines.push(JSON.stringify(requestMessages, null, 2));
      lines.push(`${"-".repeat(40)}`);
      lines.push(``);
    }
  }

  const dir = join(process.cwd(), "logs");
  await mkdir(dir, { recursive: true });
  const path = `${dir}/${filename}.txt`;
  await writeFile(path, lines.join("\n"), "utf-8");
  console.log(`[TRANSCRIPT] Saved to ${path}`);
}

export default router;
