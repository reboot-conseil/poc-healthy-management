/**
 * Streams microphone audio to the Gemini Live backend relay and plays
 * the AI audio responses. Designed to run for the full duration of a
 * recording session.
 *
 * Input PCM:  16-bit signed, mono, 16 000 Hz  (browser → backend → Gemini)
 * Output PCM: 16-bit signed, mono, 24 000 Hz  (Gemini → backend → browser)
 */

import { useState, useEffect, useRef } from 'react';

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000';
const WS_URL = API_URL.replace(/^http/, 'ws') + '/api/tts/live';

const CAPTURE_RATE = 16_000;
const PLAYBACK_RATE = 24_000;
const BUFFER_SIZE = 4096;

function float32ToInt16B64(f32: Float32Array): string {
  const int16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    int16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32768));
  }
  let binary = '';
  const bytes = new Uint8Array(int16.buffer);
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function pcm16B64ToFloat32(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const int16 = new Int16Array(bytes.buffer);
  const f32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;
  return f32;
}

async function playChunks(chunks: Float32Array[]): Promise<void> {
  if (chunks.length === 0) return;
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const pcm = new Float32Array(total);
  let off = 0;
  for (const c of chunks) { pcm.set(c, off); off += c.length; }

  const ctx = new AudioContext({ sampleRate: PLAYBACK_RATE });
  await ctx.resume();
  const buf = ctx.createBuffer(1, pcm.length, PLAYBACK_RATE);
  buf.copyToChannel(pcm, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  await new Promise<void>((res) => {
    src.onended = () => { void ctx.close(); res(); };
    src.start();
  });
}

export interface GeminiLiveState {
  isListening: boolean;
  isSpeaking: boolean;
}

export function useGeminiLive(active: boolean, stepContext: string = ''): GeminiLiveState {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Keep a ref to the current isSpeaking setter so the ws.onmessage closure
  // can update it without going stale.
  const pendingChunksRef = useRef<Float32Array[]>([]);
  const isSpeakingRef = useRef(false);
  // Store the WebSocket in a ref so the stepContext effect can access it
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!active) return;

    let ws: WebSocket | null = null;
    let captureCtx: AudioContext | null = null;
    let processor: ScriptProcessorNode | null = null;
    let stream: MediaStream | null = null;
    let cancelled = false;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch {
        return; // mic permission denied or already in use
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!stream) return;
        setIsListening(true);

        // Capture PCM at 16 kHz and stream to the relay
        captureCtx = new AudioContext({ sampleRate: CAPTURE_RATE });
        const source = captureCtx.createMediaStreamSource(stream);
        processor = captureCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);

        processor.onaudioprocess = (e) => {
          if (ws?.readyState !== WebSocket.OPEN) return;
          const f32 = e.inputBuffer.getChannelData(0);
          ws.send(JSON.stringify({ type: 'audio', data: float32ToInt16B64(new Float32Array(f32)) }));
        };

        // Route through a silent gain so the ScriptProcessorNode fires
        // without feeding mic audio back through the speakers
        const silent = captureCtx.createGain();
        silent.gain.value = 0;
        source.connect(processor);
        processor.connect(silent);
        silent.connect(captureCtx.destination);
      };

      ws.onmessage = (e: MessageEvent<string>) => {
        const msg = JSON.parse(e.data) as
          | { type: 'audio'; data: string }
          | { type: 'turn_complete' }
          | { type: 'error'; message: string };

        if (msg.type === 'audio') {
          pendingChunksRef.current.push(pcm16B64ToFloat32(msg.data));
        } else if (msg.type === 'turn_complete') {
          const chunks = pendingChunksRef.current;
          pendingChunksRef.current = [];
          if (chunks.length === 0) return;

          isSpeakingRef.current = true;
          setIsSpeaking(true);
          void playChunks(chunks).finally(() => {
            isSpeakingRef.current = false;
            setIsSpeaking(false);
          });
        } else if (msg.type === 'error') {
          console.error('[GeminiLive] relay error:', msg.message);
        }
      };

      ws.onclose = () => {
        setIsListening(false);
        processor?.disconnect();
        captureCtx?.close().catch(() => undefined);
        stream?.getTracks().forEach((t) => t.stop());
      };

      ws.onerror = () => {
        console.error('[GeminiLive] WebSocket error');
      };
    }

    void start();

    return () => {
      cancelled = true;
      ws?.close();
      wsRef.current = null;
      processor?.disconnect();
      captureCtx?.close().catch(() => undefined);
      stream?.getTracks().forEach((t) => t.stop());
      setIsListening(false);
      setIsSpeaking(false);
      pendingChunksRef.current = [];
    };
  }, [active]);

  // Send context message to Gemini when the current step changes
  useEffect(() => {
    if (!stepContext) return;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'context', message: 'CONTEXTE: ' + stepContext }));
    }
  }, [stepContext]);

  return { isListening, isSpeaking };
}
