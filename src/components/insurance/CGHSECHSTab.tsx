import React, { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, CheckCircle2, Search, IndianRupee } from "lucide-react";

// CGHS 2023 Package Rates (₹) — Ward Entitlement: Private / Semi-Private / General
// Source: CGHS Rate Revision 2023, MoHFW
const CGHS_RATES: { code: string; procedure: string; private: number; semi: number; general: number; category: string }[] = [
  { code: "SUR001", procedure: "Appendectomy (Open)", private: 28000, semi: 22400, general: 16800, category: "Surgery" },
  { code: "SUR002", procedure: "Appendectomy (Laparoscopic)", private: 34000, semi: 27200, general: 20400, category: "Surgery" },
  { code: "SUR003", procedure: "Cholecystectomy (Open)", private: 30000, semi: 24000, general: 18000, category: "Surgery" },
  { code: "SUR004", procedure: "Cholecystectomy (Laparoscopic)", private: 37000, semi: 29600, general: 22200, category: "Surgery" },
  { code: "SUR005", procedure: "Hernia Repair (Open)", private: 27000, semi: 21600, general: 16200, category: "Surgery" },
  { code: "SUR006", procedure: "Hernia Repair (Laparoscopic)", private: 34000, semi: 27200, general: 20400, category: "Surgery" },
  { code: "SUR007", procedure: "Hysterectomy (Abdominal)", private: 34000, semi: 27200, general: 20400, category: "Gynaecology" },
  { code: "SUR008", procedure: "Hysterectomy (Laparoscopic)", private: 44000, semi: 35200, general: 26400, category: "Gynaecology" },
  { code: "SUR009", procedure: "LSCS (Caesarean)", private: 27000, semi: 21600, general: 16200, category: "Obstetrics" },
  { code: "SUR010", procedure: "Normal Delivery", private: 10000, semi: 8000, general: 6000, category: "Obstetrics" },
  { code: "CAR001", procedure: "Coronary Angiography", private: 15000, semi: 12000, general: 9000, category: "Cardiology" },
  { code: "CAR002", procedure: "PTCA (single vessel)", private: 95000, semi: 76000, general: 57000, category: "Cardiology" },
  { code: "CAR003", procedure: "PTCA (multi vessel)", private: 125000, semi: 100000, general: 75000, category: "Cardiology" },
  { code: "CAR004", procedure: "CABG (on pump)", private: 175000, semi: 140000, general: 105000, category: "Cardiology" },
  { code: "CAR005", procedure: "Pacemaker Implant (Single Chamber)", private: 110000, semi: 88000, general: 66000, category: "Cardiology" },
  { code: "ORT001", procedure: "Total Hip Replacement", private: 150000, semi: 120000, general: 90000, category: "Orthopaedics" },
  { code: "ORT002", procedure: "Total Knee Replacement", private: 150000, semi: 120000, general: 90000, category: "Orthopaedics" },
  { code: "ORT003", procedure: "Spinal Fusion (Lumbar)", private: 120000, semi: 96000, general: 72000, category: "Orthopaedics" },
  { code: "ORT004", procedure: "ORIF Femur", private: 55000, semi: 44000, general: 33000, category: "Orthopaedics" },
  { code: "NEU001", procedure: "Craniotomy", private: 175000, semi: 140000, general: 105000, category: "Neurosurgery" },
  { code: "NEU002", procedure: "VP Shunt", private: 95000, semi: 76000, general: 57000, category: "Neurosurgery" },
  { code: "URO001", procedure: "TURP", private: 42000, semi: 33600, general: 25200, category: "Urology" },
  { code: "URO002", procedure: "PCNL", private: 52000, semi: 41600, general: 31200, category: "Urology" },
  { code: "URO003", procedure: "URS with Lithotripsy", private: 37000, semi: 29600, general: 22200, category: "Urology" },
  { code: "OPH001", procedure: "Cataract Surgery (Phaco)", private: 18000, semi: 14400, general: 10800, category: "Ophthalmology" },
  { code: "OPH002", procedure: "Vitrectomy", private: 55000, semi: 44000, general: 33000, category: "Ophthalmology" },
  { code: "ENT001", procedure: "Tonsillectomy", private: 15000, semi: 12000, general: 9000, category: "ENT" },
  { code: "ENT002", procedure: "Septoplasty / FESS", private: 27000, semi: 21600, general: 16200, category: "ENT" },
  { code: "DAY001", procedure: "Chemotherapy (per cycle)", private: 12000, semi: 9600, general: 7200, category: "Oncology" },
  { code: "DAY002", procedure: "Dialysis (per session)", private: 1500, semi: 1200, general: 900, category: "Nephrology" },
  { code: "ICU001", procedure: "ICU per day (without ventilator)", private: 5500, semi: 4400, general: 3300, category: "ICU" },
  { code: "ICU002", procedure: "ICU per day (with ventilator)", private: 7500, semi: 6000, general: 4500, category: "ICU" },
  { code: "MED001", procedure: "Medical Management per day (private)", private: 2500, semi: 2000, general: 1500, category: "Medicine" },
];

const ENTITLEMENT_GROUPS = [
  { label: "Group A (Jt Secy & above)", ward: "private" as const },
  { label: "Group B (Director / equivalent)", ward: "private" as const },
  { label: "Group C (Grade Pay 5400–6600)", ward: "semi" as const },
  { label: "Group D (Grade Pay 2800–4600)", ward: "general" as const },
  { label: "Pensioner (above 8700 grade)", ward: "private" as const },
  { label: "Pensioner (below 8700 grade)", ward: "semi" as const },
];

const CGHSECHSTab: React.FC = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const [searchQuery, setSearchQuery] = useState("");
  const [entitlementGroup, setEntitlementGroup] = useState<"private" | "semi" | "general">("semi");
  const [checkAmount, setCheckAmount] = useState("");
  const [checkProcedure, setCheckProcedure] = useState("");
  const [claimCheckResult, setClaimCheckResult] = useState<{ allowed: number; excess: number; compliant: boolean } | null>(null);

  // Beneficiary form
  const [beneForm, setBeneForm] = useState({ cghs_id: "", beneficiary_name: "", group: "", card_type: "cghs", echs_card_no: "", referral_hospital: "", referral_date: "" });
  const [savingBene, setSavingBene] = useState(false);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return CGHS_RATES.filter(r => r.procedure.toLowerCase().includes(q) || r.code.toLowerCase().includes(q) || r.category.toLowerCase().includes(q));
  }, [searchQuery]);

  const checkClaim = () => {
    const rate = CGHS_RATES.find(r => r.procedure.toLowerCase().includes(checkProcedure.toLowerCase()));
    if (!rate) { toast({ title: "Procedure not found in CGHS rate list", variant: "destructive" }); return; }
    const allowed = rate[entitlementGroup];
    const claimed = parseFloat(checkAmount) || 0;
    const excess = Math.max(0, claimed - allowed);
    setClaimCheckResult({ allowed, excess, compliant: claimed <= allowed });
  };

  const saveBeneficiary = async () => {
    if (!hospitalId || !beneForm.beneficiary_name) return;
    setSavingBene(true);
    const { error } = await (supabase as any).from("cghs_echs_beneficiaries").insert({
      hospital_id: hospitalId,
      cghs_id: beneForm.cghs_id || null,
      beneficiary_name: beneForm.beneficiary_name,
      entitlement_group: beneForm.group || null,
      card_type: beneForm.card_type,
      echs_card_no: beneForm.echs_card_no || null,
      referral_hospital: beneForm.referral_hospital || null,
      referral_date: beneForm.referral_date || null,
    });
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Beneficiary registered" });
      setBeneForm({ cghs_id: "", beneficiary_name: "", group: "", card_type: "cghs", echs_card_no: "", referral_hospital: "", referral_date: "" });
    }
    setSavingBene(false);
  };

  return (
    <div className="flex flex-col gap-4 p-4 overflow-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold">CGHS / ECHS Workflows</h2>
          <p className="text-xs text-muted-foreground">Central Government Health Scheme & Ex-Servicemen Contributory Health Scheme</p>
        </div>
        <Badge variant="outline" className="text-[10px]">CGHS 2023 Rates</Badge>
      </div>

      <Tabs defaultValue="rates">
        <TabsList className="h-8">
          <TabsTrigger value="rates" className="text-xs">Rate Schedule</TabsTrigger>
          <TabsTrigger value="check" className="text-xs">Claim Check</TabsTrigger>
          <TabsTrigger value="beneficiary" className="text-xs">Register Beneficiary</TabsTrigger>
          <TabsTrigger value="rules" className="text-xs">Claim Rules</TabsTrigger>
        </TabsList>

        {/* CGHS Rate Schedule */}
        <TabsContent value="rates" className="mt-3">
          <div className="flex items-center gap-3 mb-3">
            <div className="relative flex-1 max-w-sm">
              <Search size={13} className="absolute left-2.5 top-2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search procedure..."
                className="pl-8 h-8 text-xs"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs whitespace-nowrap">Ward Entitlement:</Label>
              <select
                value={entitlementGroup}
                onChange={e => setEntitlementGroup(e.target.value as "private" | "semi" | "general")}
                className="h-8 text-xs border border-input rounded-md px-2 bg-background"
              >
                <option value="private">Private Ward</option>
                <option value="semi">Semi-Private</option>
                <option value="general">General Ward</option>
              </select>
            </div>
          </div>

          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-[10px] font-bold uppercase text-muted-foreground">
                  <th className="px-3 py-2 text-left">Code</th>
                  <th className="px-3 py-2 text-left">Procedure</th>
                  <th className="px-3 py-2 text-center">Category</th>
                  <th className="px-3 py-2 text-right">CGHS Rate (₹)</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.code} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2 text-xs font-mono text-muted-foreground">{r.code}</td>
                    <td className="px-3 py-2 text-xs">{r.procedure}</td>
                    <td className="px-3 py-2 text-center">
                      <Badge variant="outline" className="text-[9px]">{r.category}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right text-xs font-mono font-bold">
                      ₹{r[entitlementGroup].toLocaleString("en-IN")}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-8 text-center text-xs text-muted-foreground">No procedures found</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Rates per CGHS/MoHFW 2023 revision. Private ward = 100%, Semi-private = 80%, General = 60% of base rate.
            Implant costs billed at actual (with invoice). ICU rates per day, surgical packages include anaesthesia + O.T. + 5 days stay.
          </p>
        </TabsContent>

        {/* Claim Amount Check */}
        <TabsContent value="check" className="mt-3">
          <Card className="max-w-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">CGHS Claim Amount Checker</CardTitle>
              <p className="text-xs text-muted-foreground">Verify if claimed amount is within CGHS package rate before submission</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">Ward Entitlement Group</Label>
                <select
                  value={entitlementGroup}
                  onChange={e => setEntitlementGroup(e.target.value as "private" | "semi" | "general")}
                  className="mt-1 w-full h-9 text-xs border border-input rounded-md px-3 bg-background"
                >
                  {ENTITLEMENT_GROUPS.map(g => (
                    <option key={g.label} value={g.ward}>{g.label} ({g.ward})</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">Procedure Name</Label>
                <Input
                  value={checkProcedure}
                  onChange={e => setCheckProcedure(e.target.value)}
                  placeholder="e.g., Cholecystectomy"
                  className="mt-1 h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs">Claimed Amount (₹)</Label>
                <Input
                  type="number"
                  value={checkAmount}
                  onChange={e => setCheckAmount(e.target.value)}
                  placeholder="e.g., 35000"
                  className="mt-1 h-8 text-xs"
                />
              </div>
              <Button size="sm" onClick={checkClaim} className="gap-1.5">
                <IndianRupee size={13} /> Check Claim
              </Button>

              {claimCheckResult && (
                <div className={`p-3 rounded-lg border ${claimCheckResult.compliant ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
                  <div className="flex items-center gap-2 mb-1">
                    {claimCheckResult.compliant
                      ? <CheckCircle2 size={14} className="text-emerald-600" />
                      : <AlertTriangle size={14} className="text-red-600" />}
                    <span className={`text-xs font-bold ${claimCheckResult.compliant ? "text-emerald-700" : "text-red-700"}`}>
                      {claimCheckResult.compliant ? "Within CGHS Rate" : "Exceeds CGHS Rate"}
                    </span>
                  </div>
                  <div className="space-y-0.5 text-xs">
                    <div className="flex justify-between"><span>CGHS Allowed Rate:</span><span className="font-mono font-bold">₹{claimCheckResult.allowed.toLocaleString("en-IN")}</span></div>
                    <div className="flex justify-between"><span>Claimed Amount:</span><span className="font-mono">₹{(parseFloat(checkAmount) || 0).toLocaleString("en-IN")}</span></div>
                    {!claimCheckResult.compliant && (
                      <div className="flex justify-between text-red-700 font-medium mt-1 pt-1 border-t border-red-200">
                        <span>Excess (patient payable):</span>
                        <span className="font-mono">₹{claimCheckResult.excess.toLocaleString("en-IN")}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Register CGHS/ECHS Beneficiary */}
        <TabsContent value="beneficiary" className="mt-3">
          <Card className="max-w-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Register CGHS / ECHS Beneficiary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Card Type</Label>
                  <select
                    value={beneForm.card_type}
                    onChange={e => setBeneForm(f => ({ ...f, card_type: e.target.value }))}
                    className="mt-1 w-full h-9 text-xs border border-input rounded-md px-3 bg-background"
                  >
                    <option value="cghs">CGHS</option>
                    <option value="echs">ECHS</option>
                  </select>
                </div>
                <div>
                  <Label className="text-xs">{beneForm.card_type === "cghs" ? "CGHS Beneficiary ID" : "ECHS Smart Card No."}</Label>
                  <Input
                    value={beneForm.card_type === "cghs" ? beneForm.cghs_id : beneForm.echs_card_no}
                    onChange={e => setBeneForm(f => beneForm.card_type === "cghs" ? { ...f, cghs_id: e.target.value } : { ...f, echs_card_no: e.target.value })}
                    placeholder={beneForm.card_type === "cghs" ? "e.g., CGHS/DEL/12345" : "e.g., ECHS/SC/78901"}
                    className="mt-1 h-8 text-xs"
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Beneficiary Name *</Label>
                  <Input
                    value={beneForm.beneficiary_name}
                    onChange={e => setBeneForm(f => ({ ...f, beneficiary_name: e.target.value }))}
                    className="mt-1 h-8 text-xs"
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Entitlement Group</Label>
                  <select
                    value={beneForm.group}
                    onChange={e => setBeneForm(f => ({ ...f, group: e.target.value }))}
                    className="mt-1 w-full h-9 text-xs border border-input rounded-md px-3 bg-background"
                  >
                    <option value="">-- Select --</option>
                    {ENTITLEMENT_GROUPS.map(g => <option key={g.label} value={g.label}>{g.label}</option>)}
                  </select>
                </div>
                {beneForm.card_type === "echs" && (
                  <>
                    <div>
                      <Label className="text-xs">Referral Hospital</Label>
                      <Input value={beneForm.referral_hospital} onChange={e => setBeneForm(f => ({ ...f, referral_hospital: e.target.value }))} placeholder="Station Health Org / Polyclinic" className="mt-1 h-8 text-xs" />
                    </div>
                    <div>
                      <Label className="text-xs">Referral Date</Label>
                      <Input type="date" value={beneForm.referral_date} onChange={e => setBeneForm(f => ({ ...f, referral_date: e.target.value }))} className="mt-1 h-8 text-xs" />
                    </div>
                  </>
                )}
              </div>
              <Button size="sm" onClick={saveBeneficiary} disabled={savingBene || !beneForm.beneficiary_name}>
                {savingBene ? "Saving..." : "Register Beneficiary"}
              </Button>
              <p className="text-[10px] text-muted-foreground">
                ECHS beneficiaries require valid referral letter from their Station Health Organisation (SHO) or Polyclinic before admission for planned procedures.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Claim Rules */}
        <TabsContent value="rules" className="mt-3">
          <div className="grid grid-cols-2 gap-4 max-w-3xl">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs font-bold">CGHS Claim Rules</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {[
                  "Pre-authorization mandatory for planned surgeries, implants, and interventional procedures",
                  "Emergency hospitalisation: inform CGHS within 24 hours; post-facto approval required within 7 days",
                  "Package rates are inclusive: OT charges, anaesthesia, nursing, bed for defined stay duration",
                  "Implants billed at actual cost with original invoice; pre-approval mandatory above ₹3,000",
                  "NABH-accredited hospitals get 10% rate premium over standard rates",
                  "Medicines during hospitalisation included in package; discharge medicines reimbursed at CGHS ceiling",
                  "Specialised investigations (CT/MRI/PET) reimbursed at CGHS 2023 diagnostic rates, not package",
                  "Claims must be submitted within 90 days of discharge; late claims require CMO approval",
                ].map((rule, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className="text-primary mt-0.5 font-bold shrink-0">{i + 1}.</span>
                    <span className="text-muted-foreground">{rule}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs font-bold">ECHS Claim Rules</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {[
                  "Referral letter from SHO/Polyclinic mandatory for all planned admissions; valid for 30 days",
                  "Emergency admission: inform ECHS Regional Centre within 48 hours via signal/phone",
                  "ECHS rates are at par with CGHS 2023 rates for empanelled hospitals",
                  "Cashless treatment: submit pre-auth request 48 hours before planned procedure",
                  "Smart Card must be presented at admission; photocopy not accepted",
                  "Serving personnel: CO's permission required for elective admissions above 7 days",
                  "Overseas treatment not covered under ECHS; only within India at empanelled facilities",
                  "Claims submitted to respective ECHS Polyclinic within 60 days of discharge",
                ].map((rule, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className="text-blue-600 mt-0.5 font-bold shrink-0">{i + 1}.</span>
                    <span className="text-muted-foreground">{rule}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default CGHSECHSTab;
