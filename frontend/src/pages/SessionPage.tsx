import { useState, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Upload, ArrowLeft, AlertCircle, FileAudio, X, Loader2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Progress } from '../components/ui/progress';
import { api } from '../api/client';
import { cn } from '../lib/utils';

type UploadPhase = 'idle' | 'uploading' | 'processing' | 'done' | 'error';

export function SessionPage() {
  const navigate = useNavigate();

  const [sessionTitle, setSessionTitle] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [phaseError, setPhaseError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

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

  const handleSubmit = async () => {
    if (!selectedFile) return;
    setPhaseError(null);

    try {
      const title = sessionTitle.trim() || selectedFile.name.replace(/\.[^.]+$/, '');
      const session = await api.createSession(title);

      setUploadPhase('uploading');
      setUploadProgress(0);

      await api.uploadAudio(session.id, selectedFile, setUploadProgress);
      setUploadPhase('processing');
      pollForCompletion(session.id);
    } catch (err) {
      setUploadPhase('error');
      setPhaseError(err instanceof Error ? err.message : 'Erreur lors de l\'envoi');
    }
  };

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

        {/* Drop zone */}
        {isIdle && (
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

        {/* Submit */}
        {isIdle && (
          <div className="flex justify-end fade-in">
            <Button
              size="lg"
              className="gap-2"
              disabled={!selectedFile}
              onClick={() => void handleSubmit()}
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
