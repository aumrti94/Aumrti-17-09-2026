import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { X, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errorMessage";
import { FormError } from "@/components/ui/FormError";
import type { AddonSku } from "@/lib/addons";

/** Parse a comma/space/newline separated list into a deduped, trimmed array. */
function parseList(raw: string): string[] {
  return Array.from(new Set(
    raw.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean),
  ));
}

interface Props {
  /** An existing SKU to edit, or "new" to create one. */
  sku: AddonSku | "new";
  onClose: () => void;
}

/**
 * Create/edit drawer for addon_skus — packaging (price + the modules/AI features
 * a SKU grants) is now managed from /platform instead of via SQL. Reuses the
 * generic addon_skus upsert (is_aumrti_admin RLS already on the table).
 */
export default function AddonSkuEditor({ sku, onClose }: Props) {
  const qc = useQueryClient();
  const isNew = sku === "new";
  const s = isNew ? null : sku;

  const [name, setName] = useState(s?.name ?? "");
  const [slug, setSlug] = useState(s?.slug ?? "");
  const [description, setDescription] = useState(s?.description ?? "");
  const [priceMonthly, setPriceMonthly] = useState<string>(s ? String(s.price_monthly ?? "") : "");
  const [priceYearly, setPriceYearly] = useState<string>(s?.price_yearly != null ? String(s.price_yearly) : "");
  const [moduleKeys, setModuleKeys] = useState((s?.module_keys ?? []).join(", "));
  const [aiKeys, setAiKeys] = useState((s?.ai_feature_keys ?? []).join(", "));
  const [badge, setBadge] = useState(s?.badge_text ?? "");
  const [isActive, setIsActive] = useState(s?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);

  // Reset the form whenever a different SKU is opened.
  useEffect(() => {
    setName(s?.name ?? ""); setSlug(s?.slug ?? ""); setDescription(s?.description ?? "");
    setPriceMonthly(s ? String(s.price_monthly ?? "") : "");
    setPriceYearly(s?.price_yearly != null ? String(s.price_yearly) : "");
    setModuleKeys((s?.module_keys ?? []).join(", "));
    setAiKeys((s?.ai_feature_keys ?? []).join(", "));
    setBadge(s?.badge_text ?? ""); setIsActive(s?.is_active ?? true); setError(null);
  }, [sku]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Name is required");
      if (!slug.trim()) throw new Error("Slug is required");
      const payload: any = {
        ...(s?.id ? { id: s.id } : {}),
        slug: slug.trim(),
        name: name.trim(),
        description: description.trim() || null,
        price_monthly: Number(priceMonthly) || 0,
        price_yearly: priceYearly.trim() === "" ? null : Number(priceYearly),
        module_keys: parseList(moduleKeys),
        ai_feature_keys: parseList(aiKeys),
        badge_text: badge.trim() || null,
        is_active: isActive,
        updated_at: new Date().toISOString(),
      };
      const { error } = await (supabase as any)
        .from("addon_skus")
        .upsert(payload, { onConflict: "id" });
      if (error) throw error;
    },
    onSuccess: () => {
      setError(null);
      toast.success(isNew ? "Add-on created" : "Add-on saved");
      qc.invalidateQueries({ queryKey: ["addon-skus-admin"] });
      onClose();
    },
    onError: (e: any) => { const m = getErrorMessage(e); setError(m); toast.error(m); },
  });

  const field = "w-full mt-1 h-9 px-3 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary";

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="w-full max-w-md h-full bg-card border-l border-border shadow-xl overflow-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="h-14 border-b border-border flex items-center justify-between px-5 sticky top-0 bg-card">
          <p className="text-sm font-semibold text-foreground">{isNew ? "New Add-on" : "Edit Add-on"}</p>
          <button onClick={onClose} className="text-foreground/50 hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-muted-foreground">Name</label>
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Insurance & Claims Desk" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Slug (stable key, e.g. insurance_tpa)</label>
            <input className={field} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="insurance_tpa" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Description</label>
            <textarea className={`${field} h-auto py-2`} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">₹ / month</label>
              <input type="number" className={field} value={priceMonthly} onChange={(e) => setPriceMonthly(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">₹ / year (blank = 10×)</label>
              <input type="number" className={field} value={priceYearly} onChange={(e) => setPriceYearly(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Module keys (comma separated)</label>
            <textarea className={`${field} h-auto py-2 font-mono text-xs`} rows={2} value={moduleKeys} onChange={(e) => setModuleKeys(e.target.value)} placeholder="insurance, pmjay" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">AI feature keys (comma separated)</label>
            <textarea className={`${field} h-auto py-2 font-mono text-xs`} rows={2} value={aiKeys} onChange={(e) => setAiKeys(e.target.value)} placeholder="denial_predictor, approval_predictor" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Badge text (optional)</label>
            <input className={field} value={badge} onChange={(e) => setBadge(e.target.value)} placeholder="Popular" />
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" className="h-4 w-4" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active (sellable to hospitals)
          </label>

          {error && <FormError message={error} />}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="h-9 px-4 rounded-md border border-border text-sm">Cancel</button>
            <button onClick={() => save.mutate()} disabled={save.isPending}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60">
              {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
