export interface EnrichmentContext {
  // From job posting scraper
  job_title?: string;
  company?: string;
  company_description?: string;
  team_description?: string;
  seniority_level?: string;
  requirements?: string[];
  responsibilities?: string[];
  tech_stack?: string[];

  // From search + deep scrape
  interview_intel?: {
    questions: string[];
    process_details?: string;
    culture_notes?: string;
  };
}

export interface Session {
  id: string;
  job_title: string;
  company: string | null;
  job_url: string | null;
  enrichment_context: EnrichmentContext | null;
  user_context: string | null;
  interview_brief: string | null;
  status: "active" | "ended" | "report_ready";
  created_at: string;
  ended_at: string | null;
}

export interface Message {
  id: string;
  session_id: string;
  role: "system" | "user" | "assistant";
  content: string;
  created_at: string;
}

export interface Report {
  id: string;
  session_id: string;
  content: string;
  scores: Record<string, number> | null;
  created_at: string;
}

export interface CreateSessionBody {
  job_title?: string;
  company?: string;
  job_url?: string;
  user_context?: string;
}

export interface ChatBody {
  session_id: string;
  content: string;
}
