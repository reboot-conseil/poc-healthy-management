export type SessionStatus = 'recording' | 'processing' | 'done' | 'error';

export interface Session {
  id: string;
  title: string | null;
  status: SessionStatus;
  created_at: string;
  audio_path: string | null;
}

export interface Utterance {
  id: string;
  session_id: string;
  speaker: string;
  start_time: number;
  end_time: number;
  text: string;
  intention: string | null;
  sentiment: string | null;
  issues: Record<string, string> | null;
  created_at: string;
}

export interface ImprovementAxis {
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
}

export interface ReportContent {
  utterances: Utterance[];
  improvement_axes: ImprovementAxis[];
  summary: string | null;
}

export interface Report {
  id: string;
  session_id: string;
  content: ReportContent;
  created_at: string;
}
