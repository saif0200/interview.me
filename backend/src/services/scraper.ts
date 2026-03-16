import { env } from "../config/env.js";
import { openai } from "./llm.js";
import type { ScrapedContext } from "../types/index.js";

const MODEL = "glm-5";

export interface JinaResult {
  title: string;
  markdown: string;
  description: string;
}

/** Extract company name from a URL's hostname (e.g. "stripe.com" → "Stripe"). */
export function companyFromUrl(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");

    // Known job board domains — company isn't in the hostname
    const jobBoards = [
      "greenhouse.io", "lever.co", "workday.com", "myworkdayjobs.com",
      "smartrecruiters.com", "ashbyhq.com", "jobs.lever.co",
      "boards.greenhouse.io", "linkedin.com", "indeed.com",
      "glassdoor.com", "ziprecruiter.com", "angel.co", "wellfound.com",
      "ycombinator.com", "workatastartup.com",
    ];
    if (jobBoards.some((jb) => hostname === jb || hostname.endsWith(`.${jb}`))) {
      return null;
    }

    // For subdomains like "careers.stripe.com" or "jobs.netflix.com", use the main domain
    const parts = hostname.split(".");
    const domain = parts.length >= 2 ? parts[parts.length - 2] : parts[0];

    // Capitalize first letter
    return domain.charAt(0).toUpperCase() + domain.slice(1);
  } catch {
    return null;
  }
}

/** Fast fetch — returns page title + markdown without LLM. */
export async function fetchJobPage(url: string): Promise<JinaResult | null> {
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Return-Format": "markdown",
      "X-Remove-Selector": "nav, footer, .sidebar, .ads, .cookie-banner",
    };
    if (env.JINA_API_KEY) {
      headers["Authorization"] = `Bearer ${env.JINA_API_KEY}`;
    }

    const response = await fetch(`https://r.jina.ai/${url}`, { headers });
    if (!response.ok) {
      console.error(`[JINA] Returned ${response.status} for ${url}`);
      return null;
    }

    const json = await response.json() as {
      data?: { content?: string; title?: string; description?: string };
    };
    console.log(`[JINA] Response for ${url}: title="${json.data?.title || ""}" description="${(json.data?.description || "").slice(0, 100)}" content_length=${json.data?.content?.length || 0}`);

    const markdown = json.data?.content || "";
    const title = json.data?.title || "";
    const description = json.data?.description || "";

    // Even if markdown is thin, title + description can still be useful
    if (!markdown.trim() && !title.trim() && !description.trim()) {
      console.warn(`[JINA] No usable content returned for ${url}`);
      return null;
    }

    return {
      title,
      markdown: markdown.slice(0, 8000),
      description,
    };
  } catch (err) {
    console.error("[JINA] Fetch error:", err);
    return null;
  }
}

/** LLM extraction — parses structured fields from page content. */
export async function extractJobData(page: JinaResult, sourceUrl: string): Promise<ScrapedContext> {
  // Build the content to send to the LLM — combine all available info
  const contentParts: string[] = [];
  if (page.title) contentParts.push(`Page Title: ${page.title}`);
  if (page.description) contentParts.push(`Meta Description: ${page.description}`);
  if (page.markdown.trim()) contentParts.push(`Page Content:\n${page.markdown}`);
  const content = contentParts.join("\n\n");

  if (!content.trim()) {
    return { source_url: sourceUrl };
  }

  try {
    const extraction = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: `You are extracting structured data from a job posting page. The content may be noisy — focus on identifying job-specific information and ignore navigation, marketing copy, or unrelated content.

Return ONLY valid JSON with these fields:
{
  "job_title": "exact job title or null",
  "company": "company name or null",
  "company_description": "1-2 sentence summary of what the company does, from the posting itself — or null",
  "team_description": "1-2 sentence summary of the specific team/org this role sits in — or null",
  "seniority_level": "one of: intern, junior, mid, senior, staff, principal, manager, director, vp, executive — or null",
  "requirements": ["each qualification/requirement as a separate string"],
  "responsibilities": ["each responsibility/duty as a separate string"],
  "tech_stack": ["specific technologies, languages, frameworks, or tools mentioned"]
}

Guidelines:
- For company_description, use ONLY what the posting says about the company — do not invent or assume
- For team_description, look for "About the team" sections or similar context about the specific group
- For seniority_level, infer from the title and requirements (e.g. "10+ years" + "managing managers" = director-level)
- For requirements, include both hard skills and experience level requirements
- For tech_stack, only include specific named technologies (e.g. "Python", "Kubernetes"), not vague terms like "cloud" or "databases"
- If a field cannot be determined, use null for strings or [] for arrays`,
        },
        { role: "user", content },
      ],
      stream: false,
    });

    const llmContent = extraction.choices[0]?.message?.content || "{}";
    const jsonMatch = llmContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[SCRAPER] LLM returned no JSON block");
      return { raw_markdown: page.markdown, source_url: sourceUrl };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      job_title?: string;
      company?: string;
      company_description?: string;
      team_description?: string;
      seniority_level?: string;
      requirements?: string[];
      responsibilities?: string[];
      tech_stack?: string[];
    };

    console.log(`[SCRAPER] Extracted: title="${parsed.job_title || "—"}" company="${parsed.company || "—"}" seniority="${parsed.seniority_level || "—"}" requirements=${parsed.requirements?.length || 0} responsibilities=${parsed.responsibilities?.length || 0} tech_stack=${parsed.tech_stack?.length || 0}`);

    return {
      job_title: parsed.job_title || undefined,
      company: parsed.company || undefined,
      company_description: parsed.company_description || undefined,
      team_description: parsed.team_description || undefined,
      seniority_level: parsed.seniority_level || undefined,
      requirements: parsed.requirements || [],
      responsibilities: parsed.responsibilities || [],
      tech_stack: parsed.tech_stack || [],
      raw_markdown: page.markdown,
      source_url: sourceUrl,
    };
  } catch (err) {
    console.error("[SCRAPER] LLM extraction error:", err);
    return { raw_markdown: page.markdown, source_url: sourceUrl };
  }
}
