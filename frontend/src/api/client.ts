import type { Session, Report } from '../types';

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => 'Unknown error');
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getSessions: (): Promise<Session[]> => request<Session[]>('/sessions'),

  createSession: (title: string): Promise<Session> =>
    request<Session>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),

  getSession: (sessionId: string): Promise<Session> =>
    request<Session>(`/sessions/${sessionId}`),

  uploadAudio: (
    sessionId: string,
    audioBlob: Blob,
    onProgress?: (pct: number) => void,
  ): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');

      const xhr = new XMLHttpRequest();

      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed: ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.open('POST', `${BASE_URL}/sessions/${sessionId}/audio`);
      xhr.send(formData);
    }),

  getReport: (sessionId: string): Promise<Report> =>
    request<Report>(`/reports/${sessionId}`),
};
