import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Upload, ArrowLeft, AlertCircle, FileAudio, X, Loader2, Mic } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Progress } from '../components/ui/progress';
import { api } from '../api/client';
import { DEFAULT_SCRIPT } from '../data/workathon-script';
import { cn } from '../lib/utils';
import type { Script } from '../types';

type UploadPhase = 'idle' | 'uploading' | 'processing' | 'done' | 'error';
type SourceMode = 'file' | 'record';

export function SessionPage() {
  const navigate = useNavigate();
  const { id: sessionId } = useParams<{ id?: string }>();

  const [sessionTitle, setSessionTitle] = useState('');
  const [speakersExpected, setSpeakersExpected] = useState<number | undefined>(undefined);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [phaseError, setPhaseError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [sourceMode, setSourceMode] = useState<SourceMode>('file');

  const [savedScripts, setSavedScripts] = useState<Script[]>([]);
  const [selectedScript, setSelectedScript] = useState<Script | null>(null);

  useEffect(() => {
    api.listScripts()
      .then(setSavedScripts)
      .catch(() => undefined);
  }, []);

  const activeSteps = selectedScript
    ? selectedScript.steps.map((s, i) => ({ id: String(i), title: s.title, description: s.description, duration: s.duration }))
    : DEFAULT_SCRIPT;

  const [isStarting, setIsStarting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pollForCompletion = useCallback(
    (sid: string) => {
      const interval = setInterval(() => {
        api
          .getSession(sid)
          .then((session) => {
            if (session.status === 'done') {
              clearInterval(interval);
              setUploadPhase('done');
              setTimeout(() => void navigate(`/report/${sid}`), 1200);
            } else if (session.status === 'error') {
              clearInterval(interval);
              setUploadPhase('error');
              setPhaseError('Le traitement a échoué côté serveur.');
            }
          })
          .catch(() => undefined);
      }, 3000);
    },
    [navigate],
  );

  // When navigating to an existing session (e.g. a "processing" session from the list)
  useEffect(() => {
    if (!sessionId) return;
    api.getSession(sessionId).then((session) => {
      if (session.status === 'done') {
        void navigate(`/report/${session.id}`, { replace: true });
      } else if (session.status === 'processing') {
        setUploadPhase('processing');
        pollForCompletion(session.id);
      } else if (session.status === 'error') {
        setUploadPhase('error');
        setPhaseError('Le traitement a échoué côté serveur.');
      }
      // 'recording' status: nothing special — leave as idle (edge case)
    }).catch(() => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const handleSubmit = useCallback(
    async (audioSource: Blob | File) => {
      setPhaseError(null);

      try {
        const title =
          sessionTitle.trim() ||
          (audioSource instanceof File
            ? audioSource.name.replace(/\.[^.]+$/, '')
            : `Session ${new Date().toLocaleString('fr-FR')}`);
        const session = await api.createSession(title);

        setUploadPhase('uploading');
        setUploadProgress(0);

        await api.uploadAudio(session.id, audioSource, setUploadProgress, speakersExpected);
        setUploadPhase('processing');
        pollForCompletion(session.id);
      } catch (err) {
        setUploadPhase('error');
        setPhaseError(err instanceof Error ? err.message : "Erreur lors de l'envoi");
      }
    },
    [sessionTitle, pollForCompletion],
  );

  const handleStartLive = useCallback(async () => {
    setIsStarting(true);
    setPhaseError(null);
    try {
      const title = sessionTitle.trim() || `Session ${new Date().toLocaleString('fr-FR')}`;
      const session = await api.createSession(title);
      navigate(`/session/live/${session.id}`, { state: { selectedScript, speakersExpected } });
    } catch {
      setPhaseError('Impossible de créer la session.');
      setIsStarting(false);
    }
  }, [sessionTitle, selectedScript, speakersExpected, navigate]);

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    setPhaseError(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('audio/')) {
      handleFileSelect(file);
    }
  };

  const handleSwitchMode = (mode: SourceMode) => {
    if (uploadPhase !== 'idle') return;
    setSourceMode(mode);
    setSelectedFile(null);
    setPhaseError(null);
  };

  const isIdle = uploadPhase === 'idle';
  const showUpload = uploadPhase === 'uploading' || uploadPhase === 'processing';

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h1 className="font-display font-semibold text-foreground text-sm">
            Nouvelle session
          </h1>
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-10 flex flex-col gap-6">
        {/* Title */}
        {isIdle && (
          <div className="fade-in">
            <label className="block text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2.5">
              Titre de la session
            </label>
            <input
              type="text"
              value={sessionTitle}
              onChange={(e) => setSessionTitle(e.target.value)}
              placeholder="Ex. Réunion équipe produit — Sprint 12"
              className="w-full bg-card border border-border rounded-md px-4 py-3 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring text-sm transition-colors"
            />
          </div>
        )}

        {/* Speakers count */}
        {isIdle && (
          <div className="fade-in">
            <label className="block text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2.5">
              Nombre de participants <span className="normal-case tracking-normal opacity-60">(optionnel)</span>
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={speakersExpected ?? ''}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setSpeakersExpected(isNaN(v) || v < 1 ? undefined : v);
              }}
              placeholder="Ex. 4"
              className="w-32 bg-card border border-border rounded-md px-4 py-3 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring text-sm transition-colors"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Améliore la précision de la diarisation si le nombre est connu.
            </p>
          </div>
        )}

        {/* Script selector */}
        {isIdle && (
          <div className="fade-in">
            <div className="flex items-center justify-between mb-2.5">
              <label className="block text-xs font-mono text-muted-foreground uppercase tracking-widest">
                Script workathon
              </label>
              <Link
                to="/scripts"
                className="text-xs text-primary hover:text-primary/80 transition-colors font-mono"
              >
                Gérer les scripts →
              </Link>
            </div>
            <select
              value={selectedScript?.id ?? ''}
              onChange={(e) => {
                const found = savedScripts.find((s) => s.id === e.target.value) ?? null;
                setSelectedScript(found);
              }}
              className="w-full bg-card border border-border rounded-md px-4 py-3 text-foreground focus:outline-none focus:ring-1 focus:ring-ring text-sm transition-colors appearance-none cursor-pointer"
            >
              <option value="">Script par défaut</option>
              {savedScripts.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
          </div>
        )}

        {/* Source mode toggle */}
        {isIdle && (
          <div className="flex rounded-lg border border-border bg-card p-1 gap-1 fade-in">
            <button
              className={cn(
                'flex-1 flex items-center justify-center gap-2 rounded-md px-4 py-2 text-xs font-medium transition-colors',
                sourceMode === 'file'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => handleSwitchMode('file')}
            >
              <Upload className="w-3.5 h-3.5" />
              Fichier audio
            </button>
            <button
              className={cn(
                'flex-1 flex items-center justify-center gap-2 rounded-md px-4 py-2 text-xs font-medium transition-colors',
                sourceMode === 'record'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => handleSwitchMode('record')}
            >
              <Mic className="w-3.5 h-3.5" />
              Enregistrement direct
            </button>
          </div>
        )}

        {/* Drop zone — file mode */}
        {isIdle && sourceMode === 'file' && (
          <div
            className={cn(
              'relative rounded-xl border-2 border-dashed transition-all duration-200 cursor-pointer',
              dragOver
                ? 'border-primary bg-primary/5'
                : selectedFile
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border bg-card hover:border-primary/30 hover:bg-secondary/30',
            )}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
              }}
            />

            <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
              {selectedFile ? (
                <>
                  <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                    <FileAudio className="w-6 h-6 text-primary" />
                  </div>
                  <p className="font-display font-semibold text-foreground text-sm mb-1">
                    {selectedFile.name}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {(selectedFile.size / (1024 * 1024)).toFixed(1)} Mo
                  </p>
                  <button
                    className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}
                  >
                    <X className="w-3 h-3" />
                    Changer de fichier
                  </button>
                </>
              ) : (
                <>
                  <div className="w-12 h-12 rounded-xl bg-secondary border border-border flex items-center justify-center mb-4">
                    <Upload className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <p className="font-display font-semibold text-foreground text-sm mb-1">
                    Déposer un fichier audio
                  </p>
                  <p className="text-xs text-muted-foreground">
                    ou <span className="text-primary underline underline-offset-2">parcourir</span>
                    {' '}· MP3, WAV, WebM, M4A, OGG…
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {/* Record mode — launch live session */}
        {isIdle && sourceMode === 'record' && (
          <div className="flex flex-col gap-4 fade-in">
            {/* Script preview */}
            <div className="rounded-xl border border-border bg-card p-5">
              <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-3">
                Script workathon
              </p>
              <div className="space-y-1.5">
                {activeSteps.map((step, i) => (
                  <div key={step.id} className="flex items-center gap-2.5">
                    <div className={cn(
                      'w-1.5 h-1.5 rounded-full shrink-0',
                      i === 0 ? 'bg-primary' : 'bg-border',
                    )} />
                    <span className={cn(
                      'text-xs font-mono',
                      i === 0 ? 'text-foreground' : 'text-muted-foreground',
                    )}>
                      {step.title}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground ml-auto">
                      {step.duration} min
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                size="lg"
                className="gap-2 rounded-full px-8"
                disabled={isStarting}
                onClick={() => void handleStartLive()}
              >
                {isStarting
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Mic className="w-4 h-4" />}
                {isStarting ? 'Démarrage...' : 'Démarrer la session'}
              </Button>
            </div>
          </div>
        )}

        {/* Submit — file mode only */}
        {isIdle && sourceMode === 'file' && (
          <div className="flex justify-end fade-in">
            <Button
              size="lg"
              className="gap-2"
              disabled={!selectedFile}
              onClick={() => selectedFile && void handleSubmit(selectedFile)}
            >
              <Upload className="w-4 h-4" />
              Envoyer et analyser
            </Button>
          </div>
        )}

        {/* Upload / processing progress */}
        {showUpload && (
          <div className="space-y-4 fade-in">
            <div className="flex items-center gap-3 text-sm">
              <Upload
                className={cn(
                  'w-4 h-4 shrink-0',
                  uploadPhase === 'processing' ? 'text-amber-400' : 'text-primary',
                )}
              />
              <span className="text-foreground font-medium">
                {uploadPhase === 'uploading' ? 'Envoi du fichier audio...' : 'Analyse en cours...'}
              </span>
              {uploadPhase === 'uploading' && (
                <span className="ml-auto font-mono text-muted-foreground text-xs tabular-nums">
                  {uploadProgress}%
                </span>
              )}
            </div>
            <Progress
              value={uploadPhase === 'uploading' ? uploadProgress : 100}
              className={cn(uploadPhase === 'processing' && 'animate-pulse')}
            />
            {uploadPhase === 'processing' && (
              <p className="text-xs text-muted-foreground text-center font-mono">
                Transcription · diarisation · analyse — 1 à 3 min selon la durée
              </p>
            )}
          </div>
        )}

        {/* Done */}
        {uploadPhase === 'done' && (
          <div className="flex items-center justify-center gap-2 text-emerald-400 font-display font-semibold text-sm fade-in">
            <Loader2 className="w-4 h-4 animate-spin" />
            Analyse terminée · Redirection vers le rapport...
          </div>
        )}

        {/* Error */}
        {phaseError && (
          <div className="flex items-center gap-3 p-4 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-sm fade-in">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{phaseError}</span>
          </div>
        )}
      </main>
    </div>
  );
}
