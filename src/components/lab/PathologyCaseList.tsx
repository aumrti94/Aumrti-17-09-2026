import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Microscope, Plus, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import PathologyCaseWorkspace from "./PathologyCaseWorkspace";

// Histopathology / cytology case list + registration (lab plan Phase 7).

interface CaseRow {
  id: string;
  case_number: string;
  case_type: string;
  specimen_type: string | null;
  status: string;
  received_at: string | null;
  patients?: { full_name: string; uhid: string } | null;
}

const STATUS_BADGE: Record<string, string> = {
  registered: "bg-muted text-muted-foreground",
  grossing: "bg-blue-100 text-blue-700",
  reporting: "bg-blue-100 text-blue-700",
  pending_signoff: "bg-amber-100 text-amber-700",
  signed_off: "bg-emerald-100 text-emerald-700",
  amended: "bg-purple-100 text-purple-700",
};

interface Props { hospitalId: string; }

const PathologyCaseList: React.FC<Props> = ({ hospitalId }) => {
  const { toast } = useToast();
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showRegister, setShowRegister] = useState(false);

  const fetchCases = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("pathology_cases")
      .select("id, case_number, case_type, specimen_type, status, received_at, patients(full_name, uhid)")
      .eq("hospital_id", hospitalId)
      .order("created_at", { ascending: false })
      .limit(200);
    setCases(data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { fetchCases(); }, [fetchCases]);

  return (
    <div className="flex flex-1 overflow-hidden h-full">
      {/* Left: case list */}
      <div className="w-[320px] shrink-0 border-r border-border flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-[13px] font-bold flex items-center gap-1.5"><Microscope size={14} /> Pathology Cases</span>
          <Button size="sm" className="h-7 text-[11px] gap-1" onClick={() => setShowRegister(true)}>
            <Plus size={12} /> Register
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-border">
          {loading ? (
            <div className="flex items-center justify-center h-32"><Loader2 className="animate-spin text-muted-foreground" size={18} /></div>
          ) : cases.length === 0 ? (
            <div className="p-6 text-center text-[12px] text-muted-foreground">
              No pathology cases yet. Register a specimen to begin.
            </div>
          ) : (
            cases.map(c => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={cn("w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors",
                  selectedId === c.id && "bg-blue-50 border-l-2 border-l-blue-500")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold truncate">{c.patients?.full_name || "—"}</span>
                  <Badge className={cn("text-[9px] shrink-0", STATUS_BADGE[c.status])}>{c.status.replace(/_/g, " ")}</Badge>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                  <span className="font-mono">{c.case_number}</span>
                  <span className="capitalize">· {c.case_type}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right: case workspace */}
      {selectedId ? (
        <PathologyCaseWorkspace caseId={selectedId} hospitalId={hospitalId} onChanged={fetchCases} />
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Microscope size={40} className="mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">Select a case, or register a new specimen</p>
          </div>
        </div>
      )}

      {showRegister && (
        <RegisterCaseModal
          hospitalId={hospitalId}
          onClose={() => setShowRegister(false)}
          onCreated={(id) => { setShowRegister(false); fetchCases(); setSelectedId(id); }}
        />
      )}
    </div>
  );
};

// ── Specimen registration modal ──────────────────────────────────────────────
const RegisterCaseModal: React.FC<{ hospitalId: string; onClose: () => void; onCreated: (id: string) => void }> = ({ hospitalId, onClose, onCreated }) => {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [patients, setPatients] = useState<{ id: string; full_name: string; uhid: string }[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<{ id: string; full_name: string; uhid: string } | null>(null);
  const [caseType, setCaseType] = useState<"histopathology" | "cytology">("histopathology");
  const [specimenType, setSpecimenType] = useState("");
  const [specimenSite, setSpecimenSite] = useState("");
  const [clinicalHistory, setClinicalHistory] = useState("");
  const [saving, setSaving] = useState(false);

  // Debounced patient search (same pattern as NewLabOrderModal)
  useEffect(() => {
    if (selectedPatient || search.trim().length < 2) { setPatients([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("patients")
        .select("id, full_name, uhid")
        .eq("hospital_id", hospitalId)
        .eq("is_active", true)
        .or(`full_name.ilike.%${search}%,uhid.ilike.%${search}%`)
        .limit(8);
      setPatients(data || []);
    }, 250);
    return () => clearTimeout(t);
  }, [search, selectedPatient, hospitalId]);

  const register = async () => {
    if (!selectedPatient) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: userData } = await supabase.from("users").select("id").eq("auth_user_id", user?.id).limit(1).maybeSingle();
      const { data: caseNo } = await (supabase as any).rpc("next_pathology_case_number", { p_hospital_id: hospitalId, p_case_type: caseType });
      const { data, error } = await (supabase as any).from("pathology_cases").insert({
        hospital_id: hospitalId,
        patient_id: selectedPatient.id,
        case_number: caseNo,
        case_type: caseType,
        specimen_type: specimenType || null,
        specimen_site: specimenSite || null,
        clinical_history: clinicalHistory || null,
        status: "registered",
        received_at: new Date().toISOString(),
        created_by: userData?.id || null,
      }).select("id").maybeSingle();
      if (error) throw error;
      toast({ title: `✓ Registered ${caseNo}` });
      onCreated(data.id);
    } catch (e: any) {
      toast({ title: "Registration failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Register Pathology Specimen</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {/* Patient */}
          {selectedPatient ? (
            <div className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2">
              <div>
                <p className="text-sm font-semibold">{selectedPatient.full_name}</p>
                <p className="text-[11px] text-muted-foreground">{selectedPatient.uhid}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setSelectedPatient(null); setSearch(""); }}>Change</Button>
            </div>
          ) : (
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient name or UHID…" className="pl-8 h-9 text-sm" />
              {patients.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-popover border border-border rounded-md shadow-lg max-h-56 overflow-y-auto">
                  {patients.map(p => (
                    <button key={p.id} onClick={() => { setSelectedPatient(p); setPatients([]); }}
                      className="w-full text-left px-3 py-2 hover:bg-muted text-sm">
                      <span className="font-medium">{p.full_name}</span> <span className="text-muted-foreground text-[11px]">· {p.uhid}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Case Type</label>
              <select value={caseType} onChange={e => setCaseType(e.target.value as any)}
                className="mt-1 w-full h-9 text-sm border border-border rounded-md px-2 bg-background">
                <option value="histopathology">Histopathology</option>
                <option value="cytology">Cytology</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Specimen Type</label>
              <Input value={specimenType} onChange={e => setSpecimenType(e.target.value)} placeholder="e.g. Biopsy, FNAC, Resection" className="mt-1 h-9 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Specimen Site</label>
            <Input value={specimenSite} onChange={e => setSpecimenSite(e.target.value)} placeholder="e.g. Left breast, Colon" className="mt-1 h-9 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Clinical History</label>
            <Textarea value={clinicalHistory} onChange={e => setClinicalHistory(e.target.value)} placeholder="Relevant clinical details…" className="mt-1 text-sm min-h-[70px]" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={register} disabled={!selectedPatient || saving}>
            {saving ? <><Loader2 size={12} className="animate-spin" /> Registering…</> : "Register Specimen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PathologyCaseList;
