import { useState, useEffect, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, TrendingUp, AlertTriangle, Clock, ChevronDown } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Card, CardContent } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { api } from '../api/client';
import { formatTimestamp, cn } from '../lib/utils';
import type { Report, ReportUtterance } from '../types';

const SPEAKER_PALETTES = [
  { dot: 'bg-blue-400', label: 'text-blue-400', border: 'border-blue-500/30', bg: 'bg-blue-500/10' },
  { dot: 'bg-violet-400', label: 'text-violet-400', border: 'border-violet-500/30', bg: 'bg-violet-500/10' },
  { dot: 'bg-emerald-400', label: 'text-emerald-400', border: 'border-emerald-500/30', bg: 'bg-emerald-500/10' },
  { dot: 'bg-amber-400', label: 'text-amber-400', border: 'border-amber-500/30', bg: 'bg-amber-500/10' },
  { dot: 'bg-rose-400', label: 'text-rose-400', border: 'border-rose-500/30', bg: 'bg-rose-500/10' },
  { dot: 'bg-cyan-400', label: 'text-cyan-400', border: 'border-cyan-500/30', bg: 'bg-cyan-500/10' },
];

type Tab = 'report' | 'transcript';

const PRIORITY_ICONS = [
  <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />,
  <TrendingUp className="w-3.5 h-3.5 text-amber-400 shrink-0" />,
  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />,
];

function SentimentBadge({ sentiment }: { sentiment: string }) {
  const lower = sentiment.toLowerCase();
  if (lower.includes('positif') || lower.includes('positive') || lower.includes('positiv')) {
    return <Badge variant="success">{sentiment}</Badge>;
  }
  if (lower.includes('négatif') || lower.includes('negative') || lower.includes('negativ')) {
    return <Badge variant="destructive">{sentiment}</Badge>;
  }
  return <Badge variant="secondary">{sentiment}</Badge>;
}

interface UtteranceRowProps {
  utterance: ReportUtterance;
  idx: number;
  resolvedName: string;
  palette: typeof SPEAKER_PALETTES[number];
}

function UtteranceRow({ utterance, idx, resolvedName, palette }: UtteranceRowProps) {
  const avatar = resolvedName.slice(0, 2).toUpperCase();

  return (
    <div
      className="flex gap-4 group fade-in"
      style={{ animationDelay: `${Math.min(idx * 30, 300)}ms` }}
    >
      {/* Timeline */}
      <div className="flex flex-col items-center pt-0.5">
        <div
          className={cn(
            'w-7 h-7 rounded-md border text-xs font-mono font-bold flex items-center justify-center shrink-0',
            palette.label,
            palette.border,
            palette.bg,
          )}
        >
          {avatar}
        </div>
        <div className="w-px flex-1 bg-border/60 mt-2" />
      </div>

      {/* Content */}
      <div className="flex-1 pb-7 min-w-0">
        <div className="flex items-center gap-2.5 mb-2">
          <span className={cn('text-xs font-mono font-semibold', palette.label)}>
            {resolvedName}
          </span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground font-mono">
            <Clock className="w-3 h-3" />
            {formatTimestamp(utterance.start)}
            {' → '}
            {formatTimestamp(utterance.end)}
          </span>
        </div>

        <p className="text-sm text-foreground leading-relaxed mb-3">{utterance.text}</p>

        {(utterance.intention ?? utterance.sentiment) && (
          <div className="flex flex-wrap gap-1.5">
            {utterance.intention && (
              <Badge variant="default" className="text-xs">{utterance.intention}</Badge>
            )}
            {utterance.sentiment && <SentimentBadge sentiment={utterance.sentiment} />}
          </div>
        )}
      </div>
    </div>
  );
}

export function ReportPage() {
  const { session_id } = useParams<{ session_id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('report');
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});
  // Track whether names were loaded from DB so we don't trigger a save on initial load
  const namesLoadedRef = useRef(false);

  useEffect(() => {
    if (!session_id) return;
    api
      .getReport(session_id)
      .then((data) => {
        setReport(data);
        if (data.speaker_names) {
          namesLoadedRef.current = false; // prevent save trigger
          setSpeakerNames(data.speaker_names);
        }
      })
      .catch((err: unknown) =>
        setFetchError(err instanceof Error ? err.message : 'Erreur de chargement'),
      )
      .finally(() => {
        setLoading(false);
        namesLoadedRef.current = true;
      });
  }, [session_id]);

  // Debounced auto-save: persist names 800ms after the user stops typing
  useEffect(() => {
    if (!session_id || !namesLoadedRef.current) return;
    const timer = setTimeout(() => {
      api.updateSpeakerNames(session_id, speakerNames).catch(() => {
        // Silent fail — names will be re-entered next time if needed
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [speakerNames, session_id]);

  const originalLabels = useMemo(() => {
    if (!report) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const u of report.content.utterances) {
      if (!seen.has(u.speaker)) { seen.add(u.speaker); result.push(u.speaker); }
    }
    return result;
  }, [report]);

  const resolveName = (label: string) => speakerNames[label]?.trim() || label;

  const resolvedPaletteIndex = useMemo(() => {
    const map = new Map<string, number>();
    for (const label of originalLabels) {
      const name = resolveName(label);
      if (!map.has(name)) map.set(name, map.size);
    }
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalLabels, speakerNames]);

  const getPalette = (label: string) => {
    const name = resolveName(label);
    const idx = resolvedPaletteIndex.get(name) ?? 0;
    return SPEAKER_PALETTES[idx % SPEAKER_PALETTES.length];
  };

  const mergeGroups = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const label of originalLabels) {
      const name = resolveName(label);
      const existing = groups.get(name) ?? [];
      groups.set(name, [...existing, label]);
    }
    return groups;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalLabels, speakerNames]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'report', label: 'Rapport' },
    { id: 'transcript', label: 'Transcription' },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Sticky header */}
      <header className="border-b border-border sticky top-0 bg-background/90 backdrop-blur-sm z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="font-display font-semibold text-sm text-foreground">
              Rapport d'analyse
            </h1>
            {report && (
              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                {report.content.utterances.length} interventions
              </p>
            )}
          </div>

          {/* Tab switcher */}
          {report && (
            <div className="flex rounded-lg border border-border bg-card p-0.5 gap-0.5">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                    activeTab === tab.id
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        {/* Loading state */}
        {loading && (
          <div className="space-y-7">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex gap-4">
                <Skeleton className="w-7 h-7 rounded-md shrink-0" />
                <div className="flex-1 space-y-2.5">
                  <Skeleton className="h-3 w-44" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <div className="flex gap-2 pt-1">
                    <Skeleton className="h-5 w-24 rounded-sm" />
                    <Skeleton className="h-5 w-16 rounded-sm" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error state */}
        {fetchError && (
          <div className="flex items-center gap-3 p-4 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-sm fade-in">
            <span>{fetchError}</span>
          </div>
        )}

        {/* Report tab */}
        {report && activeTab === 'report' && (
          <div className="space-y-10 fade-in">
            {/* Synthesis */}
            {report.content.synthesis && (
              <div>
                <h2 className="font-display text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4">
                  Synthèse
                </h2>
                <p className="text-sm text-foreground/80 leading-relaxed max-w-2xl whitespace-pre-line">
                  {report.content.synthesis}
                </p>
              </div>
            )}

            {/* Improvement axes */}
            {report.content.improvement_axes.length > 0 && (
              <div>
                <h2 className="font-display text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4">
                  Axes d'amélioration
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {report.content.improvement_axes.map((axis, i) => (
                    <Card
                      key={i}
                      className="border-border/80 hover:border-primary/20 transition-colors duration-200 fade-in"
                      style={{ animationDelay: `${i * 60}ms` }}
                    >
                      <CardContent className="pt-4 pb-4">
                        <div className="flex items-start gap-2.5">
                          <div className="text-sm text-foreground leading-relaxed min-w-0">
                            <ReactMarkdown
                              components={{
                                p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                                strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                                em: ({ children }) => <em className="italic">{children}</em>,
                                ul: ({ children }) => <ul className="list-disc list-inside mt-1 space-y-0.5">{children}</ul>,
                                ol: ({ children }) => <ol className="list-decimal list-inside mt-1 space-y-0.5">{children}</ol>,
                                li: ({ children }) => <li className="text-sm">{children}</li>,
                                code: ({ children }) => <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">{children}</code>,
                              }}
                            >
                              {axis}
                            </ReactMarkdown>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {!report.content.synthesis && report.content.improvement_axes.length === 0 && (
              <p className="text-sm text-muted-foreground">Aucune synthèse disponible.</p>
            )}
          </div>
        )}

        {/* Transcript tab */}
        {report && activeTab === 'transcript' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-10 fade-in">
            {/* Utterances — 2/3 */}
            <div className="lg:col-span-2">
              <div className="flex items-center justify-between mb-7">
                <h2 className="font-display text-lg font-bold text-foreground">
                  Transcription diarisée
                </h2>
                <span className="text-xs font-mono text-muted-foreground">
                  {report.content.utterances.length} prises de parole
                </span>
              </div>

              <div>
                {report.content.utterances.map((utterance, idx) => (
                  <UtteranceRow
                    key={idx}
                    utterance={utterance}
                    idx={idx}
                    resolvedName={resolveName(utterance.speaker)}
                    palette={getPalette(utterance.speaker)}
                  />
                ))}
              </div>
            </div>

            {/* Speaker name mapping — 1/3 */}
            {originalLabels.length > 0 && (
              <div className="lg:col-span-1">
                <div className="sticky top-20">
                  <h3 className="font-display text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">
                    Participants
                  </h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    Nommez les intervenants. Même nom = fusion automatique.
                  </p>
                  <div className="space-y-2">
                    {originalLabels.map((label) => {
                      const palette = getPalette(label);
                      const resolvedName = resolveName(label);
                      const isMerged = (mergeGroups.get(resolvedName)?.length ?? 0) > 1;
                      const count = report.content.utterances.filter(
                        (u) => u.speaker === label,
                      ).length;

                      return (
                        <div key={label} className="flex items-center gap-2">
                          <div className={cn('w-2 h-2 rounded-full shrink-0', palette.dot)} />
                          <input
                            type="text"
                            value={speakerNames[label] ?? ''}
                            onChange={(e) =>
                              setSpeakerNames((prev) => ({ ...prev, [label]: e.target.value }))
                            }
                            placeholder={label}
                            className="flex-1 min-w-0 bg-card border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
                          />
                          <span className="text-xs text-muted-foreground font-mono shrink-0">
                            {count}
                          </span>
                          {isMerged && (
                            <span className="text-xs text-amber-400 font-mono shrink-0" title="Fusionné">
                              ⇒
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {[...mergeGroups.entries()].some(([, labels]) => labels.length > 1) && (
                    <div className="mt-3 pt-3 border-t border-border space-y-1">
                      {[...mergeGroups.entries()]
                        .filter(([, labels]) => labels.length > 1)
                        .map(([name, labels]) => (
                          <p key={name} className="text-xs text-muted-foreground font-mono">
                            {labels.join(' + ')} → <span className="text-foreground">{name}</span>
                          </p>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
