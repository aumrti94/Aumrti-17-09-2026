import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plus, X, Save, Loader2, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errorMessage";
import { FormError } from "@/components/ui/FormError";
import { format } from "date-fns";

/* ─────────────── Types ─────────────── */
interface Partner {
  id: string; partner_type: "partner" | "rep"; name: string;
  email: string | null; phone: string | null; commission_pct: number;
  notes: string | null; is_active: boolean; created_at: string;
}
interface Code {
  id: string; code: string; owner_type: "partner" | "rep" | "hospital";
  partner_id: string | null; hospital_id: string | null;
  referee_discount_pct: number; referee_trial_extra_days: number; referee_discount_months: number;
  referrer_reward_type: "free_month" | "credit" | "commission" | "none"; referrer_reward_value: number;
  valid_from: string; valid_until: string | null;
  max_uses: number | null; used_count: number; is_active: boolean; created_at: string;
  referral_partners?: { name: string } | null;
  hospitals?: { name: string } | null;
}
interface Redemption {
  id: string; code_text: string; status: string;
  signed_up_at: string; converted_at: string | null;
  reward_type: string; reward_value: number; reward_status: string;
  referred_hospital_id: string | null;
  hospitals?: { name: string } | null;
  referral_codes?: { owner_type: string; referral_partners?: { name: string } | null } | null;
}

type Tab = "codes" | "partners" | "funnel";

/* ─────────────── Fetchers ─────────────── */
const fetchPartners = async (): Promise<Partner[]> => {
  const { data } = await (supabase as any).from("referral_partners").select("*").order("created_at", { ascending: false });
  return data || [];
};
const fetchCodes = async (): Promise<Code[]> => {
  const { data } = await (supabase as any).from("referral_codes")
    .select("*, referral_partners(name), hospitals(name)").order("created_at", { ascending: false });
  return data || [];
};
const fetchRedemptions = async (): Promise<Redemption[]> => {
  const { data } = await (supabase as any).from("referral_redemptions")
    .select("*, hospitals:referred_hospital_id(name), referral_codes(owner_type, referral_partners(name))")
    .order("signed_up_at", { ascending: false });
  return data || [];
};

const BLANK_PARTNER: Partial<Partner> = { partner_type: "partner", name: "", email: "", phone: "", commission_pct: 0, notes: "", is_active: true };
const BLANK_CODE: Partial<Code> = {
  code: "", owner_type: "partner", partner_id: null,
  referee_discount_pct: 0, referee_trial_extra_days: 14, referee_discount_months: 0,
  referrer_reward_type: "commission", referrer_reward_value: 0,
  valid_from: new Date().toISOString().split("T")[0], valid_until: "", max_uses: null, is_active: true,
};

export default function ReferralsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("codes");

  const { data: partners = [] } = useQuery({ queryKey: ["ref-partners"], queryFn: fetchPartners, staleTime: 30_000 });
  const { data: codes = [], isLoading: codesLoading } = useQuery({ queryKey: ["ref-codes"], queryFn: fetchCodes, staleTime: 30_000 });
  const { data: redemptions = [], isLoading: redLoading } = useQuery({ queryKey: ["ref-redemptions"], queryFn: fetchRedemptions, staleTime: 30_000 });

  /* ── Partner form ── */
  const [showPartner, setShowPartner] = useState(false);
  const [partnerForm, setPartnerForm] = useState<Partial<Partner>>(BLANK_PARTNER);
  const [partnerEditId, setPartnerEditId] = useState<string | null>(null);
  const [partnerErr, setPartnerErr] = useState<string | null>(null);
  const savePartner = useMutation({
    mutationFn: async () => {
      const payload = { ...partnerForm, commission_pct: Number(partnerForm.commission_pct) || 0 };
      if (partnerEditId) await (supabase as any).from("referral_partners").update(payload).eq("id", partnerEditId);
      else await (supabase as any).from("referral_partners").insert([payload]);
    },
    onSuccess: () => {
      setPartnerErr(null); toast.success(partnerEditId ? "Partner updated" : "Partner created");
      setShowPartner(false); setPartnerEditId(null); setPartnerForm(BLANK_PARTNER);
      qc.invalidateQueries({ queryKey: ["ref-partners"] });
    },
    onError: (e: any) => { const m = getErrorMessage(e); setPartnerErr(m); toast.error(m); },
  });

  /* ── Code form ── */
  const [showCode, setShowCode] = useState(false);
  const [codeForm, setCodeForm] = useState<Partial<Code>>(BLANK_CODE);
  const [codeEditId, setCodeEditId] = useState<string | null>(null);
  const [codeErr, setCodeErr] = useState<string | null>(null);
  const cf = (k: keyof Code, v: any) => setCodeForm((p) => ({ ...p, [k]: v }));
  const saveCode = useMutation({
    mutationFn: async () => {
      const payload: any = {
        code: String(codeForm.code || "").toUpperCase().trim(),
        owner_type: codeForm.owner_type,
        partner_id: codeForm.owner_type === "hospital" ? null : (codeForm.partner_id || null),
        referee_discount_pct: Number(codeForm.referee_discount_pct) || 0,
        referee_trial_extra_days: Number(codeForm.referee_trial_extra_days) || 0,
        referee_discount_months: Number(codeForm.referee_discount_months) || 0,
        referrer_reward_type: codeForm.referrer_reward_type,
        referrer_reward_value: Number(codeForm.referrer_reward_value) || 0,
        valid_from: codeForm.valid_from || new Date().toISOString(),
        valid_until: codeForm.valid_until || null,
        max_uses: codeForm.max_uses ? Number(codeForm.max_uses) : null,
        is_active: codeForm.is_active ?? true,
      };
      if (codeEditId) await (supabase as any).from("referral_codes").update(payload).eq("id", codeEditId);
      else await (supabase as any).from("referral_codes").insert([payload]);
    },
    onSuccess: () => {
      setCodeErr(null); toast.success(codeEditId ? "Code updated" : "Code created");
      setShowCode(false); setCodeEditId(null); setCodeForm(BLANK_CODE);
      qc.invalidateQueries({ queryKey: ["ref-codes"] });
    },
    onError: (e: any) => { const m = getErrorMessage(e); setCodeErr(m); toast.error(m); },
  });

  const toggleCode = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) =>
      (supabase as any).from("referral_codes").update({ is_active }).eq("id", id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ref-codes"] }),
  });

  const ownerLabel = (c: Code) =>
    c.owner_type === "hospital" ? (c.hospitals?.name ? `🏥 ${c.hospitals.name}` : "🏥 Hospital")
      : (c.referral_partners?.name || (c.owner_type === "rep" ? "Rep" : "Partner"));

  const rewardLabel = (t: string, v: number) =>
    t === "none" ? "—" : t === "free_month" ? `${v} free month(s)` : t === "credit" ? `₹${v} credit` : `${v}% commission`;

  const TabBtn = ({ id, label }: { id: Tab; label: string }) => (
    <button onClick={() => setTab(id)}
      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${tab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
      {label}
    </button>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 border-b border-border flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-[15px] font-semibold text-foreground mr-2">Referrals</h1>
          <TabBtn id="codes" label="Codes" />
          <TabBtn id="partners" label="Partners & Reps" />
          <TabBtn id="funnel" label="Funnel" />
        </div>
        {tab === "codes" && (
          <button onClick={() => { setCodeForm(BLANK_CODE); setCodeEditId(null); setShowCode(true); }}
            className="flex items-center gap-2 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg">
            <Plus size={12} /> New Code
          </button>
        )}
        {tab === "partners" && (
          <button onClick={() => { setPartnerForm(BLANK_PARTNER); setPartnerEditId(null); setShowPartner(true); }}
            className="flex items-center gap-2 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg">
            <Plus size={12} /> New Partner / Rep
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {/* ── Codes tab ── */}
        {tab === "codes" && (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card z-10">
              <tr className="text-[10px] uppercase font-bold text-muted-foreground border-b border-border">
                {["Code", "Owner", "Referee Perk", "Referrer Reward", "Uses", "Valid Until", "Active", ""].map((h) => (
                  <th key={h} className="px-5 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {codesLoading ? (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-xs text-muted-foreground">Loading…</td></tr>
              ) : codes.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-xs text-muted-foreground">No referral codes yet</td></tr>
              ) : codes.map((c) => (
                <tr key={c.id} className="border-t border-border hover:bg-muted/40">
                  <td className="px-5 py-3 text-xs font-mono font-bold text-foreground">{c.code}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">
                    <span className="inline-block px-1.5 py-0.5 rounded bg-muted text-[10px] uppercase mr-1">{c.owner_type}</span>
                    {ownerLabel(c)}
                  </td>
                  <td className="px-5 py-3 text-xs text-foreground/80">
                    {[c.referee_trial_extra_days ? `${c.referee_trial_extra_days}d trial` : "", c.referee_discount_pct ? `${c.referee_discount_pct}% off` : ""].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="px-5 py-3 text-xs text-foreground/80">{rewardLabel(c.referrer_reward_type, c.referrer_reward_value)}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground font-mono">{c.used_count}{c.max_uses ? `/${c.max_uses}` : ""}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{c.valid_until ? format(new Date(c.valid_until), "dd MMM yyyy") : "—"}</td>
                  <td className="px-5 py-3">
                    <button onClick={() => toggleCode.mutate({ id: c.id, is_active: !c.is_active })} className="text-muted-foreground hover:text-foreground">
                      {c.is_active ? <ToggleRight size={18} className="text-emerald-600" /> : <ToggleLeft size={18} />}
                    </button>
                  </td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => {
                        setCodeForm({ ...c, valid_from: c.valid_from?.split("T")[0], valid_until: c.valid_until?.split("T")[0] || "" });
                        setCodeEditId(c.id); setShowCode(true);
                      }}
                      className="text-xs text-blue-600 hover:text-blue-700">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* ── Partners tab ── */}
        {tab === "partners" && (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card z-10">
              <tr className="text-[10px] uppercase font-bold text-muted-foreground border-b border-border">
                {["Name", "Type", "Email", "Phone", "Commission", "Active", ""].map((h) => (
                  <th key={h} className="px-5 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {partners.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-xs text-muted-foreground">No partners or reps yet</td></tr>
              ) : partners.map((p) => (
                <tr key={p.id} className="border-t border-border hover:bg-muted/40">
                  <td className="px-5 py-3 text-xs font-semibold text-foreground">{p.name}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground uppercase">{p.partner_type}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{p.email || "—"}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{p.phone || "—"}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground font-mono">{p.commission_pct}%</td>
                  <td className="px-5 py-3 text-xs">{p.is_active ? <span className="text-emerald-600">Active</span> : <span className="text-muted-foreground">Inactive</span>}</td>
                  <td className="px-5 py-3">
                    <button onClick={() => { setPartnerForm(p); setPartnerEditId(p.id); setShowPartner(true); }} className="text-xs text-blue-600 hover:text-blue-700">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* ── Funnel tab ── */}
        {tab === "funnel" && (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card z-10">
              <tr className="text-[10px] uppercase font-bold text-muted-foreground border-b border-border">
                {["Code", "Referred Hospital", "Owner", "Status", "Signed Up", "Converted", "Reward"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {redLoading ? (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-xs text-muted-foreground">Loading…</td></tr>
              ) : redemptions.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-xs text-muted-foreground">No referrals yet</td></tr>
              ) : redemptions.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-muted/40">
                  <td className="px-5 py-3 text-xs font-mono font-bold text-foreground">{r.code_text}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{r.hospitals?.name || "—"}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{r.referral_codes?.referral_partners?.name || r.referral_codes?.owner_type || "—"}</td>
                  <td className="px-5 py-3 text-xs">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase ${r.status === "converted" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}>{r.status}</span>
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{format(new Date(r.signed_up_at), "dd MMM yyyy")}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{r.converted_at ? format(new Date(r.converted_at), "dd MMM yyyy") : "—"}</td>
                  <td className="px-5 py-3 text-xs text-foreground/80">
                    {r.reward_status === "granted" ? rewardLabel(r.reward_type, r.reward_value) : r.reward_status === "void" ? "—" : "pending"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Partner modal ── */}
      {showPartner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-card border border-border rounded-xl w-[440px] shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <p className="text-sm font-semibold text-foreground">{partnerEditId ? "Edit Partner / Rep" : "New Partner / Rep"}</p>
              <button onClick={() => setShowPartner(false)}><X size={15} className="text-muted-foreground hover:text-foreground" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Type</label>
                <select value={partnerForm.partner_type} onChange={(e) => setPartnerForm((p) => ({ ...p, partner_type: e.target.value as any }))}
                  className="w-full mt-1 h-8 px-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary">
                  <option value="partner">Marketing Partner</option>
                  <option value="rep">Sales Representative</option>
                </select>
              </div>
              {[
                { label: "Name", key: "name" as const, type: "text", placeholder: "Acme Health Partners" },
                { label: "Email", key: "email" as const, type: "text", placeholder: "optional" },
                { label: "Phone", key: "phone" as const, type: "text", placeholder: "optional" },
                { label: "Commission %", key: "commission_pct" as const, type: "number", placeholder: "10" },
                { label: "Notes (internal)", key: "notes" as const, type: "text", placeholder: "optional" },
              ].map(({ label, key, type, placeholder }) => (
                <div key={key}>
                  <label className="text-xs text-muted-foreground">{label}</label>
                  <input type={type} value={(partnerForm[key] as any) ?? ""} placeholder={placeholder}
                    onChange={(e) => setPartnerForm((p) => ({ ...p, [key]: e.target.value }))}
                    className="w-full mt-1 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary" />
                </div>
              ))}
            </div>
            <div className="px-5 pb-5 space-y-3">
              <FormError message={partnerErr} />
              <button onClick={() => savePartner.mutate()} disabled={savePartner.isPending || !partnerForm.name}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold rounded-lg disabled:opacity-50">
                {savePartner.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {partnerEditId ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Code modal ── */}
      {showCode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-card border border-border rounded-xl w-[460px] shadow-2xl max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <p className="text-sm font-semibold text-foreground">{codeEditId ? "Edit Code" : "New Referral Code"}</p>
              <button onClick={() => setShowCode(false)}><X size={15} className="text-muted-foreground hover:text-foreground" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Code (CAPS)</label>
                <input value={codeForm.code ?? ""} onChange={(e) => cf("code", e.target.value.toUpperCase())} placeholder="PARTNER2026"
                  className="w-full mt-1 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Owner Type</label>
                  <select value={codeForm.owner_type} onChange={(e) => cf("owner_type", e.target.value)}
                    className="w-full mt-1 h-8 px-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary">
                    <option value="partner">Marketing Partner</option>
                    <option value="rep">Sales Rep</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Partner / Rep</label>
                  <select value={codeForm.partner_id ?? ""} onChange={(e) => cf("partner_id", e.target.value || null)}
                    className="w-full mt-1 h-8 px-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary">
                    <option value="">— none —</option>
                    {partners.filter((p) => p.partner_type === codeForm.owner_type).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-[11px] font-semibold text-muted-foreground pt-1">Referee perk (new hospital)</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Extra trial days", key: "referee_trial_extra_days" as const },
                  { label: "Discount %", key: "referee_discount_pct" as const },
                  { label: "Discount months (0 = forever)", key: "referee_discount_months" as const },
                ].map(({ label, key }) => (
                  <div key={key}>
                    <label className="text-xs text-muted-foreground">{label}</label>
                    <input type="number" value={(codeForm[key] as any) ?? 0} onChange={(e) => cf(key, e.target.value)}
                      className="w-full mt-1 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary" />
                  </div>
                ))}
              </div>
              <p className="text-[11px] font-semibold text-muted-foreground pt-1">Referrer reward (on conversion)</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Reward type</label>
                  <select value={codeForm.referrer_reward_type} onChange={(e) => cf("referrer_reward_type", e.target.value)}
                    className="w-full mt-1 h-8 px-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary">
                    <option value="commission">Commission %</option>
                    <option value="free_month">Free month(s)</option>
                    <option value="credit">₹ credit</option>
                    <option value="none">None</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Reward value</label>
                  <input type="number" value={(codeForm.referrer_reward_value as any) ?? 0} onChange={(e) => cf("referrer_reward_value", e.target.value)}
                    className="w-full mt-1 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Max uses (blank = ∞)</label>
                  <input type="number" value={(codeForm.max_uses as any) ?? ""} onChange={(e) => cf("max_uses", e.target.value === "" ? null : e.target.value)}
                    className="w-full mt-1 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Valid until (blank = never)</label>
                  <input type="date" value={(codeForm.valid_until as any) ?? ""} onChange={(e) => cf("valid_until", e.target.value)}
                    className="w-full mt-1 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary" />
                </div>
              </div>
            </div>
            <div className="px-5 pb-5 space-y-3">
              <FormError message={codeErr} />
              <button onClick={() => saveCode.mutate()} disabled={saveCode.isPending || !codeForm.code}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold rounded-lg disabled:opacity-50">
                {saveCode.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {codeEditId ? "Update" : "Create Code"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
