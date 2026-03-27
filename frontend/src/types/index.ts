export type SessionStatus = 'recording' | 'processing' | 'done' | 'error';

export interface Session {
  id: string;
  title: string | null;
  status: SessionStatus;
  created_at: string;
  audio_path: string | null;
  speaker_names: Record<string, string> | null;
}

// Utterance row from the DB (used standalone if needed)
export interface Utterance {
  id: string;
  session_id: string;
  speaker: string;
  start_time: number;
  end_time: number;
  text: string;
  intention: string | null;
  sentiment: string | null;
  issues: string[];
  created_at: string;
}

// Utterance as embedded in the report content JSONB
export interface ReportUtterance {
  speaker: string;
  start: number;
  end: number;
  text: string;
  intention: string | null;
  sentiment: string | null;
  key_points: string[];
  issues: string[];
}

export interface ReportContent {
  utterances: ReportUtterance[];
  // Human/relational dimension
  synthesis_human: string | null;
  // Substantive content dimension (topics, decisions, ideas, next steps)
  synthesis_content: string | null;
  // Ordered list of key concrete topics raised in the session
  key_topics: string[];
  improvement_axes: string[];
  // Legacy field — present on reports generated before the dual-dimension update
  synthesis?: string | null;
}

export interface Report {
  report_id: string;
  session_id: string;
  content: ReportContent;
  speaker_names: Record<string, string> | null;
}

export interface ScriptStep {
  title: string;
  description: string;
  duration: number; // minutes
}

export interface Script {
  id: string;
  title: string;
  steps: ScriptStep[];
  created_at: string;
}
