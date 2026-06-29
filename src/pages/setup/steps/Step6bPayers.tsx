import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { ShieldCheck, Plus, Trash2 } from "lucide-react";
import { useConfigValues } from "@/hooks/useConfigValues";


interface CorporateRow {
  name: string;
  limit: string;
}

interface Props {
  hospitalId: string;
  onComplete: () => void;
  onSkip: () => void;
}

const Step6bPayers: React.FC<Props> = ({ hospitalId, onComplete, onSkip }) => {
  const { toast } = useToast();
  const tpaOptions = useConfigValues("tpa_companies");
  const govOptions = useConfigValues("government_schemes");
  const [selectedTpas, setSelectedTpas] = useState<string[]>([]);
  const [selectedGov, setSelectedGov] = useState<string[]>([]);
  const [corporates, setCorporates] = useState<CorporateRow[]>([{ name: "", limit: "" }]);
  const [saving, setSaving] = useState(false);

  const toggleTpa = (name: string) =>
    setSelectedTpas((prev) => prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]);

  const toggleGov = (type: string) =>
    setSelectedGov((prev) => prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]);

  const updateCorp = (i: number, field: keyof CorporateRow, val: string) =>
    setCorporates((prev) => prev.map((c, idx) => idx === i ? { ...c, [field]: val } : c));

  const addCorp = () => {
    if (corporates.length >= 3) return;
    setCorporates((prev) => [...prev, { name: "", limit: "" }]);
  };

  const removeCorp = (i: number) => setCorporates((prev) => prev.filter((_, idx) => idx !== i));

  // Valid payer_type values from DB CHECK constraint
  const VALID_PAYER_TYPES = new Set(["cash", "credit", "corporate", "tpa", "pmjay", "cghs", "esi", "state_scheme", "other"]);

  const normalizePayer = (type: string): string =>
    VALID_PAYER_TYPES.has(type) ? type : "state_scheme";

  const handleSave = async () => {
    const hasAny = selectedTpas.length > 0 || selectedGov.length > 0 || corporates.some((c) => c.name.trim());
    if (!hasAny) {
      onComplete(); // nothing selected — just advance
      return;
    }
    setSaving(true);
    try {
      // Check existing payers to avoid duplicate inserts if wizard is re-run
      const { data: existingPayers } = await supabase
        .from("payer_masters")
        .select("payer_name")
        .eq("hospital_id", hospitalId);
      const existingNames = new Set((existingPayers ?? []).map((p: any) => p.payer_name.toLowerCase()));

      const rows: any[] = [
        ...selectedTpas
          .filter((name) => !existingNames.has(name.toLowerCase()))
          .map((name) => ({
            hospital_id: hospitalId,
            payer_type: "tpa",
            payer_name: name,
            tariff_class: "standard",
            payment_terms_days: 30,
            is_active: true,
          })),
        ...selectedGov
          .filter((type) => {
            const label = govOptions.find((g) => g.value === type)?.label ?? type;
            return !existingNames.has(label.toLowerCase());
          })
          .map((type) => ({
            hospital_id: hospitalId,
            payer_type: normalizePayer(type),
            payer_name: govOptions.find((g) => g.value === type)?.label ?? type,
            is_active: true,
          })),
        ...corporates
          .filter((c) => c.name.trim() && !existingNames.has(c.name.trim().toLowerCase()))
          .map((c) => ({
            hospital_id: hospitalId,
            payer_type: "corporate",
            payer_name: c.name.trim(),
            credit_limit: c.limit ? parseFloat(c.limit) : null,
            payment_terms_days: 30,
            is_active: true,
          })),
      ];

      if (rows.length === 0) {
        toast({ title: "Payers already configured" });
        onComplete();
        return;
      }
      const { error } = await supabase.from("payer_masters").insert(rows);
      if (error) throw error;
      toast({ title: `${rows.length} payer(s) configured!` });
      onComplete();
    } catch (err: any) {
      toast({ title: "Failed to save payers", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
          <ShieldCheck size={16} className="text-primary" />
        </div>
        <span className="text-xs font-semibold text-primary uppercase tracking-wide">Step 9 · Payers & Insurance</span>
      </div>
      <h2 className="text-[22px] font-bold text-foreground mt-2">Insurance & Payers</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-5">
        Select the TPAs and government schemes your hospital accepts. These appear as payer options in billing.
      </p>

      <div className="space-y-5">
        {/* TPA Section */}
        <div className="bg-card rounded-2xl border border-border p-5 shadow-card">
          <p className="text-sm font-semibold text-foreground mb-3">TPA / Private Insurance</p>
          <div className="grid grid-cols-3 gap-2">
            {tpaOptions.map((tpa) => {
              const checked = selectedTpas.includes(tpa.label);
              return (
                <label key={tpa.value} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-[13px] transition-colors ${
                  checked ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:border-primary/40"
                }`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleTpa(tpa.label)}
                    className="accent-primary"
                  />
                  {tpa.label}
                </label>
              );
            })}
          </div>
        </div>

        {/* Government Schemes */}
        <div className="bg-card rounded-2xl border border-border p-5 shadow-card">
          <p className="text-sm font-semibold text-foreground mb-3">Government Schemes</p>
          <div className="grid grid-cols-2 gap-2">
            {govOptions.map((g) => {
              const checked = selectedGov.includes(g.value);
              return (
                <label key={g.value} className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border cursor-pointer text-[13px] transition-colors ${
                  checked ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:border-primary/40"
                }`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleGov(g.value)}
                    className="accent-primary"
                  />
                  {g.label}
                </label>
              );
            })}
          </div>
        </div>

        {/* Corporate Accounts */}
        <div className="bg-card rounded-2xl border border-border p-5 shadow-card">
          <p className="text-sm font-semibold text-foreground mb-1">Corporate Accounts <span className="text-muted-foreground font-normal">(optional)</span></p>
          <p className="text-xs text-muted-foreground mb-3">Companies with credit billing arrangements</p>
          <div className="space-y-2">
            {corporates.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={c.name}
                  onChange={(e) => updateCorp(i, "name", e.target.value)}
                  placeholder="Company name"
                  className="h-8 text-sm flex-1"
                />
                <div className="relative">
                  <span className="absolute left-2.5 top-1.5 text-muted-foreground text-sm">₹</span>
                  <Input
                    type="number"
                    value={c.limit}
                    onChange={(e) => updateCorp(i, "limit", e.target.value)}
                    placeholder="Credit limit"
                    className="h-8 text-sm pl-6 w-36"
                  />
                </div>
                <button onClick={() => removeCorp(i)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          {corporates.length < 3 && (
            <button onClick={addCorp} className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline">
              <Plus size={13} /> Add corporate account
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mt-8">
        <button onClick={onSkip} className="text-sm text-muted-foreground hover:text-foreground">
          Skip for now →
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-primary text-primary-foreground px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-[hsl(220,54%,16%)] disabled:opacity-60 transition-colors"
        >
          {saving ? "Saving…" : "Save & Continue →"}
        </button>
      </div>
    </div>
  );
};

export default Step6bPayers;
