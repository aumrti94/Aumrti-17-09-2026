import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Users, Plus, CheckCircle2, Search } from "lucide-react";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";

interface Beneficiary {
  id: string;
  patient_id: string;
  scheme_id: string;
  beneficiary_id: string;
  card_number: string | null;
  family_id: string | null;
  beneficiary_name: string | null;
  verification_status: string;
  expiry_date: string | null;
  created_at: string;
}

interface Scheme { id: string; scheme_name: string; scheme_code: string; }

interface Props {
  showNewForm: boolean;
  onFormClosed: () => void;
}

const PmjayBeneficiariesTab: React.FC<Props> = ({ showNewForm, onFormClosed }) => {
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [patients, setPatients] = useState<Record<string, string>>({});
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [schemeMap, setSchemeMap] = useState<Record<string, string>>({});
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  // Form state
  const [patientSearch, setPatientSearch] = useState("");
  const [patientResults, setPatientResults] = useState<{ id: string; full_name: string; phone: string }[]>([]);
  const [form, setForm] = useState({
    patient_id: "",
    patient_name: "",
    scheme_id: "",
    beneficiary_id: "",
    card_number: "",
    family_id: "",
    beneficiary_name: "",
    expiry_date: undefined as Date | undefined,
  });

  useEffect(() => { loadData(); }, []);
  useEffect(() => { if (showNewForm) setShowForm(true); }, [showNewForm]);

  const loadData = async () => {
    setLoading(true);
    const [bRes, sRes] = await Promise.all([
      supabase.from("scheme_beneficiaries").select("*").order("created_at", { ascending: false }),
      supabase.from("govt_schemes").select("id, scheme_name, scheme_code").eq("is_active", true),
    ]);
    const rows = (bRes.data || []) as Beneficiary[];
    setBeneficiaries(rows);
    setSchemes((sRes.data || []) as Scheme[]);
    setSchemeMap(Object.fromEntries((sRes.data || []).map((s: any) => [s.id, s.scheme_name])));

    if (rows.length > 0) {
      const pIds = [...new Set(rows.map(r => r.patient_id))];
      const { data: pData } = await supabase.from("patients").select("id, full_name").in("id", pIds);
      setPatients(Object.fromEntries((pData || []).map(p => [p.id, p.full_name])));
    }
    setLoading(false);
  };

  const searchPatients = async (q: string) => {
    setPatientSearch(q);
    if (q.length < 2) { setPatientResults([]); return; }
    const { data } = await supabase.from("patients").select("id, full_name, phone").or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`).limit(6);
    setPatientResults((data || []) as any[]);
  };

  const selectPatient = (p: { id: string; full_name: string }) => {
    setForm({ ...form, patient_id: p.id, patient_name: p.full_name });
    setPatientSearch(p.full_name);
    setPatientResults([]);
  };

  const handleRegister = async () => {
    if (!form.patient_id || !form.scheme_id || !form.beneficiary_id) {
      toast({ title: "Fill required fields", variant: "destructive" });
      return;
    }
    const { data: userData } = await supabase.from("users").select("hospital_id").eq("auth_user_id", (await supabase.auth.getUser()).data.user?.id || "").maybeSingle();
    if (!userData?.hospital_id) { toast({ title: "Hospital not found", variant: "destructive" }); return; }

    const { error } = await supabase.from("scheme_beneficiaries").insert({
      hospital_id: userData.hospital_id,
      patient_id: form.patient_id,
      scheme_id: form.scheme_id,
      beneficiary_id: form.beneficiary_id,
      card_number: form.card_number || null,
      family_id: form.family_id || null,
      beneficiary_name: form.beneficiary_name || null,
      expiry_date: form.expiry_date ? format(form.expiry_date, "yyyy-MM-dd") : null,
      verification_status: "pending",
    });

    if (error) { toast({ title: "Registration failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Beneficiary registered" });
    setShowForm(false);
    onFormClosed();
    setForm({ patient_id: "", patient_name: "", scheme_id: "", beneficiary_id: "", card_number: "", family_id: "", beneficiary_name: "", expiry_date: undefined });
    setPatientSearch("");
    loadData();
  };

  const verifyBeneficiary = async (id: string) => {
    await supabase.from("scheme_beneficiaries").update({
      verification_status: "verified",
      verified_at: new Date().toISOString(),
    }).eq("id", id);
    toast({ title: "Beneficiary verified" });
    loadData();
  };

  const statusColor = (s: string) => {
    if (s === "verified") return "bg-emerald-50 text-emerald-700";
    if (s === "pending") return "bg-amber-50 text-amber-700";
    if (s === "expired") return "bg-red-50 text-red-700";
    return "bg-muted text-muted-foreground";
  };

  const filteredBeneficiaries = search
    ? beneficiaries.filter(b =>
        (patients[b.patient_id] || "").toLowerCase().includes(search.toLowerCase()) ||
        b.beneficiary_id.toLowerCase().includes(search.toLowerCase())
      )
    : beneficiaries;

  if (loading) return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading...</div>;

  return (
    <div className="flex h-full overflow-hidden">
      {/* List */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input className="pl-8 w-64 h-9" placeholder="Search by name or ID..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <Button size="sm" onClick={() => setShowForm(true)} className="gap-1">
            <Plus size={14} /> Register Beneficiary
          </Button>
        </div>

        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted-foreground">Patient</th>
                <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted-foreground">Scheme</th>
                <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted-foreground">Beneficiary ID</th>
                <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted-foreground">Name on Card</th>
                <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted-foreground">Status</th>
                <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted-foreground">Expiry</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filteredBeneficiaries.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No beneficiaries registered</td></tr>
              ) : filteredBeneficiaries.map(b => (
                <tr key={b.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2 font-medium">{patients[b.patient_id] || "—"}</td>
                  <td className="px-3 py-2">{schemeMap[b.scheme_id] || "—"}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{b.beneficiary_id}</td>
                  <td className="px-3 py-2">{b.beneficiary_name || "—"}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={cn("text-[9px] capitalize", statusColor(b.verification_status))}>
                      {b.verification_status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-[12px]">{b.expiry_date ? format(new Date(b.expiry_date), "dd/MM/yyyy") : "—"}</td>
                  <td className="px-3 py-2">
                    {b.verification_status === "pending" && (
                      <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1" onClick={() => verifyBeneficiary(b.id)}>
                        <CheckCircle2 size={12} /> Verify
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Registration Form */}
      {showForm && (
        <div className="w-[380px] border-l border-border bg-background p-4 overflow-y-auto">
          <h3 className="text-sm font-bold mb-4">Register Beneficiary</h3>
          <div className="space-y-3">
            <div>
              <Label className="text-[11px]">Patient *</Label>
              <Input className="mt-1" placeholder="Search patient..." value={patientSearch} onChange={e => searchPatients(e.target.value)} />
              {patientResults.length > 0 && (
                <div className="border border-border rounded mt-1 bg-background max-h-32 overflow-y-auto">
                  {patientResults.map(p => (
                    <button key={p.id} onClick={() => selectPatient(p)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted">
                      {p.full_name} <span className="text-muted-foreground">({p.phone})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <Label className="text-[11px]">Scheme *</Label>
              <Select value={form.scheme_id} onValueChange={v => setForm({ ...form, scheme_id: v })}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select scheme" /></SelectTrigger>
                <SelectContent>
                  {schemes.map(s => <SelectItem key={s.id} value={s.id}>{s.scheme_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px]">Beneficiary ID *</Label>
              <Input className="mt-1" value={form.beneficiary_id} onChange={e => setForm({ ...form, beneficiary_id: e.target.value })} placeholder="Ayushman card number" />
            </div>
            <div>
              <Label className="text-[11px]">Card Number</Label>
              <Input className="mt-1" value={form.card_number} onChange={e => setForm({ ...form, card_number: e.target.value })} />
            </div>
            <div>
              <Label className="text-[11px]">Family ID</Label>
              <Input className="mt-1" value={form.family_id} onChange={e => setForm({ ...form, family_id: e.target.value })} />
            </div>
            <div>
              <Label className="text-[11px]">Name on Card</Label>
              <Input className="mt-1" value={form.beneficiary_name} onChange={e => setForm({ ...form, beneficiary_name: e.target.value })} placeholder="As printed on card" />
            </div>
            <div>
              <Label className="text-[11px]">Expiry Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full mt-1 justify-start text-left font-normal", !form.expiry_date && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {form.expiry_date ? format(form.expiry_date, "dd/MM/yyyy") : "Pick date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={form.expiry_date} onSelect={d => setForm({ ...form, expiry_date: d })} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleRegister} className="flex-1">Register</Button>
              <Button variant="outline" onClick={() => { setShowForm(false); onFormClosed(); }}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PmjayBeneficiariesTab;
