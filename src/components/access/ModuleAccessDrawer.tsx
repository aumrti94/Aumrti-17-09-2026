import { useState } from "react";
import { SlidersHorizontal, X, Save, Loader2 } from "lucide-react";
import { MODULE_TABS, MODULE_ACTIONS } from "@/lib/tabPermissions";

interface ModuleAccessDrawerProps {
  moduleKey: string;
  moduleLabel: string;
  /** Context line under the title — differs between hospital vs plan usage. */
  subtitle: string;
  /** Effective on/off seed per tab key (missing key = on). */
  initialTabs: Record<string, boolean>;
  /** Effective on/off seed per action key (missing key = on). */
  initialActions: Record<string, boolean>;
  saving: boolean;
  onClose: () => void;
  /** Receives the FULL draft (every catalog key true/false). Caller decides how to persist. */
  onSave: (tabs: Record<string, boolean>, actions: Record<string, boolean>) => void;
}

/**
 * Presentational right-drawer for toggling a module's tabs & buttons on/off.
 * Shared by the /platform hospital Modules tab (per-hospital override) and the
 * Plans editor (per-plan default). It is deliberately dumb: it seeds toggles from
 * `initial*`, tracks a local draft, and hands the full draft back on Save — the
 * parent owns storage semantics (plan-relative diffing, false-only pruning, etc).
 */
export function ModuleAccessDrawer({
  moduleKey,
  moduleLabel,
  subtitle,
  initialTabs,
  initialActions,
  saving,
  onClose,
  onSave,
}: ModuleAccessDrawerProps) {
  const tabDefs = MODULE_TABS[moduleKey] ?? [];
  const actionDefs = MODULE_ACTIONS[moduleKey] ?? [];

  const [draftTabs, setDraftTabs] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(tabDefs.map((t) => [t.key, initialTabs[t.key] !== false])),
  );
  const [draftActions, setDraftActions] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(actionDefs.map((a) => [a.key, initialActions[a.key] !== false])),
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="bg-card border-l border-border w-[460px] max-w-full h-full shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <p className="text-sm font-bold text-foreground flex items-center gap-2">
              <SlidersHorizontal size={14} className="text-primary" />
              {moduleLabel}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {tabDefs.length === 0 && actionDefs.length === 0 && (
            <p className="text-xs text-muted-foreground">
              This module has no configurable tabs or buttons yet.
            </p>
          )}

          {tabDefs.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Tabs</p>
                <div className="flex gap-2 text-[10px]">
                  <button className="text-primary hover:underline" onClick={() => setDraftTabs(Object.fromEntries(tabDefs.map((t) => [t.key, true])))}>Enable all</button>
                  <span className="text-muted-foreground/40">·</span>
                  <button className="text-muted-foreground hover:underline" onClick={() => setDraftTabs(Object.fromEntries(tabDefs.map((t) => [t.key, false])))}>Disable all</button>
                </div>
              </div>
              <div className="space-y-1">
                {tabDefs.map((t) => {
                  const on = draftTabs[t.key] !== false;
                  return (
                    <div
                      key={t.key}
                      onClick={() => setDraftTabs((p) => ({ ...p, [t.key]: !on }))}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs cursor-pointer transition-colors ${on ? "bg-blue-50 border-blue-300/60 text-foreground" : "bg-muted/40 border-border/60 text-muted-foreground"}`}
                    >
                      <span>{t.label}</span>
                      <div className={`w-7 h-3.5 rounded-full relative shrink-0 transition-colors ${on ? "bg-blue-500" : "bg-muted"}`}>
                        <div className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-3.5" : "translate-x-0.5"}`} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {actionDefs.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Buttons / Actions</p>
                <div className="flex gap-2 text-[10px]">
                  <button className="text-primary hover:underline" onClick={() => setDraftActions(Object.fromEntries(actionDefs.map((a) => [a.key, true])))}>Enable all</button>
                  <span className="text-muted-foreground/40">·</span>
                  <button className="text-muted-foreground hover:underline" onClick={() => setDraftActions(Object.fromEntries(actionDefs.map((a) => [a.key, false])))}>Disable all</button>
                </div>
              </div>
              <div className="space-y-1">
                {actionDefs.map((a) => {
                  const on = draftActions[a.key] !== false;
                  return (
                    <div
                      key={a.key}
                      onClick={() => setDraftActions((p) => ({ ...p, [a.key]: !on }))}
                      className={`flex items-start justify-between gap-3 px-3 py-2 rounded-lg border text-xs cursor-pointer transition-colors ${on ? "bg-blue-50 border-blue-300/60 text-foreground" : "bg-muted/40 border-border/60 text-muted-foreground"}`}
                    >
                      <span className="flex-1">
                        <span className="block font-medium">{a.label}</span>
                        <span className="block text-[10px] text-muted-foreground mt-0.5 leading-snug">{a.description}</span>
                      </span>
                      <div className={`w-7 h-3.5 rounded-full relative shrink-0 mt-0.5 transition-colors ${on ? "bg-blue-500" : "bg-muted"}`}>
                        <div className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-3.5" : "translate-x-0.5"}`} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex gap-3 shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-border text-muted-foreground hover:text-foreground text-sm font-medium rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(draftTabs, draftActions)}
            disabled={saving}
            className="flex-1 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-bold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
