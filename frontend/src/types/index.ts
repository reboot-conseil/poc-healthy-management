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
  issues: string[];
}

export interface ReportContent {
  utterances: ReportUtterance[];
  improvement_axes: string[];
  synthesis: string | null;
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
