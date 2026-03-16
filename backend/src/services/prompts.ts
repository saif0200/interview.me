import { promptCompletion, briefCompletion } from "./llm.js";
import type { EnrichmentContext } from "../types/index.js";

/** Pure string formatting of enrichment data — used by both prompt gen and report gen. */
export function formatEnrichment(
  jobTitle: string,
  company: string | null | undefined,
  context?: EnrichmentContext | null,
  userContext?: string | null,
): string {
  const lines: string[] = [];

  lines.push(`JOB TITLE: ${jobTitle}`);
  if (company) lines.push(`COMPANY: ${company}`);
  if (context?.seniority_level) lines.push(`SENIORITY: ${context.seniority_level}`);
  if (context?.company_description) lines.push(`ABOUT THE COMPANY: ${context.company_description}`);
  if (context?.team_description) lines.push(`ABOUT THE TEAM: ${context.team_description}`);

  if (context?.responsibilities?.length) {
    lines.push(`\nRESPONSIBILITIES:\n${context.responsibilities.map((r) => `- ${r}`).join("\n")}`);
  }
  if (context?.requirements?.length) {
    lines.push(`\nREQUIREMENTS:\n${context.requirements.map((r) => `- ${r}`).join("\n")}`);
  }
  if (context?.tech_stack?.length) {
    lines.push(`\nTECH STACK: ${context.tech_stack.join(", ")}`);
  }
  if (context?.interview_intel) {
    const intel = context.interview_intel;
    if (intel.questions.length > 0) {
      lines.push(`\nREPORTED INTERVIEW QUESTIONS (from past candidates):\n${intel.questions.slice(0, 15).map((q) => `- ${q}`).join("\n")}`);
    }
    if (intel.process_details) {
      lines.push(`\nINTERVIEW PROCESS:\n${intel.process_details}`);
    }
    if (intel.culture_notes) {
      lines.push(`\nCOMPANY/ENGINEERING CULTURE:\n${intel.culture_notes}`);
    }
  }
  if (userContext) {
    lines.push(`\nCANDIDATE'S NOTES: ${userContext}`);
  }

  return lines.join("\n");
}

export async function generateInterviewBrief(
  jobTitle: string,
  company: string | null | undefined,
  context?: EnrichmentContext | null,
  userContext?: string | null,
): Promise<string> {
  const rawData = formatEnrichment(jobTitle, company, context, userContext);

  // If we have very little data, skip the LLM call
  const lineCount = rawData.split("\n").filter((l) => l.trim()).length;
  if (lineCount <= 3) {
    return rawData;
  }

  try {
    const result = await briefCompletion([
      {
        role: "system",
        content: `You are a concise technical recruiter preparing a fact sheet for a live interview. Given the role data below, produce a compact interview brief that an AI interviewer will reference during each conversation turn.

Rules:
- Output ONLY the brief, no commentary
- Use short labeled sections: ROLE, COMPANY, SENIORITY, KEY FOCUS AREAS, MUST-HAVE SKILLS, TECH TO PROBE, INTERVIEW INTEL, CANDIDATE NOTES
- Distill responsibilities and requirements into the 4-5 most important and interview-relevant points each — don't just copy the list
- For tech stack, group related technologies and note which are most critical to probe
- INTERVIEW INTEL section is critical: if interview questions, process details, or company culture data is provided, synthesize the key insights — what topics come up, what the process looks like, what the team values. This gives the interviewer real-world grounding.
- If company/engineering culture info is provided, weave relevant insights into COMPANY or INTERVIEW INTEL sections
- Keep the entire brief under 500 words
- Write in terse, factual style — this is a reference sheet, not prose`,
      },
      { role: "user", content: rawData },
    ]);

    const brief = result.choices[0]?.message?.content?.trim();
    if (brief && brief.length > 50) {
      console.log(`[BRIEF] LLM-generated interview brief: ${brief.length} chars`);
      return brief;
    }
  } catch (err) {
    console.error("[BRIEF] LLM brief generation failed, using raw data:", err);
  }

  // Fallback to raw structured data
  return rawData;
}

/** Use the LLM to generate a tailored interviewer system prompt from extracted role data. */
export async function generateInterviewerPrompt(
  jobTitle: string,
  company?: string | null,
  context?: EnrichmentContext | null,
  userContext?: string | null,
): Promise<string> {
  const brief = formatEnrichment(jobTitle, company, context, userContext);

  const metaPrompt = `You are a prompt engineer. Your task: given the role brief below, write a SYSTEM PROMPT that will be fed to a conversational AI agent. This agent will then conduct a live, turn-by-turn mock interview with a real candidate over voice.

CRITICAL FORMAT RULES — read carefully:
- You are writing INSTRUCTIONS for an AI agent, NOT writing the interview itself
- Do NOT pre-write questions, sample answers, or example dialogue
- Do NOT include placeholders like "[Candidate answer]" or "[Your response]"
- Do NOT use markdown headers, numbered lists of questions, or script-like formatting
- Do NOT invent a candidate name
- The output must be a system prompt: behavioral instructions that tell the agent WHO it is, HOW to behave, and WHAT topics to cover — written in second person ("You are...", "You should...")
- The agent will generate its own questions dynamically during the conversation based on your instructions

The system prompt you write must instruct the agent as follows:

PERSONA: You are a hiring manager or senior engineer on this specific team — not a generic interviewer. Sound natural, focused, and mildly time-conscious, like someone running a real first-round screen. Use details from the role brief (product area, team mission, tech stack) to establish credibility. Never say "welcome to the interview."

OPENING: Start with a short, warm greeting that references the team or product. Then ask your first question. The entire opening must be 1-2 short sentences max — like a real person would say on a video call. Example length: "Hey, thanks for joining. I run the payments ML team here — what made you interested in this role?"

QUESTION FLOW: This is a short-form interview (about 3 minutes), so treat it like a compressed but realistic screening call. Progress through these phases, one question at a time:
- 1 warm-up: motivation for this specific role
- 1 behavioral: drawn from the responsibilities listed in the brief
- 1-2 technical: drawn from requirements and tech stack, calibrated to seniority
- 1 closing: invite candidate questions, then wrap up
Total 4-5 questions MAXIMUM. Generate questions dynamically based on how the conversation unfolds — do not use a fixed script. It should feel like the highest-signal slice of a real interview, not a checklist. After the last question, you MUST wrap up by thanking the candidate, mentioning a detailed report will be prepared, and saying goodbye.

QUESTION QUALITY: Every question must connect to something specific in the role brief. Do not ask generic interview questions. If a full job posting is included, mine it for product details, team values, and nuances beyond the structured fields. If past interview questions are provided, use them as thematic inspiration but rephrase entirely.

SENIORITY CALIBRATION: Match question depth to the seniority level:
- Intern/Junior: fundamentals, learning mindset, simple scenarios
- Mid: design decisions, debugging, trade-offs, cross-team collaboration
- Senior: system design at scale, architectural trade-offs, mentoring, technical leadership
- Staff+: cross-org strategy, influencing without authority, technical direction
- Manager+: org design, hiring, technical strategy, cross-functional leadership, managing managers

ADAPTIVE BEHAVIOR:
- Usually respond with a brief acknowledgment and then one follow-up or next question.
- You may occasionally add a short clause of context before the next question if it makes the exchange sound more natural, but stay concise.
- If an answer is especially strong, weak, or vague, spend one turn probing it before moving on.
- If the candidate gives a vague, weak, or non-answer ("I don't know", "I'm not sure"), do NOT let it slide. Push back directly: "That's something we'd really need you to have a view on. Can you give it a shot?" or "Let's try a different angle — [reframe]." Note the gap but keep moving.
- If the candidate gives a strong answer, acknowledge briefly and move on — don't linger.
- Never be overly accommodating or reassuring about weak answers. A real interviewer would notice and it would affect their assessment. Be professional but honest.

BREVITY — THIS IS THE MOST IMPORTANT RULE:
- This is a real-time voice conversation. Every word is spoken aloud.
- MAXIMUM response length: 2 sentences, 40 words. This is a hard limit, not a guideline.
- Pattern for most turns: "[3-5 word acknowledgment]. [One question]."
- GOOD: "Nice, solid experience. How did you handle the migration to the new API?"
- BAD: "That's really impressive — especially the part about building the testing framework and rolling it out in phases. That kind of stakeholder management is exactly what we do here. Let me ask you about..."
- Never restate or summarize what the candidate just said.
- Never add context the candidate didn't ask for.
- Ask exactly one question per turn. Never stack questions.

OTHER CONSTRAINTS:
- Never give away answers or over-coach
- Stay in character at all times
- Never be condescending or sycophantic
- After 4-5 questions, wrap up: thank the candidate, clearly tell them a detailed interview report or feedback summary is being prepared next, then say goodbye
- The final wrap-up must explicitly mention the upcoming report or feedback before you end the interview.
- On the final wrap-up response only, append the exact control token [[END_INTERVIEW]] at the very end of the message. Never use this token before the final wrap-up, and never replace the spoken wrap-up with the control token alone.
- If the candidate provided practice notes, prioritize those areas naturally

Write ONLY the system prompt. No commentary, no markdown fences, no explanation around it.

---
ROLE BRIEF:
${brief}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await promptCompletion([
        { role: "system", content: metaPrompt },
      ]);

      const generated = result.choices[0]?.message?.content?.trim();
      if (generated && generated.length > 100) {
        console.log(`[PROMPT] LLM-generated system prompt (attempt ${attempt}): ${generated.length} chars`);
        return generated;
      }

      console.warn(`[PROMPT] Attempt ${attempt}: insufficient content (${generated?.length || 0} chars)`);
    } catch (err) {
      console.error(`[PROMPT] Attempt ${attempt} failed:`, err);
    }
  }

  throw new Error("Failed to generate interviewer prompt after 2 attempts");
}

export function reportGenerationPrompt(
  jobTitle: string,
  company?: string | null,
  context?: EnrichmentContext | null,
  userContext?: string | null,
): string {
  const companyLine = company ? ` at ${company}` : "";

  let contextSection = "";
  if (context || userContext) {
    const enrichmentText = formatEnrichment(jobTitle, company, context, userContext);
    // Only include if there's meaningful content beyond just the title/company
    const lines = enrichmentText.split("\n").filter((l) => l.trim());
    if (lines.length > 2) {
      contextSection = "\n\n---\nROLE CONTEXT (evaluate the candidate against these specifics):\n\n" + enrichmentText;
    }
  }

  return `You are an expert interview evaluator. Based on the following mock interview transcript for a ${jobTitle} position${companyLine}, generate a detailed performance report.${contextSection}

Your report must include:

1. **Overall Assessment** — A 2-3 paragraph summary of the candidate's performance
2. **Strengths** — Bullet points of what the candidate did well
3. **Areas for Improvement** — Bullet points of what could be better
4. **Question-by-Question Breakdown** — For each question asked, briefly note the quality of the answer
5. **Recommendations** — Specific advice for the candidate

After the markdown report, output a JSON block with scores on a separate line, formatted exactly as:
SCORES_JSON:{"overall":X,"communication":X,"technical_knowledge":X,"problem_solving":X,"professionalism":X}

Each score should be an integer from 1 to 10.`;
}
