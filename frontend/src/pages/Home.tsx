import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Mic, Clock, ChevronRight, Radio, AlertCircle, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { api } from '../api/client';
import { formatDate } from '../lib/utils';
import type { Session, SessionStatus } from '../types';

interface StatusConfig {
  label: string;
  variant: 'recording' | 'processing' | 'done' | 'error';
  icon: ReactNode;
}

const STATUS_CONFIG: Record<SessionStatus, StatusConfig> = {
  recording: {
    label: 'En cours',
    variant: 'recording',
    icon: <Radio className="w-3 h-3" />,
  },
  processing: {
    label: 'Traitement',
    variant: 'processing',
    icon: <Loader2 className="w-3 h-3 animate-spin" />,
  },
  done: {
    label: 'Terminé',
    variant: 'done',
    icon: null,
  },
  error: {
    label: 'Erreur',
    variant: 'error',
    icon: <AlertCircle className="w-3 h-3" />,
  },
};

export function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSessions()
      .then(setSessions)
      .catch((err: unknown) =>
        setFetchError(err instanceof Error ? err.message : 'Erreur de chargement'),
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b border-border">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Mic className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="font-display text-xs font-bold text-foreground uppercase tracking-widest">
                Healthy Management
              </p>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                Workathon · Captation & Analyse
              </p>
            </div>
          </div>
          <Link to="/session/new">
            <Button size="sm" className="gap-2">
              <Plus className="w-3.5 h-3.5" />
              Nouvelle session
            </Button>
          </Link>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-3xl mx-auto px-6 py-10">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground">Sessions</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {loading
                ? 'Chargement...'
                : sessions.length > 0
                  ? `${sessions.length} session${sessions.length > 1 ? 's' : ''}`
                  : 'Aucune session enregistrée'}
            </p>
          </div>
          {!loading && sessions.length > 0 && (
            <Link to="/session/new">
              <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
                <Plus className="w-3.5 h-3.5" />
                Nouvelle
              </Button>
            </Link>
          )}
        </div>

        {/* Loading skeletons */}
        {loading && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4 p-4 rounded-lg border border-border">
                <Skeleton className="h-9 w-9 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-44" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-5 w-20 rounded-sm" />
              </div>
            ))}
          </div>
        )}

        {/* Error state */}
        {fetchError && (
          <div className="flex items-center gap-3 p-4 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-sm fade-in">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{fetchError}</span>
          </div>
        )}

        {/* Empty state */}
        {!loading && !fetchError && sessions.length === 0 && (
          <div className="text-center py-24 fade-in">
            <div className="w-16 h-16 rounded-full bg-secondary/80 border border-border flex items-center justify-center mx-auto mb-5">
              <Mic className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="font-display text-lg font-semibold text-foreground mb-2">
              Aucune session
            </p>
            <p className="text-muted-foreground text-sm mb-8 max-w-xs mx-auto">
              Démarrez une captation pour commencer à transcrire et analyser vos échanges.
            </p>
            <Link to="/session/new">
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                Démarrer une session
              </Button>
            </Link>
          </div>
        )}

        {/* Session list */}
        {!loading && !fetchError && sessions.length > 0 && (
          <div className="space-y-2">
            {sessions.map((session, idx) => {
              const config = STATUS_CONFIG[session.status];
              const href =
                session.status === 'done' ? `/report/${session.id}` : `/session/${session.id}`;

              return (
                <Link
                  key={session.id}
                  to={href}
                  className="flex items-center gap-4 p-4 rounded-lg border border-border bg-card hover:bg-secondary/40 hover:border-primary/20 transition-all duration-200 group fade-in"
                  style={{ animationDelay: `${idx * 40}ms` }}
                >
                  <div className="w-9 h-9 rounded-md bg-secondary flex items-center justify-center shrink-0">
                    <Mic className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors duration-200" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-display font-semibold text-foreground text-sm truncate">
                      {session.title ?? `Session ${session.id.slice(0, 8)}`}
                    </p>
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono mt-0.5">
                      <Clock className="w-3 h-3" />
                      {formatDate(session.created_at)}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <Badge variant={config.variant} className="gap-1">
                      {config.icon}
                      {config.label}
                    </Badge>
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all duration-200" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
