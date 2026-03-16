import { Router } from "express";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "../config/database.js";
import { chatCompletion } from "../services/llm.js";
import { generateInterviewerPrompt } from "../services/prompts.js";
import { enrichSession } from "../services/enrichment.js";
import type { CreateSessionBody, Session, Message } from "../types/index.js";

const router = Router();

// POST /api/sessions — Create a new interview session
router.post("/", async (req, res, next) => {
  try {
    const { job_title, company, job_description, job_url, user_context } =
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
        ? await enrichSession({ jobUrl: job_url, jobTitle: job_title, company })
        : null;
    console.log(`[ENRICHMENT] Completed in ${Date.now() - enrichStart}ms`);
    if (enrichment) {
      console.log(`  Scraped: title="${enrichment.scraped?.job_title || "—"}" company="${enrichment.scraped?.company || "—"}" requirements=${enrichment.scraped?.requirements?.length || 0} tech_stack=${enrichment.scraped?.tech_stack?.length || 0}`);
      console.log(`  Search: questions=${enrichment.searched?.interview_questions?.length || 0} company_info=${enrichment.searched?.company_info?.length || 0}`);
    }

    // Use enriched values, falling back to user input
    const finalTitle = enrichment?.job_title || job_title || "Software Engineer";
    const finalCompany = enrichment?.company || company || null;
    console.log(`[SESSION] Resolved: "${finalTitle}" at "${finalCompany || "—"}"`);

    // Create session
    const sessionResult = await pool.query<Session>(
      `INSERT INTO sessions (job_title, company, job_description, job_url, scraped_context, search_context, user_context)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        finalTitle,
        finalCompany,
        job_description || null,
        job_url || null,
        enrichment?.scraped ? JSON.stringify(enrichment.scraped) : null,
        enrichment?.searched ? JSON.stringify(enrichment.searched) : null,
        user_context || null,
      ],
    );
    const session = sessionResult.rows[0];
    console.log(`[SESSION] Created: id=${session.id}`);

    // Build system prompt with enrichment (LLM-generated)
    const promptStart = Date.now();
    const systemContent = await generateInterviewerPrompt(finalTitle, finalCompany, {
      scraped: enrichment?.scraped,
      searched: enrichment?.searched,
      userContext: user_context,
    });
    console.log(`[PROMPT] System prompt generated in ${Date.now() - promptStart}ms (${systemContent.length} chars)`);

    // Store system prompt as first message
    await pool.query(
      `INSERT INTO messages (session_id, role, content) VALUES ($1, 'system', $2)`,
      [session.id, systemContent],
    );

    // Generate first interviewer message
    const llmStart = Date.now();
    const stream = await chatCompletion([
      { role: "system", content: systemContent },
    ]);

    let fullContent = "";
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content || "";
      fullContent += token;
    }
    console.log(`[LLM] Opening message generated in ${Date.now() - llmStart}ms (${fullContent.length} chars)`);
    console.log(`  "${fullContent.slice(0, 120)}..."`);

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
  const filename = `${date}_${company}_${title}`.replace(/[^a-zA-Z0-9_-]/g, "_");

  const scraped = session.scraped_context as import("../types/index.js").ScrapedContext | null;
  const searched = session.search_context as import("../types/index.js").SearchContext | null;

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

  // Scraped job data
  if (scraped) {
    lines.push(`[SCRAPED JOB DATA]`);
    lines.push(`${"-".repeat(40)}`);
    if (scraped.source_url) lines.push(`Source: ${scraped.source_url}`);
    if (scraped.job_title) lines.push(`Title: ${scraped.job_title}`);
    if (scraped.company) lines.push(`Company: ${scraped.company}`);
    if (scraped.seniority_level) lines.push(`Seniority: ${scraped.seniority_level}`);
    if (scraped.company_description) lines.push(`About Company: ${scraped.company_description}`);
    if (scraped.team_description) lines.push(`About Team: ${scraped.team_description}`);
    if (scraped.requirements?.length) {
      lines.push(``);
      lines.push(`Requirements:`);
      for (const r of scraped.requirements) lines.push(`  - ${r}`);
    }
    if (scraped.responsibilities?.length) {
      lines.push(``);
      lines.push(`Responsibilities:`);
      for (const r of scraped.responsibilities) lines.push(`  - ${r}`);
    }
    if (scraped.tech_stack?.length) {
      lines.push(``);
      lines.push(`Tech Stack: ${scraped.tech_stack.join(", ")}`);
    }
    if (scraped.raw_markdown) {
      lines.push(``);
      lines.push(`Raw Page Content:`);
      lines.push(scraped.raw_markdown);
    }
    lines.push(`${"-".repeat(40)}`);
    lines.push(``);
  }

  // Search context
  if (searched) {
    lines.push(`[SEARCH CONTEXT]`);
    lines.push(`${"-".repeat(40)}`);
    if (searched.company_info?.length) {
      lines.push(`Company Info:`);
      for (const c of searched.company_info) {
        lines.push(`  - ${c.content}`);
        lines.push(`    (${c.url})`);
      }
      lines.push(``);
    }
    if (searched.interview_questions?.length) {
      lines.push(`Interview Questions Found:`);
      for (const q of searched.interview_questions) {
        lines.push(`  - ${q.content}`);
        lines.push(`    Source: ${q.source} (${q.url})`);
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

  const dir = join(process.cwd(), "logs");
  await mkdir(dir, { recursive: true });
  const path = `${dir}/${filename}.txt`;
  await writeFile(path, lines.join("\n"), "utf-8");
  console.log(`[TRANSCRIPT] Saved to ${path}`);
}

export default router;
