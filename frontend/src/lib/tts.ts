/**
 * Text-to-speech via the backend Gemini Live relay.
 *
 * Opens a WebSocket to /api/tts/ws, sends the text, receives PCM audio chunks
 * as base64 JSON, then plays them via the Web Audio API.
 *
 * Falls back to the browser's Web Speech API if the backend is unreachable.
 */

const SAMPLE_RATE = 24_000; // Gemini Live: PCM signed-16-bit mono 24 kHz

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000';
const WS_URL = API_URL.replace(/^http/, 'ws') + '/api/tts/ws';

function pcm16ToFloat32(base64: string): Float32Array {
  const bin = atob(base64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const int16 = new Int16Array(bytes.buffer);
  const f32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;
  return f32;
}

async function speakRelay(text: string): Promise<void> {
  const audioChunks: Float32Array[] = [];

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => ws.send(JSON.stringify({ text }));

    ws.onmessage = (event: MessageEvent<string>) => {
      const msg = JSON.parse(event.data) as
        | { type: 'audio'; data: string }
        | { type: 'done' }
        | { type: 'error'; message: string };

      if (msg.type === 'audio') {
        audioChunks.push(pcm16ToFloat32(msg.data));
      } else if (msg.type === 'done') {
        ws.close();
        resolve();
      } else if (msg.type === 'error') {
        ws.close();
        reject(new Error(msg.message));
      }
    };

    ws.onerror = () => reject(new Error('WebSocket error'));
    ws.onclose = () => resolve(); // also resolve on normal close
  });

  if (audioChunks.length === 0) return;

  const total = audioChunks.reduce((n, c) => n + c.length, 0);
  const pcm = new Float32Array(total);
  let off = 0;
  for (const c of audioChunks) { pcm.set(c, off); off += c.length; }

  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  await ctx.resume();
  const buf = ctx.createBuffer(1, pcm.length, SAMPLE_RATE);
  buf.copyToChannel(pcm, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  await new Promise<void>((res) => {
    src.onended = () => { void ctx.close(); res(); };
    src.start();
  });
}

function speakBrowser(text: string): void {
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'fr-FR';
  const v = synth.getVoices().find((voice) => voice.lang.startsWith('fr'));
  if (v) u.voice = v;
  u.rate = 0.95;
  synth.speak(u);
}

export async function speak(text: string): Promise<void> {
  try {
    await speakRelay(text);
  } catch (err) {
    console.warn('[TTS] relay failed, falling back to browser Speech API:', err);
    speakBrowser(text);
  }
}

export function stopSpeaking(): void {
  window.speechSynthesis.cancel();
}
