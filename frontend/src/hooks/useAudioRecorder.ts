import { useState, useRef, useCallback, useEffect } from 'react';

export type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'stopped';

export interface AudioRecorderState {
  status: RecorderStatus;
  audioBlob: Blob | null;
  audioLevel: number;
  frequencyData: Readonly<number[]>;
  duration: number;
  isSilent: boolean;
  error: string | null;
}

export interface AudioRecorderActions {
  start: () => Promise<void>;
  stop: () => void;
  reset: () => void;
}

const SILENCE_THRESHOLD = 0.02;
const SILENCE_DELAY_MS = 2000;
const NUM_FREQ_BINS = 48;

export function useAudioRecorder(): AudioRecorderState & AudioRecorderActions {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [frequencyData, setFrequencyData] = useState<number[]>(
    Array(NUM_FREQ_BINS).fill(0) as number[],
  );
  const [duration, setDuration] = useState(0);
  const [isSilent, setIsSilent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const animFrameRef = useRef<number>(0);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef<number>(0);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
  }, []);

  const analyzeAudio = useCallback(() => {
    if (!analyserRef.current) return;

    const freqData = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(freqData);
    const step = Math.max(1, Math.floor(freqData.length / NUM_FREQ_BINS));
    const normalized = Array.from({ length: NUM_FREQ_BINS }, (_, i) =>
      (freqData[i * step] ?? 0) / 255,
    );
    setFrequencyData(normalized);

    const timeData = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteTimeDomainData(timeData);
    let sum = 0;
    for (const v of timeData) {
      const n = (v - 128) / 128;
      sum += n * n;
    }
    const rms = Math.sqrt(sum / timeData.length);
    setAudioLevel(Math.min(1, rms * 8));

    if (rms < SILENCE_THRESHOLD) {
      if (!silenceTimerRef.current) {
        silenceTimerRef.current = setTimeout(() => setIsSilent(true), SILENCE_DELAY_MS);
      }
    } else {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      setIsSilent(false);
    }

    animFrameRef.current = requestAnimationFrame(analyzeAudio);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setStatus('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 512;
      analyserRef.current.smoothingTimeConstant = 0.8;

      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);

      chunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      mediaRecorderRef.current = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        setAudioBlob(blob);
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorderRef.current.start(1000);
      startTimeRef.current = Date.now();
      setStatus('recording');

      durationTimerRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

      analyzeAudio();
    } catch (err) {
      setStatus('idle');
      setError(err instanceof Error ? err.message : 'Microphone access denied');
    }
  }, [analyzeAudio]);

  const stop = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    clearTimers();
    audioContextRef.current?.close().catch(() => undefined);
    setStatus('stopped');
    setAudioLevel(0);
    setFrequencyData(Array(NUM_FREQ_BINS).fill(0) as number[]);
    setIsSilent(false);
  }, [clearTimers]);

  const reset = useCallback(() => {
    stop();
    setStatus('idle');
    setAudioBlob(null);
    setAudioLevel(0);
    setFrequencyData(Array(NUM_FREQ_BINS).fill(0) as number[]);
    setDuration(0);
    setIsSilent(false);
    setError(null);
    chunksRef.current = [];
  }, [stop]);

  useEffect(() => {
    return () => {
      clearTimers();
      audioContextRef.current?.close().catch(() => undefined);
    };
  }, [clearTimers]);

  return {
    status,
    audioBlob,
    audioLevel,
    frequencyData,
    duration,
    isSilent,
    error,
    start,
    stop,
    reset,
  };
}
