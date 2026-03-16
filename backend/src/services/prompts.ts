import { openai } from "./llm.js";
import type { ScrapedContext, SearchContext } from "../types/index.js";

const MODEL = "glm-5";

interface EnrichmentData {
  scraped?: ScrapedContext;
  searched?: SearchContext;
  userContext?: string;
}

/** Serialize enrichment data into a structured brief for the prompt-generating LLM. */
function buildRoleBrief(
  jobTitle: string,
  company: string | null | undefined,
  enrichment?: EnrichmentData,
): string {
  const lines: string[] = [];
  const { scraped, searched, userContext } = enrichment || {};

  lines.push(`JOB TITLE: ${jobTitle}`);
  if (company) lines.push(`COMPANY: ${company}`);
  if (scraped?.seniority_level) lines.push(`SENIORITY: ${scraped.seniority_level}`);
  if (scraped?.company_description) lines.push(`ABOUT THE COMPANY: ${scraped.company_description}`);
  if (scraped?.team_description) lines.push(`ABOUT THE TEAM: ${scraped.team_description}`);

  if (scraped?.responsibilities?.length) {
    lines.push(`\nRESPONSIBILITIES:\n${scraped.responsibilities.map((r) => `- ${r}`).join("\n")}`);
  }
  if (scraped?.requirements?.length) {
    lines.push(`\nREQUIREMENTS:\n${scraped.requirements.map((r) => `- ${r}`).join("\n")}`);
  }
  if (scraped?.tech_stack?.length) {
    lines.push(`\nTECH STACK: ${scraped.tech_stack.join(", ")}`);
  }
  if (searched?.interview_questions?.length) {
    const questions = searched.interview_questions
      .slice(0, 5)
      .map((q) => `- ${q.content}`)
      .join("\n");
    lines.push(`\nREPORTED INTERVIEW QUESTIONS (from past candidates):\n${questions}`);
  }
  if (searched?.company_info?.length) {
    const info = searched.company_info
      .slice(0, 3)
      .map((c) => `- ${c.content}`)
      .join("\n");
    lines.push(`\nCOMPANY CULTURE (from public sources):\n${info}`);
  }
  if (userContext) {
    lines.push(`\nCANDIDATE'S NOTES: ${userContext}`);
  }

  return lines.join("\n");
}

/** Use the LLM to generate a tailored interviewer system prompt from extracted role data. */
export async function generateInterviewerPrompt(
  jobTitle: string,
  company?: string | null,
  enrichment?: EnrichmentData,
): Promise<string> {
  const brief = buildRoleBrief(jobTitle, company, enrichment);

  const metaPrompt = `You are a prompt engineer. Given the role brief below, write a system prompt for an AI interviewer that will conduct a realistic mock interview for this specific role.

The system prompt you write must instruct the interviewer to:
1. Open with a brief, natural greeting that references the company and team context (if available) to set the scene — not a generic "welcome to the interview"
2. Ask one question at a time, progressing naturally: warm-up → behavioral → technical → problem-solving → wrap-up
3. Draw questions directly from the responsibilities, requirements, and tech stack provided — avoid generic interview questions
4. Adapt the interview style to the seniority level (e.g. intern → fundamentals & enthusiasm; senior → system design & trade-offs; manager → leadership, strategy & org design)
5. Ask follow-up questions that dig deeper (e.g. "What trade-offs did you consider?", "How would you handle that differently now?")
6. Be encouraging but realistic — note when answers could be stronger
7. Keep responses concise (2-4 sentences) since this is a voice conversation
8. After 8-12 questions total, wrap up naturally and tell the candidate a report will be prepared
9. If reported interview questions from past candidates are provided, use them as inspiration but rephrase in the interviewer's own words
10. If the candidate provided notes about what they want to practice, tailor questions to those areas

The system prompt must also include these constraints:
- Never ask multiple questions at once
- Never give away answers
- Never break character as an interviewer
- Never be overly harsh or overly lenient

Write ONLY the system prompt text. Do not include any meta-commentary, explanations, or markdown formatting around it.

---
ROLE BRIEF:
${brief}`;

  try {
    const result = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: metaPrompt },
      ],
      stream: false,
    });

    const generated = result.choices[0]?.message?.content?.trim();
    if (generated && generated.length > 100) {
      console.log(`[PROMPT] LLM-generated system prompt: ${generated.length} chars`);
      return generated;
    }

    console.warn("[PROMPT] LLM generation returned insufficient content, falling back to template");
    return fallbackPrompt(jobTitle, company, enrichment);
  } catch (err) {
    console.error("[PROMPT] LLM prompt generation failed, falling back to template:", err);
    return fallbackPrompt(jobTitle, company, enrichment);
  }
}

/** Template-based fallback in case LLM generation fails. */
function fallbackPrompt(
  jobTitle: string,
  company?: string | null,
  enrichment?: EnrichmentData,
): string {
  const companyLine = company ? ` at ${company}` : "";
  const brief = buildRoleBrief(jobTitle, company, enrichment);

  return `You are a professional interviewer conducting a realistic mock interview for the ${jobTitle} position${companyLine}.

Your behavior:
- Open with a brief, natural greeting that references the company/team context to set the scene
- Ask one question at a time, progressing from introductory → behavioral → technical → problem-solving → closing
- Draw your questions directly from the role context below — NOT generic interview questions
- Ask follow-up questions that dig deeper into the candidate's answers
- Be encouraging but realistic — note when answers could be stronger
- Keep responses concise (2-4 sentences typically) since this is a voice conversation
- After 8-12 questions total, wrap up the interview naturally
- When wrapping up, tell the candidate you'll prepare a report and say goodbye

Do NOT:
- Ask multiple questions at once
- Ask generic questions when you have specific role context to draw from
- Give away answers
- Be overly harsh or overly lenient
- Break character as an interviewer

---
ROLE CONTEXT:
${brief}`;
}

function buildReportContext(enrichment?: EnrichmentData): string {
  if (!enrichment) return "";

  const sections: string[] = [];
  const { scraped, searched, userContext } = enrichment;

  if (scraped?.company_description) {
    sections.push(`COMPANY: ${scraped.company_description}`);
  }
  if (scraped?.team_description) {
    sections.push(`TEAM: ${scraped.team_description}`);
  }
  if (scraped?.responsibilities?.length) {
    sections.push(`RESPONSIBILITIES:\n${scraped.responsibilities.map((r) => `- ${r}`).join("\n")}`);
  }
  if (scraped?.requirements?.length) {
    sections.push(`REQUIREMENTS:\n${scraped.requirements.map((r) => `- ${r}`).join("\n")}`);
  }
  if (scraped?.tech_stack?.length) {
    sections.push(`TECH STACK: ${scraped.tech_stack.join(", ")}`);
  }
  if (scraped?.seniority_level) {
    sections.push(`SENIORITY LEVEL: ${scraped.seniority_level}`);
  }
  if (searched?.interview_questions?.length) {
    const questions = searched.interview_questions
      .slice(0, 3)
      .map((q) => `- ${q.content}`)
      .join("\n");
    sections.push(`REPORTED INTERVIEW QUESTIONS:\n${questions}`);
  }
  if (userContext) {
    sections.push(`CANDIDATE'S NOTES: ${userContext}`);
  }

  if (sections.length === 0) return "";

  return "\n\n---\nROLE CONTEXT (evaluate the candidate against these specifics):\n\n" + sections.join("\n\n");
}

export function reportGenerationPrompt(
  jobTitle: string,
  company?: string | null,
  enrichment?: EnrichmentData,
): string {
  const companyLine = company ? ` at ${company}` : "";
  const contextSection = buildReportContext(enrichment);

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
