import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Pencil, X, Check } from 'lucide-react';
import { Button } from '../components/ui/button';
import { api } from '../api/client';
import type { Script, ScriptStep } from '../types';

interface StepDraft {
  title: string;
  description: string;
  duration: number;
}

interface ScriptDraft {
  title: string;
  steps: StepDraft[];
}

const EMPTY_DRAFT: ScriptDraft = {
  title: '',
  steps: [{ title: '', description: '', duration: 5 }],
};

export function ScriptsPage() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // null = no editor open; 'new' = creating; string = editing existing id
  const [editorTarget, setEditorTarget] = useState<'new' | string | null>(null);
  const [draft, setDraft] = useState<ScriptDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadScripts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listScripts();
      setScripts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors du chargement');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadScripts();
  }, [loadScripts]);

  const openNewEditor = () => {
    setDraft(EMPTY_DRAFT);
    setSaveError(null);
    setEditorTarget('new');
  };

  const openEditEditor = (script: Script) => {
    setDraft({
      title: script.title,
      steps: script.steps.map((s) => ({ title: s.title, description: s.description, duration: s.duration })),
    });
    setSaveError(null);
    setEditorTarget(script.id);
  };

  const closeEditor = () => {
    setEditorTarget(null);
    setDraft(EMPTY_DRAFT);
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!draft.title.trim()) {
      setSaveError('Le titre est requis.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        title: draft.title.trim(),
        steps: draft.steps.map((s) => ({
          title: s.title.trim(),
          description: s.description.trim(),
          duration: s.duration,
        })),
      };
      if (editorTarget === 'new') {
        await api.createScript(payload);
      } else if (editorTarget) {
        await api.updateScript(editorTarget, payload);
      }
      closeEditor();
      await loadScripts();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (script: Script) => {
    if (!window.confirm(`Supprimer le script « ${script.title} » ?`)) return;
    try {
      await api.deleteScript(script.id);
      if (editorTarget === script.id) closeEditor();
      await loadScripts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la suppression');
    }
  };

  const updateDraftStep = (index: number, field: keyof StepDraft, value: string | number) => {
    setDraft((prev) => {
      const steps = [...prev.steps];
      steps[index] = { ...steps[index], [field]: value };
      return { ...prev, steps };
    });
  };

  const addStep = () => {
    setDraft((prev) => ({
      ...prev,
      steps: [...prev.steps, { title: '', description: '', duration: 5 }],
    }));
  };

  const removeStep = (index: number) => {
    setDraft((prev) => ({
      ...prev,
      steps: prev.steps.filter((_, i) => i !== index),
    }));
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h1 className="font-display font-semibold text-foreground text-sm">
            Scripts workathon
          </h1>
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-10 flex flex-col gap-6">
        {/* Top actions */}
        <div className="flex items-center justify-between">
          <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
            Scripts enregistrés
          </p>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={openNewEditor}
            disabled={editorTarget === 'new'}
          >
            <Plus className="w-3.5 h-3.5" />
            Nouveau script
          </Button>
        </div>

        {/* Global error */}
        {error && (
          <div className="p-4 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}

        {/* Script list */}
        {loading ? (
          <div className="text-sm text-muted-foreground font-mono">Chargement…</div>
        ) : scripts.length === 0 && editorTarget !== 'new' ? (
          <div className="rounded-xl border border-border bg-card px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">Aucun script enregistré.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Créez votre premier script personnalisé avec le bouton ci-dessus.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {scripts.map((script) => (
              <div key={script.id}>
                <div className="rounded-xl border border-border bg-card px-5 py-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-display font-semibold text-foreground truncate">
                      {script.title}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">
                      {script.steps.length} étape{script.steps.length !== 1 ? 's' : ''} · {formatDate(script.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-muted-foreground hover:text-foreground"
                      onClick={() => openEditEditor(script)}
                      disabled={editorTarget === script.id}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Modifier
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => void handleDelete(script)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Inline editor for this script */}
                {editorTarget === script.id && (
                  <ScriptEditor
                    draft={draft}
                    setDraft={setDraft}
                    onSave={() => void handleSave()}
                    onCancel={closeEditor}
                    onAddStep={addStep}
                    onRemoveStep={removeStep}
                    onUpdateStep={updateDraftStep}
                    saving={saving}
                    saveError={saveError}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Inline editor for new script */}
        {editorTarget === 'new' && (
          <ScriptEditor
            draft={draft}
            setDraft={setDraft}
            onSave={() => void handleSave()}
            onCancel={closeEditor}
            onAddStep={addStep}
            onRemoveStep={removeStep}
            onUpdateStep={updateDraftStep}
            saving={saving}
            saveError={saveError}
          />
        )}
      </main>
    </div>
  );
}

// ── Inline editor component ────────────────────────────────────────────────────

interface ScriptEditorProps {
  draft: ScriptDraft;
  setDraft: React.Dispatch<React.SetStateAction<ScriptDraft>>;
  onSave: () => void;
  onCancel: () => void;
  onAddStep: () => void;
  onRemoveStep: (index: number) => void;
  onUpdateStep: (index: number, field: keyof StepDraft, value: string | number) => void;
  saving: boolean;
  saveError: string | null;
}

function ScriptEditor({
  draft,
  setDraft,
  onSave,
  onCancel,
  onAddStep,
  onRemoveStep,
  onUpdateStep,
  saving,
  saveError,
}: ScriptEditorProps) {
  return (
    <div className="mt-2 rounded-xl border border-primary/30 bg-card px-5 py-5 flex flex-col gap-5">
      {/* Title */}
      <div>
        <label className="block text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2">
          Titre du script
        </label>
        <input
          type="text"
          value={draft.title}
          onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
          placeholder="Ex. Workathon design sprint"
          className="w-full bg-background border border-border rounded-md px-4 py-2.5 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring text-sm transition-colors"
        />
      </div>

      {/* Steps */}
      <div className="flex flex-col gap-4">
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
          Étapes ({draft.steps.length})
        </p>

        {draft.steps.map((step, i) => (
          <div key={i} className="rounded-lg border border-border bg-background/50 px-4 py-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-muted-foreground">Étape {i + 1}</span>
              {draft.steps.length > 1 && (
                <button
                  type="button"
                  onClick={() => onRemoveStep(i)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                  aria-label="Supprimer l'étape"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-xs text-muted-foreground mb-1">Titre</label>
                <input
                  type="text"
                  value={step.title}
                  onChange={(e) => onUpdateStep(i, 'title', e.target.value)}
                  placeholder="Ex. Idéation"
                  className="w-full bg-card border border-border rounded-md px-3 py-2 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring text-xs transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Durée (min)</label>
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={step.duration}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    onUpdateStep(i, 'duration', isNaN(v) || v < 1 ? 1 : v);
                  }}
                  className="w-full bg-card border border-border rounded-md px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring text-xs transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1">Description de l'étape (lue par l'IA)</label>
              <textarea
                value={step.description}
                onChange={(e) => onUpdateStep(i, 'description', e.target.value)}
                placeholder="Description lue à voix haute au début de l'étape…"
                rows={3}
                className="w-full bg-card border border-border rounded-md px-3 py-2 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring text-xs transition-colors resize-none"
              />
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={onAddStep}
          className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors font-mono"
        >
          <Plus className="w-3.5 h-3.5" />
          Ajouter une étape
        </button>
      </div>

      {/* Save error */}
      {saveError && (
        <p className="text-xs text-destructive font-mono">{saveError}</p>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          onClick={onCancel}
          disabled={saving}
        >
          <X className="w-3.5 h-3.5" />
          Annuler
        </Button>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={onSave}
          disabled={saving}
        >
          <Check className="w-3.5 h-3.5" />
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </div>
  );
}
