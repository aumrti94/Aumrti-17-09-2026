import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Plus, Loader2, CheckCircle, X, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import { cn } from "@/lib/utils";

interface Props {
  hospitalId: string;
}

interface Credential {
  id: string;
  user_id: string;
  name: string | null;
  credential_type: string;
  credential_number: string | null;
  issuing_body: string | null;
  issued_date: string | null;
  expiry_date: string | null;
  document_url: string | null;
  verified: boolean;
  verified_at: string | null;
  notes: string | null;
  user_name?: string;
  verifier_name?: string;
}

const CREDENTIAL_TYPES = [
  { value: "mci_nmc",               label: "MCI / NMC Registration" },
  { value: "state_medical_council", label: "State Medical Council" },
  { value: "nursing_council",       label: "Nursing Council" },
  { value: "super_specialty",       label: "Super Specialty Degree" },
  { value: "skill_competency",      label: "Skill Competency" },
  { value: "bls_acls",             label: "BLS / ACLS" },
  { value: "other",                 label: "Other" },
];

const expiryStatus = (expiry: string | null) => {
  if (!expiry) return "none";
  const days = (new Date(expiry).getTime() - Date.now()) / 86400000;
  if (days < 0) return "expired";
  if (days <= 30) return "expiring";
  if (days <= 90) return "due_soon";
  return "valid";
};

const EXPIRY_STYLE: Record<string, string> = {
  expired:  "bg-red-100 text-red-700 border-red-200",
  expiring: "bg-amber-100 text-amber-700 border-amber-200",
  due_soon: "bg-yellow-50 text-yellow-700 border-yellow-200",
  valid:    "bg-emerald-100 text-emerald-700 border-emerald-200",
  none:     "bg-muted text-muted-foreground border-border",
};

const EXPIRY_LABEL: Record<string, string> = {
  expired:  "Expired",
  expiring: "Expiring Soon",
  due_soon: "Due in 90d",
  valid:    "Valid",
  none:     "No Expiry",
};

const EMPTY_FORM = {
  user_id: "",
  name: "",
  credential_type: "mci_nmc",
  credential_number: "",
  issuing_body: "",
  issued_date: "",
  expiry_date: "",
  document_url: "",
  notes: "",
};

const CredentialingTab: React.FC<Props> = ({ hospitalId }) => {
  const { toast } = useToast();
  const { userId } = useHospitalId();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [staff, setStaff] = useState<{ id: string; full_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    const [credRes, staffRes] = await Promise.all([
      (supabase as any)
        .from("staff_credentials")
        .select("*, u:users!staff_credentials_user_id_fkey(full_name), v:users!staff_credentials_verified_by_fkey(full_name)")
        .eq("hospital_id", hospitalId)
        .order("expiry_date", { ascending: true, nullsFirst: false }),
      supabase.from("users")
        .select("id, full_name")
        .eq("hospital_id", hospitalId)
        .eq("is_active", true),
    ]);

    setStaff(staffRes.data || []);
    setCredentials(
      (credRes.data || []).map((c: any) => ({
        ...c,
        user_name: c.u?.full_name,
        verifier_name: c.v?.full_name,
      }))
    );
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.user_id || !form.credential_type) return;
    setSaving(true);

    const { error } = await (supabase as any).from("staff_credentials").insert({
      hospital_id: hospitalId,
      user_id: form.user_id,
      name: form.name || null,
      credential_type: form.credential_type,
      credential_number: form.credential_number || null,
      issuing_body: form.issuing_body || null,
      issued_date: form.issued_date || null,
      expiry_date: form.expiry_date || null,
      document_url: form.document_url || null,
      notes: form.notes || null,
    });

    if (error) {
      toast({ title: "Failed to save credential", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    if (form.expiry_date) {
      const daysLeft = (new Date(form.expiry_date).getTime() - Date.now()) / 86400000;
      if (daysLeft <= 30) {
        const staffName = staff.find(s => s.id === form.user_id)?.full_name || "Staff";
        const typeLabel = CREDENTIAL_TYPES.find(t => t.value === form.credential_type)?.label || form.credential_type;
        await (supabase as any).from("clinical_alerts").insert({
          hospital_id: hospitalId,
          alert_type: "credential_expiry",
          severity: daysLeft < 0 ? "high" : "medium",
          message: `${staffName}'s ${typeLabel} ${daysLeft < 0 ? "has expired" : `expires in ${Math.ceil(daysLeft)} days`}`,
          is_acknowledged: false,
        }).catch(() => null);
      }
    }

    setSaving(false);
    setShowAdd(false);
    setForm(EMPTY_FORM);
    toast({ title: "Credential saved" });
    load();
  };

  const handleVerify = async (id: string) => {
    setVerifying(id);
    await (supabase as any).from("staff_credentials").update({
      verified: true,
      verified_by: userId || null,
      verified_at: new Date().toISOString(),
    }).eq("id", id);
    setVerifying(null);
    toast({ title: "Credential verified" });
    load();
  };

  const handleDelete = async (id: string) => {
    await (supabase as any).from("staff_credentials").delete().eq("id", id);
    toast({ title: "Credential removed" });
    load();
  };

  const expired  = credentials.filter(c => expiryStatus(c.expiry_date) === "expired");
  const expiring = credentials.filter(c => expiryStatus(c.expiry_date) === "expiring");
  const unverified = credentials.filter(c => !c.verified);

  const filtered = credentials.filter(c => {
    if (filterType !== "all" && c.credential_type !== filterType) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (c.user_name || "").toLowerCase().includes(q) ||
        (c.name || "").toLowerCase().includes(q) ||
        (c.credential_number || "").toLowerCase().includes(q) ||
        (c.issuing_body || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header bar */}
      <div className="p-4 border-b flex items-center justify-between gap-3 shrink-0 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-semibold">Credentials & Licenses</span>
          {expired.length > 0   && <Badge className="bg-red-100 text-red-700 border-red-200">{expired.length} Expired</Badge>}
          {expiring.length > 0  && <Badge className="bg-amber-100 text-amber-700 border-amber-200">{expiring.length} Expiring Soon</Badge>}
          {unverified.length > 0 && <Badge className="bg-muted text-muted-foreground">{unverified.length} Unverified</Badge>}
        </div>
        <Button size="sm" onClick={() => setShowAdd(!showAdd)} className="h-7 text-xs gap-1 shrink-0">
          <Plus className="h-3 w-3" /> Add Credential
        </Button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="border-b p-4 bg-muted/40 space-y-3 shrink-0">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Staff Member *</label>
              <select value={form.user_id} onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}
                className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                <option value="">Select staff…</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Credential Type *</label>
              <select value={form.credential_type} onChange={e => setForm(f => ({ ...f, credential_type: e.target.value }))}
                className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                {CREDENTIAL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Credential Name / Label</label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. MBBS — Maharashtra Medical Council" className="h-8 text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Registration / Credential No.</label>
              <Input value={form.credential_number} onChange={e => setForm(f => ({ ...f, credential_number: e.target.value }))}
                placeholder="e.g. MH-12345" className="h-8 text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Issuing Body</label>
              <Input value={form.issuing_body} onChange={e => setForm(f => ({ ...f, issuing_body: e.target.value }))}
                placeholder="e.g. Maharashtra Medical Council" className="h-8 text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Issued Date</label>
              <Input type="date" value={form.issued_date} onChange={e => setForm(f => ({ ...f, issued_date: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Expiry Date</label>
              <Input type="date" value={form.expiry_date} onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div className="col-span-2">
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Document URL (scanned copy link)</label>
              <Input value={form.document_url} onChange={e => setForm(f => ({ ...f, document_url: e.target.value }))}
                placeholder="https://drive.google.com/…" className="h-8 text-sm" />
            </div>
            <div className="col-span-2">
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Notes</label>
              <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Optional notes" className="h-8 text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving || !form.user_id} className="h-7 text-xs flex-1">
              {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />} Save Credential
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)} className="h-7 text-xs">Cancel</Button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="px-4 py-2 border-b flex items-center gap-2 shrink-0">
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search staff, credential…"
          className="h-7 text-xs max-w-[200px]" />
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="h-7 text-xs border border-input rounded px-2 bg-background">
          <option value="all">All Types</option>
          {CREDENTIAL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} records</span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading credentials…</span>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">
            {credentials.length === 0
              ? "No credentials on record. Add doctor registrations, nursing council numbers, and skill certifications."
              : "No credentials match your filter."}
          </p>
        ) : (
          <div className="space-y-2">
            {filtered.map(c => {
              const status = expiryStatus(c.expiry_date);
              const typeLabel = CREDENTIAL_TYPES.find(t => t.value === c.credential_type)?.label || c.credential_type;
              return (
                <div
                  key={c.id}
                  className={cn(
                    "border rounded-lg px-3 py-2.5 flex items-start justify-between gap-3",
                    status === "expired"  ? "border-red-200 bg-red-50/50 dark:bg-red-950/20" :
                    status === "expiring" ? "border-amber-200 bg-amber-50/50 dark:bg-amber-950/20" :
                    "border-border bg-card"
                  )}
                >
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{c.user_name || "—"}</span>
                      <span className="text-[10px] text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground">{typeLabel}</span>
                      {c.verified && <CheckCircle className="h-3.5 w-3.5 text-emerald-600 shrink-0" title={`Verified${c.verifier_name ? ` by ${c.verifier_name}` : ""}${c.verified_at ? ` on ${new Date(c.verified_at).toLocaleDateString("en-IN")}` : ""}`} />}
                    </div>
                    {c.name && <p className="text-xs text-foreground">{c.name}</p>}
                    <div className="flex items-center gap-3 flex-wrap">
                      {c.credential_number && <span className="text-[11px] font-mono text-foreground">{c.credential_number}</span>}
                      {c.issuing_body && <span className="text-[11px] text-muted-foreground">{c.issuing_body}</span>}
                      {c.expiry_date && (
                        <span className={cn("text-[10px] px-1.5 py-px rounded border font-medium", EXPIRY_STYLE[status])}>
                          {EXPIRY_LABEL[status]} · {new Date(c.expiry_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                        </span>
                      )}
                      {c.document_url && (
                        <a href={c.document_url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline">
                          <ExternalLink className="h-2.5 w-2.5" /> Document
                        </a>
                      )}
                    </div>
                    {c.notes && <p className="text-[10px] text-muted-foreground italic">{c.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                    {!c.verified && (
                      <Button size="sm" variant="outline" className="h-6 text-[10px]" disabled={verifying === c.id}
                        onClick={() => handleVerify(c.id)}>
                        {verifying === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Verify"}
                      </Button>
                    )}
                    <button onClick={() => handleDelete(c.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default CredentialingTab;
