import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import {
  Square,
  ChevronLeft,
  ChevronRight,
  Volume2,
  Mic,
  MicOff,
} from "lucide-react";
import { Fit, Alignment } from "@rive-app/react-webgl2";
import {
  MascotProvider,
  MascotClient,
  MascotRive,
  useMascotElevenlabs,
} from "@mascotbot-sdk/react";
import { useConversation } from "@elevenlabs/react";
import { Button } from "../components/ui/button";
import { Progress } from "../components/ui/progress";
import { useAudioRecorder } from "../hooks/useAudioRecorder";
import { useWorkathonScript } from "../hooks/useWorkathonScript";
import { DEFAULT_SCRIPT } from "../data/workathon-script";
import { api } from "../api/client";
import { cn } from "../lib/utils";
import type { Script } from "../types";

const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:8000";

// Ready-to-use mascots from Mascotbot (artboard: "Character", stateMachine: "InLesson")
const MASCOTS = {
  cat: "https://public.rive.app/hosted/106041/222767/2WlNCtyAIEKLm40oETDgww.riv",
  panda:
    "https://public.rive.app/hosted/106041/222778/AP6PmFlQNUG2SvG9gOayYA.riv",
  girl: "https://public.rive.app/hosted/106041/222777/R0TZhDVxmUesz_TeaXz91Q.riv",
  robot:
    "https://public.rive.app/hosted/106041/222772/P9iEkcSAxkGRzSWx9rq-7g.riv",
  workingGirl: "/working-girl.riv",
} as const;

const MASCOT_SRC = MASCOTS.workingGirl;

type UploadPhase = "idle" | "uploading" | "processing" | "error";

// ─── Inner component — needs to be inside MascotProvider + MascotClient ───────

function LiveSessionContent() {
  const { id: sessionId } = useParams<{ id: string }>();
  const { state } = useLocation();
  const navigate = useNavigate();

  const { selectedScript, speakersExpected } = (state ?? {}) as {
    selectedScript?: Script;
    speakersExpected?: number;
  };

  const activeSteps = useMemo(
    () =>
      selectedScript
        ? selectedScript.steps.map((s, i) => ({
            id: String(i),
            title: s.title,
            description: s.description,
            duration: s.duration,
          }))
        : DEFAULT_SCRIPT,
    [selectedScript]
  );

  const recorder = useAudioRecorder();
  // silent=true: ElevenLabs handles all speech, no need for the TTS fallback
  const script = useWorkathonScript(
    activeSteps,
    recorder.status === "recording",
    true
  );

  // ── ElevenLabs state ───────────────────────────────────────────────────────
  const [isMuted, setIsMuted] = useState(false);
  const [cachedUrl, setCachedUrl] = useState<string | null>(null);

  // Natural lip sync settings — memoized for stable reference
  const naturalLipSyncConfig = useMemo(
    () => ({
      minVisemeInterval: 40,
      mergeWindow: 60,
      keyVisemePreference: 0.6,
      preserveSilence: true,
      similarityThreshold: 0.4,
      preserveCriticalVisemes: true,
      criticalVisemeMinDuration: 80,
    }),
    []
  );

  // ElevenLabs conversation hook — handles WebSocket, audio capture, and playback
  const conversation = useConversation({
    micMuted: isMuted,
    onConnect: () => console.log("[ElevenLabs] connected"),
    onDisconnect: () => console.log("[ElevenLabs] disconnected"),
    onError: (error) => console.error("[ElevenLabs] error:", error),
    onMessage: () => {},
    onDebug: () => {},
  });

  // Mascot SDK — intercepts ElevenLabs stream for lip-sync + avatar animation
  const { isIntercepting } = useMascotElevenlabs({
    conversation,
    gesture: true,
    naturalLipSync: true,
    naturalLipSyncConfig,
  });

  // ── Script dynamic variables — built once from activeSteps ───────────────
  const scriptDynamicVariables = useMemo(() => {
    // steps_summary: titles + durations only — descriptions are sent per-step
    // via sendContextualUpdate to avoid hitting ElevenLabs variable size limits.
    const stepsSummary = activeSteps
      .map((s, i) => `${i + 1}. ${s.title} (${s.duration} min)`)
      .join("\n");
    const totalDuration = activeSteps.reduce((acc, s) => acc + s.duration, 0);
    return {
      step_count: String(activeSteps.length),
      total_duration: `${totalDuration} min`,
      steps_summary: stepsSummary,
      current_step_title: activeSteps[0]?.title ?? "",
    };
  }, [activeSteps]);

  // ── Signed URL fetch (pre-fetched and refreshed every 9 min) ──────────────
  const fetchSignedUrl = useCallback(
    async (dynamicVariables = scriptDynamicVariables) => {
      try {
        const res = await fetch(`${API_URL}/api/elevenlabs/signed-url`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
          },
          body: JSON.stringify({ dynamic_variables: dynamicVariables }),
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`Signed URL fetch failed: ${res.status}`);
        const data = (await res.json()) as { signedUrl: string };
        setCachedUrl(data.signedUrl);
        return data.signedUrl;
      } catch (err) {
        console.error("Signed URL fetch error:", err);
        setCachedUrl(null);
        return null;
      }
    },
    [scriptDynamicVariables]
  );

  useEffect(() => {
    void fetchSignedUrl();
    const interval = setInterval(() => void fetchSignedUrl(), 9 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchSignedUrl]);

  // ── Session start / stop ───────────────────────────────────────────────────
  const [hasStarted, setHasStarted] = useState(false);

  const connect = useCallback(async () => {
    const signedUrl = cachedUrl ?? (await fetchSignedUrl());
    if (!signedUrl) throw new Error("No signed URL available");
    // dynamicVariables are sent via the WebSocket initiation — this is the
    // correct channel for ElevenLabs to resolve {{placeholders}} in the
    // system prompt. The signed URL is auth-only and does not carry variables.
    await conversation.startSession({
      signedUrl,
      dynamicVariables: scriptDynamicVariables,
    });
  }, [conversation, cachedUrl, fetchSignedUrl, scriptDynamicVariables]);

  const disconnect = useCallback(async () => {
    await conversation.endSession();
  }, [conversation]);

  // Track whether a session was actually started — guards the unmount cleanup
  // against React StrictMode's double-invoke, which would call endSession()
  // on an unstarted session and corrupt useConversation's internal state.
  const sessionStartedRef = useRef(false);

  const handleStart = useCallback(() => {
    setHasStarted(true);
    sessionStartedRef.current = true;
    void recorder.start();
    void connect();
  }, [recorder, connect]);

  useEffect(() => {
    return () => {
      if (sessionStartedRef.current) {
        void conversation.endSession();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  // ── AI proactive speech — trigger markers ────────────────────────────────
  // The ElevenLabs agent is instructed in its system prompt to:
  //   [DÉBUT_ÉTAPE_N] → immediately introduce step N to participants
  //   [FIN_SESSION]   → close the session and say goodbye
  //
  // Step 0 is handled by the agent's "first_message" (configured in the
  // ElevenLabs dashboard), which fires automatically on connection and uses
  // the {{current_step_title}} / {{current_step_description}} dynamic variables.
  //
  // sendContextualUpdate injects context silently (no response triggered).
  // sendUserMessage triggers an agent response — used for the proactive intros.

  // 2. On step change (steps 2+) — update context and introduce new step
  const prevStepIndexRef = useRef<number>(0);
  useEffect(() => {
    const step = activeSteps[script.stepIndex];
    if (
      script.stepIndex === 0 ||
      script.stepIndex === prevStepIndexRef.current ||
      conversation.status !== "connected" ||
      !step
    )
      return;

    prevStepIndexRef.current = script.stepIndex;

    conversation.sendContextualUpdate(
      `Étape ${script.stepIndex + 1}/${script.totalSteps} : "${step.title}"\n` +
      `Objectif : ${step.description}\nDurée : ${step.duration} min.`
    );
    conversation.sendUserMessage(`[DÉBUT_ÉTAPE_${script.stepIndex + 1}]`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script.stepIndex, conversation.status]);

  // 3. Last step timer expired — close the session
  const goodbyeTriggeredRef = useRef(false);
  useEffect(() => {
    if (
      !script.isLast ||
      script.secondsLeft > 0 ||
      conversation.status !== "connected" ||
      goodbyeTriggeredRef.current
    )
      return;

    goodbyeTriggeredRef.current = true;
    conversation.sendUserMessage("[FIN_SESSION]");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script.isLast, script.secondsLeft, conversation.status]);

  // ── Upload flow ────────────────────────────────────────────────────────────
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const uploadedRef = useRef(false);

  const pollForCompletion = useCallback(
    (sid: string) => {
      const interval = setInterval(() => {
        api
          .getSession(sid)
          .then((s) => {
            if (s.status === "done") {
              clearInterval(interval);
              void navigate(`/report/${sid}`);
            } else if (s.status === "error") {
              clearInterval(interval);
              setUploadPhase("error");
            }
          })
          .catch(() => undefined);
      }, 3000);
    },
    [navigate]
  );

  useEffect(() => {
    if (
      recorder.status !== "stopped" ||
      !recorder.audioBlob ||
      !sessionId ||
      uploadedRef.current
    )
      return;
    uploadedRef.current = true;
    setUploadPhase("uploading");
    api
      .uploadAudio(sessionId, recorder.audioBlob, () => {}, speakersExpected)
      .then(() => {
        setUploadPhase("processing");
        pollForCompletion(sessionId);
      })
      .catch(() => setUploadPhase("error"));
  }, [
    recorder.status,
    recorder.audioBlob,
    sessionId,
    speakersExpected,
    pollForCompletion,
  ]);

  const handleStop = () => {
    void disconnect();
    recorder.stop();
  };

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  const sessionStatus = conversation.status; // "connected" | "connecting" | "disconnected" | "disconnecting"

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Avatar */}
      <div
        className="relative flex-1 min-h-0"
        style={{
          background:
            "radial-gradient(ellipse at center top, #1a1f2e 0%, #0f1419 70%)",
        }}
      >
        <MascotRive />

        {/* Start overlay — user gesture required to unlock AudioContext */}
        {!hasStarted && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm z-10">
            <Button
              size="lg"
              className="gap-2 rounded-full px-8 text-base shadow-lg"
              onClick={handleStart}
            >
              Démarrer la session
            </Button>
          </div>
        )}

        {/* Status overlay */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none">
          <div
            className={cn(
              "flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded-full backdrop-blur-sm transition-all duration-300",
              isIntercepting
                ? "bg-primary/15 text-primary border border-primary/20"
                : sessionStatus === "connected"
                ? "bg-black/30 text-muted-foreground border border-white/5"
                : "bg-black/20 text-muted-foreground/50 border border-white/5"
            )}
          >
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                isIntercepting
                  ? "bg-primary animate-pulse"
                  : sessionStatus === "connected"
                  ? "bg-green-500 animate-pulse"
                  : sessionStatus === "connecting"
                  ? "bg-yellow-500 animate-pulse"
                  : "bg-muted-foreground/30"
              )}
            />
            {isIntercepting
              ? "IA en train de répondre…"
              : sessionStatus === "connected"
              ? "IA à l'écoute"
              : sessionStatus === "connecting"
              ? "Connexion…"
              : "IA non connectée"}
          </div>
        </div>
      </div>

      {/* Bottom panel */}
      {uploadPhase === "idle" && (
        <div
          className="border-t border-border bg-card flex flex-col shrink-0"
          style={{ maxHeight: "38vh" }}
        >
          <div className="flex-1 overflow-y-auto">
            <div className="px-5 pt-4 pb-3 border-b border-border">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
                  Script workathon
                </p>
                <div className="flex items-center gap-3">
                  {script.currentStep && script.isSpeaking && (
                    <Volume2 className="w-3.5 h-3.5 text-primary animate-pulse" />
                  )}
                  <span className="text-xs font-mono text-muted-foreground">
                    {script.stepIndex + 1} / {script.totalSteps}
                  </span>
                </div>
              </div>
              <div className="flex gap-1">
                {activeSteps.map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      "h-0.5 flex-1 rounded-full transition-colors duration-300",
                      i < script.stepIndex
                        ? "bg-primary/50"
                        : i === script.stepIndex
                        ? "bg-primary"
                        : "bg-border"
                    )}
                  />
                ))}
              </div>
            </div>

            <div className="px-5 py-4 flex flex-col gap-3">
              <h3 className="font-display font-bold text-foreground text-sm leading-tight">
                {script.currentStep?.title}
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {script.currentStep?.description}
              </p>

              {recorder.status === "recording" && (
                <div>
                  <div className="flex items-end justify-between mb-1">
                    <span className="text-xs font-mono text-muted-foreground">
                      Temps restant
                    </span>
                    <span
                      className={cn(
                        "font-mono text-base tabular-nums font-semibold",
                        script.secondsLeft <= 60
                          ? "text-amber-400"
                          : "text-foreground"
                      )}
                    >
                      {String(Math.floor(script.secondsLeft / 60)).padStart(
                        2,
                        "0"
                      )}
                      :{String(script.secondsLeft % 60).padStart(2, "0")}
                    </span>
                  </div>
                  <Progress
                    value={
                      (((script.currentStep?.duration ?? 1) * 60 -
                        script.secondsLeft) /
                        ((script.currentStep?.duration ?? 1) * 60)) *
                      100
                    }
                    className={cn(
                      script.secondsLeft <= 60 && "[&>div]:bg-amber-400"
                    )}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="px-5 py-3 border-t border-border flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-muted-foreground h-8"
                disabled={script.stepIndex === 0}
                onClick={script.goToPrev}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Préc.
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-muted-foreground h-8"
                disabled={script.isLast}
                onClick={script.goToNext}
              >
                Suiv.
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm tabular-nums text-muted-foreground mr-2">
                {formatDuration(recorder.duration)}
              </span>
              {sessionStatus === "connected" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "gap-1 h-8",
                    isMuted
                      ? "text-amber-400 hover:text-amber-300"
                      : "text-muted-foreground"
                  )}
                  onClick={toggleMute}
                  title={isMuted ? "Activer le micro" : "Couper le micro"}
                >
                  {isMuted ? (
                    <MicOff className="w-3.5 h-3.5" />
                  ) : (
                    <Mic className="w-3.5 h-3.5" />
                  )}
                </Button>
              )}
              <Button
                variant="destructive"
                size="sm"
                className="gap-2 rounded-full px-5"
                onClick={handleStop}
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                Arrêter et envoyer
              </Button>
            </div>
          </div>
        </div>
      )}

      {(uploadPhase === "uploading" || uploadPhase === "processing") && (
        <div className="border-t border-border bg-card px-6 py-5 shrink-0 space-y-3 fade-in">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-foreground font-medium">
              {uploadPhase === "uploading"
                ? "Envoi de l'enregistrement..."
                : "Analyse en cours..."}
            </span>
          </div>
          <Progress
            value={uploadPhase === "uploading" ? undefined : 100}
            className={cn(uploadPhase === "processing" && "animate-pulse")}
          />
          {uploadPhase === "processing" && (
            <p className="text-xs text-muted-foreground font-mono">
              Transcription · diarisation · analyse — 1 à 3 min selon la durée
            </p>
          )}
        </div>
      )}

      {uploadPhase === "error" && (
        <div className="border-t border-border bg-card px-6 py-5 shrink-0 fade-in">
          <p className="text-sm text-destructive">
            Une erreur est survenue. Veuillez réessayer.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Page wrapper — provides Mascotbot context ────────────────────────────────

export function LiveSessionPage() {
  return (
    <MascotProvider>
      <MascotClient
        src={MASCOT_SRC}
        artboard="Character"
        inputs={["is_speaking", "gesture"]}
        layout={{ fit: Fit.Contain, alignment: Alignment.Center }}
      >
        <LiveSessionContent />
      </MascotClient>
    </MascotProvider>
  );
}
