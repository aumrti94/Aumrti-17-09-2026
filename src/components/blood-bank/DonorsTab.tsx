import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { formatBloodGroup } from "@/lib/bloodCompatibility";
import { format } from "date-fns";
import { Search, MessageCircle, Send, Printer, AlertTriangle } from "lucide-react";
import { buildQRString, printBloodBagLabel } from "@/lib/bloodBagLabel";

interface Props { showModal: boolean; onCloseModal: () => void }

// Component separation shelf lives in days
const COMPONENT_SHELF_LIFE: Record<string, number> = {
  whole_blood: 35,
  rbc: 42,
  ffp: 365,
  platelets: 5,
  cryoprecipitate: 365,
};

const DonorsTab: React.FC<Props> = ({ showModal, onCloseModal }) => {
  const { toast } = useToast();
  const [donors, setDonors] = useState<any[]>([]);
  const [recentUnits, setRecentUnits] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    full_name: "", dob: "", gender: "male", blood_group: "O", rh_factor: "positive",
    phone: "", address: "", hb_at_donation: "", weight_kg: "", bp_systolic: "", bp_diastolic: "",
    hiv_status: "not_tested", hbsag_status: "not_tested", hcv_status: "not_tested",
    vdrl_status: "not_tested", malaria_status: "not_tested",
    separate_components: true,
  });
  const [deferralMsg, setDeferralMsg] = useState("");
  const [step, setStep] = useState<"personal" | "screening" | "tti">("personal");
  const [showCampaign, setShowCampaign] = useState(false);
  const [hospitalName, setHospitalName] = useState("Hospital");

  const fetchDonors = async () => {
    const { data } = await supabase.from("donors").select("*").order("created_at", { ascending: false });
    if (data) setDonors(data);
  };

  const fetchRecentUnits = async () => {
    const { data } = await (supabase as any).from("blood_units")
      .select("id, unit_number, component, blood_group, rh_factor, status, collected_at, expiry_at, qr_code, quarantine_reason, donor_id, donors(full_name)")
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setRecentUnits(data);
  };

  const fetchHospitalName = async () => {
    const { data: u } = await supabase.from("users").select("hospital_id").limit(1).maybeSingle();
    if (!u?.hospital_id) return;
    const { data: h } = await supabase.from("hospitals").select("name").eq("id", u.hospital_id).maybeSingle();
    if (h?.name) setHospitalName(h.name);
  };

  useEffect(() => { fetchDonors(); fetchRecentUnits(); fetchHospitalName(); }, []);

  const filtered = donors.filter(d =>
    d.full_name.toLowerCase().includes(search.toLowerCase()) ||
    d.donor_code.toLowerCase().includes(search.toLowerCase()) ||
    d.blood_group.toLowerCase().includes(search.toLowerCase())
  );

  const eligibleDonors = donors.filter(d =>
    d.is_eligible && d.next_eligible && new Date(d.next_eligible) <= new Date() && d.phone
  );

  const validateScreening = (): boolean => {
    const hb = parseFloat(form.hb_at_donation);
    const wt = parseFloat(form.weight_kg);
    const sys = parseInt(form.bp_systolic);
    const dia = parseInt(form.bp_diastolic);
    if (hb < 12.5) { setDeferralMsg("DEFERRED: Haemoglobin below minimum (12.5 g/dL)"); return false; }
    if (wt < 45) { setDeferralMsg("DEFERRED: Weight below minimum (45 kg)"); return false; }
    if (sys < 100 || sys > 180) { setDeferralMsg("DEFERRED: Systolic BP out of range (100-180 mmHg)"); return false; }
    if (dia < 60 || dia > 100) { setDeferralMsg("DEFERRED: Diastolic BP out of range (60-100 mmHg)"); return false; }
    setDeferralMsg("");
    return true;
  };

  const submitDonor = async () => {
    const ttiMap = {
      tti_hiv: form.hiv_status,
      tti_hbsag: form.hbsag_status,
      tti_hcv: form.hcv_status,
      tti_vdrl: form.vdrl_status,
      tti_malaria: form.malaria_status,
    };
    const reactiveTests = Object.entries(ttiMap)
      .filter(([, v]) => v === "reactive")
      .map(([k]) => k.replace("tti_", "").toUpperCase());
    const reactive = reactiveTests.length > 0;

    const { data: user } = await supabase.from("users").select("id, hospital_id").limit(1).maybeSingle();
    if (!user) return;

    const donorCode = `BB-${new Date().getFullYear()}-${String(donors.length + 1).padStart(4, "0")}`;
    const today = new Date().toISOString().split("T")[0];

    const { data: donorData } = await supabase.from("donors").insert({
      hospital_id: user.hospital_id,
      donor_code: donorCode,
      full_name: form.full_name,
      dob: form.dob || null,
      gender: form.gender,
      blood_group: form.blood_group,
      rh_factor: form.rh_factor,
      phone: form.phone || null,
      address: form.address || null,
      hb_at_donation: parseFloat(form.hb_at_donation) || null,
      weight_kg: parseFloat(form.weight_kg) || null,
      bp_systolic: parseInt(form.bp_systolic) || null,
      bp_diastolic: parseInt(form.bp_diastolic) || null,
      hiv_status: form.hiv_status,
      hbsag_status: form.hbsag_status,
      hcv_status: form.hcv_status,
      vdrl_status: form.vdrl_status,
      malaria_status: form.malaria_status,
      is_eligible: !reactive,
      donation_count: reactive ? 0 : 1,
      last_donation: reactive ? null : today,
      next_eligible: reactive ? null : new Date(Date.now() + 90 * 86400000).toISOString().split("T")[0],
    }).select("id").maybeSingle();

    const donorId = donorData?.id || null;
    const now = Date.now();
    const collectedISO = new Date().toISOString();
    const bagStatus = reactive ? "quarantine" : "available";
    const quarantineReason = reactive ? `TTI reactive: ${reactiveTests.join(", ")}` : null;

    const bags: { component: string; volume_ml: number; shelf_days: number; storage_location: string }[] = form.separate_components
      ? [
          { component: "rbc", volume_ml: 280, shelf_days: COMPONENT_SHELF_LIFE.rbc, storage_location: "Blood Bank Fridge" },
          { component: "ffp", volume_ml: 150, shelf_days: COMPONENT_SHELF_LIFE.ffp, storage_location: "Deep Freezer" },
          { component: "platelets", volume_ml: 50, shelf_days: COMPONENT_SHELF_LIFE.platelets, storage_location: "Platelet Agitator" },
        ]
      : [{ component: "whole_blood", volume_ml: 450, shelf_days: COMPONENT_SHELF_LIFE.whole_blood, storage_location: "Processing Area" }];

    for (let i = 0; i < bags.length; i++) {
      const b = bags[i];
      const unitNum = `BU-${user.hospital_id.substring(0, 8)}-${b.component.toUpperCase()}-${String(now + i).slice(-5)}`;
      const qrCode = buildQRString(user.hospital_id, unitNum, collectedISO);
      await (supabase as any).from("blood_units").insert({
        hospital_id: user.hospital_id,
        unit_number: unitNum,
        donor_id: donorId,
        component: b.component,
        blood_group: form.blood_group,
        rh_factor: form.rh_factor,
        volume_ml: b.volume_ml,
        collected_at: collectedISO,
        expiry_at: new Date(now + b.shelf_days * 86400000).toISOString(),
        storage_location: b.storage_location,
        status: bagStatus,
        ...ttiMap,
        quarantine_reason: quarantineReason,
        qr_code: qrCode,
      });
    }

    if (reactive) {
      toast({
        title: `🚫 ${bags.length} Bag(s) QUARANTINED`,
        description: `Reactive: ${reactiveTests.join(", ")}. Bags blocked from issue.`,
        variant: "destructive",
      });
    } else {
      toast({
        title: `✓ TTI Clear — ${bags.length} bag(s) available`,
        description: `${donorCode} → ${bags.map(b => b.component.toUpperCase()).join(" + ")}`,
      });
    }

    onCloseModal();
    setStep("personal");
    fetchDonors();
    fetchRecentUnits();
  };

  const sendCampaignWhatsApp = (donor: any) => {
    const msg = encodeURIComponent(`Dear ${donor.full_name}, you are eligible to donate blood again. Your blood type ${formatBloodGroup(donor.blood_group, donor.rh_factor)} is needed. Please visit our Blood Bank. Thank you! 🩸`);
    window.open(`https://wa.me/${donor.phone?.replace(/\D/g, "")}?text=${msg}`, "_blank", "noopener,noreferrer");
  };

  const sendToAll = () => {
    if (eligibleDonors.length === 0) { toast({ title: "No eligible donors found" }); return; }
    eligibleDonors.forEach((d, i) => {
      setTimeout(() => sendCampaignWhatsApp(d), i * 500);
    });
    toast({ title: `Campaign sent to ${eligibleDonors.length} donors` });
    setShowCampaign(false);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border shrink-0">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search donors..." className="h-8 pl-8 text-xs" />
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowCampaign(true)} className="gap-1.5">
          <MessageCircle className="w-4 h-4" /> Campaign → Eligible ({eligibleDonors.length})
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Donors</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Code</TableHead>
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">Group</TableHead>
                <TableHead className="text-xs">Phone</TableHead>
                <TableHead className="text-xs">Last Donation</TableHead>
                <TableHead className="text-xs">Next Eligible</TableHead>
                <TableHead className="text-xs">Donations</TableHead>
                <TableHead className="text-xs">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(d => (
                <TableRow key={d.id}>
                  <TableCell className="text-xs font-mono">{d.donor_code}</TableCell>
                  <TableCell className="text-xs font-medium">{d.full_name}</TableCell>
                  <TableCell className="text-xs font-semibold">{formatBloodGroup(d.blood_group, d.rh_factor)}</TableCell>
                  <TableCell className="text-xs">{d.phone || "—"}</TableCell>
                  <TableCell className="text-xs">{d.last_donation ? format(new Date(d.last_donation), "dd/MM/yyyy") : "—"}</TableCell>
                  <TableCell className="text-xs">{d.next_eligible ? format(new Date(d.next_eligible), "dd/MM/yyyy") : "—"}</TableCell>
                  <TableCell className="text-xs">{d.donation_count}</TableCell>
                  <TableCell>
                    {!d.is_eligible ? <Badge className="bg-destructive/15 text-destructive text-[10px]">Deferred</Badge>
                      : d.next_eligible && new Date(d.next_eligible) > new Date()
                        ? <Badge className="bg-amber-500/15 text-amber-700 text-[10px]">Cooldown</Badge>
                        : <Badge className="bg-emerald-500/15 text-emerald-700 text-[10px]">Eligible</Badge>}
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">No donors registered yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Recent Blood Bags ({recentUnits.length})</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Bag No</TableHead>
                <TableHead className="text-xs">Component</TableHead>
                <TableHead className="text-xs">Group</TableHead>
                <TableHead className="text-xs">Donor</TableHead>
                <TableHead className="text-xs">Collected</TableHead>
                <TableHead className="text-xs">Expires</TableHead>
                <TableHead className="text-xs">TTI / Status</TableHead>
                <TableHead className="text-xs">Label</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentUnits.map(u => {
                const isQuarantine = u.status === "quarantine";
                const isAvailable = u.status === "available";
                return (
                  <TableRow key={u.id} className={isQuarantine ? "bg-destructive/5" : ""}>
                    <TableCell className="text-xs font-mono">{u.unit_number}</TableCell>
                    <TableCell className="text-xs">{u.component?.replace(/_/g, " ").toUpperCase()}</TableCell>
                    <TableCell className="text-xs font-semibold">{formatBloodGroup(u.blood_group, u.rh_factor)}</TableCell>
                    <TableCell className="text-xs">{u.donors?.full_name || "—"}</TableCell>
                    <TableCell className="text-xs">{u.collected_at ? format(new Date(u.collected_at), "dd/MM/yyyy") : "—"}</TableCell>
                    <TableCell className="text-xs">{u.expiry_at ? format(new Date(u.expiry_at), "dd/MM/yyyy") : "—"}</TableCell>
                    <TableCell>
                      {isQuarantine ? (
                        <div className="flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-destructive" />
                          <Badge className="bg-destructive text-destructive-foreground text-[10px]">QUARANTINED</Badge>
                          {u.quarantine_reason && <span className="text-[9px] text-destructive ml-1">{u.quarantine_reason}</span>}
                        </div>
                      ) : isAvailable ? (
                        <Badge className="bg-emerald-500/15 text-emerald-700 text-[10px]">✓ TTI Clear — Available</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] capitalize">{u.status}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] gap-1"
                        onClick={() =>
                          printBloodBagLabel({
                            hospitalName,
                            unitNumber: u.unit_number,
                            component: u.component,
                            bloodGroup: u.blood_group,
                            rhFactor: u.rh_factor,
                            collectedAt: u.collected_at,
                            expiryAt: u.expiry_at,
                            qrCode: u.qr_code || buildQRString("00000000", u.unit_number, u.collected_at),
                            ttiStatus: isQuarantine ? "quarantine" : isAvailable ? "available" : "pending_tti",
                            quarantineReason: u.quarantine_reason,
                          })
                        }
                      >
                        <Printer className="w-3 h-3" /> Print
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {recentUnits.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">No blood bags yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Campaign Modal */}
      <Dialog open={showCampaign} onOpenChange={setShowCampaign}>
        <DialogContent className="max-w-lg max-h-[70vh] overflow-y-auto">
          <DialogHeader><DialogTitle>🩸 Donor Recall Campaign</DialogTitle></DialogHeader>
          {eligibleDonors.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No eligible donors available for recall at this time.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">{eligibleDonors.length} donors are past their cooldown period and can donate again.</p>
              <div className="space-y-1 max-h-[40vh] overflow-y-auto">
                {eligibleDonors.map(d => (
                  <div key={d.id} className="flex items-center justify-between p-2 border border-border rounded text-xs">
                    <div>
                      <span className="font-medium">{d.full_name}</span>
                      <span className="ml-2 text-muted-foreground">{formatBloodGroup(d.blood_group, d.rh_factor)}</span>
                      <span className="ml-2 text-muted-foreground">{d.phone}</span>
                    </div>
                    <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => sendCampaignWhatsApp(d)}>
                      <Send className="w-3 h-3" /> WhatsApp
                    </Button>
                  </div>
                ))}
              </div>
              <Button className="w-full gap-1.5" onClick={sendToAll}>
                <MessageCircle className="w-4 h-4" /> Send WhatsApp to All ({eligibleDonors.length})
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Donor Registration Modal */}
      <Dialog open={showModal} onOpenChange={onCloseModal}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Register Donor</DialogTitle></DialogHeader>

          {step === "personal" && (
            <div className="space-y-3">
              <div><Label className="text-xs">Full Name *</Label><Input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} className="h-9" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">Date of Birth</Label><Input type="date" value={form.dob} onChange={e => setForm(f => ({ ...f, dob: e.target.value }))} className="h-9" /></div>
                <div><Label className="text-xs">Gender</Label>
                  <Select value={form.gender} onValueChange={v => setForm(f => ({ ...f, gender: v }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="male">Male</SelectItem><SelectItem value="female">Female</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">Blood Group *</Label>
                  <Select value={form.blood_group} onValueChange={v => setForm(f => ({ ...f, blood_group: v }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>{['A','B','AB','O'].map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs">Rh Factor *</Label>
                  <Select value={form.rh_factor} onValueChange={v => setForm(f => ({ ...f, rh_factor: v }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="positive">Positive</SelectItem><SelectItem value="negative">Negative</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              <div><Label className="text-xs">Phone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="h-9" /></div>
              <div><Label className="text-xs">Address</Label><Textarea value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} rows={2} /></div>
              <Button className="w-full" onClick={() => { if (form.full_name) setStep("screening"); }}>Next → Screening</Button>
            </div>
          )}

          {step === "screening" && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">Pre-Donation Screening</p>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">Haemoglobin (g/dL) *</Label><Input type="number" step="0.1" value={form.hb_at_donation} onChange={e => setForm(f => ({ ...f, hb_at_donation: e.target.value }))} className="h-9" placeholder="≥12.5" /></div>
                <div><Label className="text-xs">Weight (kg) *</Label><Input type="number" value={form.weight_kg} onChange={e => setForm(f => ({ ...f, weight_kg: e.target.value }))} className="h-9" placeholder="≥45" /></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">BP Systolic *</Label><Input type="number" value={form.bp_systolic} onChange={e => setForm(f => ({ ...f, bp_systolic: e.target.value }))} className="h-9" placeholder="100-180" /></div>
                <div><Label className="text-xs">BP Diastolic *</Label><Input type="number" value={form.bp_diastolic} onChange={e => setForm(f => ({ ...f, bp_diastolic: e.target.value }))} className="h-9" placeholder="60-100" /></div>
              </div>
              {deferralMsg && <div className="bg-red-50 border border-red-300 rounded p-3 text-sm text-red-700 font-semibold">{deferralMsg}</div>}
              <div className="flex items-center gap-2 p-3 bg-muted/30 rounded-lg">
                <Checkbox
                  id="separate"
                  checked={form.separate_components}
                  onCheckedChange={(v) => setForm(f => ({ ...f, separate_components: !!v }))}
                />
                <Label htmlFor="separate" className="text-xs cursor-pointer">
                  Separate into components (RBC + FFP + Platelets)
                </Label>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep("personal")}>← Back</Button>
                <Button className="flex-1" onClick={() => { if (validateScreening()) setStep("tti"); }}>Next → TTI Results</Button>
              </div>
            </div>
          )}

          {step === "tti" && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">TTI Screening Results</p>
              {(['hiv_status','hbsag_status','hcv_status','vdrl_status','malaria_status'] as const).map(field => (
                <div key={field} className="flex items-center justify-between">
                  <Label className="text-xs capitalize">{field.replace('_status','').replace('hbsag','HBsAg').replace('hcv','HCV').replace('vdrl','VDRL').replace('hiv','HIV').replace('malaria','Malaria')}</Label>
                  <div className="flex gap-2">
                    <Button size="sm" variant={form[field] === "non_reactive" ? "default" : "outline"}
                      className={form[field] === "non_reactive" ? "bg-green-600" : ""}
                      onClick={() => setForm(f => ({ ...f, [field]: "non_reactive" }))}>Non-Reactive</Button>
                    <Button size="sm" variant={form[field] === "reactive" ? "default" : "outline"}
                      className={form[field] === "reactive" ? "bg-red-600" : ""}
                      onClick={() => setForm(f => ({ ...f, [field]: "reactive" }))}>Reactive</Button>
                  </div>
                </div>
              ))}
              {[form.hiv_status, form.hbsag_status, form.hcv_status, form.vdrl_status, form.malaria_status].some(s => s === "reactive") && (
                <div className="bg-red-50 border border-red-300 rounded p-3 text-sm text-red-700 font-semibold">
                  ⚠️ REACTIVE detected — Donor will be permanently deferred. Blood unit will be discarded.
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep("screening")}>← Back</Button>
                <Button className="flex-1" onClick={submitDonor}>
                  Register Donor & {form.separate_components ? "Separate Components" : "Collect Whole Blood"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DonorsTab;
