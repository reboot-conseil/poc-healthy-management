import { useState, useEffect, useRef, useCallback } from 'react';
import type { WorkathonStep } from '../data/workathon-script';
import { speak, stopSpeaking } from '../lib/tts';

export interface WorkathonScriptState {
  stepIndex: number;
  currentStep: WorkathonStep | null;
  secondsLeft: number;
  totalSteps: number;
  isSpeaking: boolean;
  isLast: boolean;
  goToNext: () => void;
  goToPrev: () => void;
}

export function useWorkathonScript(
  steps: WorkathonStep[],
  active: boolean,
): WorkathonScriptState {
  const [stepIndex, setStepIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(steps[0]?.duration * 60 ?? 0);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Refs so interval callbacks always see the latest values without re-creating the interval
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const secondsRef = useRef(secondsLeft);
  const stepIndexRef = useRef(stepIndex);
  stepIndexRef.current = stepIndex;

  // startStepRef holds the latest version of startStep so the interval can call it
  // without capturing a stale closure
  const startStepRef = useRef<(index: number) => void>(() => undefined);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Keep startStepRef.current always up-to-date (called on every render, cheap)
  startStepRef.current = (index: number) => {
    const step = steps[index];
    if (!step) return;

    stopTimer();
    setStepIndex(index);
    stepIndexRef.current = index;

    const total = step.duration * 60;
    secondsRef.current = total;
    setSecondsLeft(total);

    setIsSpeaking(true);
    console.log('[Script] calling speak() for step:', step.title);
    void speak(step.description)
      .catch((err: unknown) => console.error('[TTS] speak failed:', err))
      .finally(() => setIsSpeaking(false));

    timerRef.current = setInterval(() => {
      secondsRef.current -= 1;
      setSecondsLeft(secondsRef.current);

      if (secondsRef.current <= 0) {
        stopTimer();
        const next = stepIndexRef.current + 1;
        if (next < steps.length) {
          startStepRef.current(next);
        }
      }
    }, 1000);
  };

  // Start on step 0 when recording becomes active; clean up when it stops
  useEffect(() => {
    if (active) {
      startStepRef.current(0);
    } else {
      stopTimer();
      stopSpeaking();
      setStepIndex(0);
      setSecondsLeft(steps[0]?.duration * 60 ?? 0);
      setIsSpeaking(false);
    }

    return () => {
      stopTimer();
      stopSpeaking();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const goToNext = useCallback(() => {
    startStepRef.current(stepIndexRef.current + 1);
  }, []);

  const goToPrev = useCallback(() => {
    startStepRef.current(Math.max(0, stepIndexRef.current - 1));
  }, []);

  return {
    stepIndex,
    currentStep: steps[stepIndex] ?? null,
    secondsLeft,
    totalSteps: steps.length,
    isSpeaking,
    isLast: stepIndex === steps.length - 1,
    goToNext,
    goToPrev,
  };
}
