import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { CheckCircle2, Loader2, Search, XCircle } from "lucide-react";

const pmjayPackages = [
  { code: "SR.SG.07", name: "Appendicectomy", rate: 8000 },
  { code: "SR.OB.07", name: "LSCS (Caesarean Section)", rate: 9000 },
  { code: "SR.OB.04", name: "Normal Delivery", rate: 2000 },
  { code: "SR.OR.01", name: "TKR - Total Knee Replacement", rate: 80000 },
  { code: "SR.CA.01", name: "CABG (Bypass Surgery)", rate: 150000 },
  { code: "MD.GE.01", name: "GI Medical Management", rate: 3500 },
  { code: "MD.RE.01", name: "Respiratory Medical Management", rate: 3500 },
  { code: "MD.CA.01", name: "Cardiac Medical Management", rate: 4500 },
  { code: "SR.GE.06", name: "Hernia Repair", rate: 7000 },
  { code: "MD.NE.01", name: "Neurological Medical Management", rate: 5000 },
];

interface PmajaySectionProps {
  onPackageSelect: (rate: number) => void;
}

const PmjaySection: React.FC<PmajaySectionProps> = ({ onPackageSelect }) => {
  const { hospitalId } = useHospitalId();
  const [beneficiaryId, setBeneficiaryId] = useState("");
  const [checking, setChecking] = useState(false);
  const [eligibility, setEligibility] = useState<"verified" | "failed" | null>(null);
  const [beneficiaryData, setBeneficiaryData] = useState<any>(null);
  const [verifyMode, setVerifyMode] = useState<"live" | "sandbox" | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const [icdSearch, setIcdSearch] = useState("");
  const [checklist, setChecklist] = useState<boolean[]>([false, false, false, false, false]);

  const checkEligibility = async () => {
    if (!beneficiaryId || beneficiaryId.length < 8) return;
    setChecking(true);
    setBeneficiaryData(null);
    try {
      const { data, error } = await supabase.functions.invoke("pmjay-eligibility", {
        body: { pmjay_card_number: beneficiaryId, hospital_id: hospitalId },
      });
      if (error) throw error;
      if (data?.eligible) {
        setEligibility("verified");
        setBeneficiaryData(data.beneficiary);
        setVerifyMode(data.mode || null);
      } else {
        setEligibility("failed");
      }
    } catch {
      setEligibility("failed");
    }
    setChecking(false);
  };

  const handlePackageSelect = (pkg: typeof pmjayPackages[0]) => {
    setSelectedPackage(pkg.code);
    onPackageSelect(pkg.rate);
  };

  const toggleChecklist = (i: number) => {
    setChecklist(prev => prev.map((v, idx) => idx === i ? !v : v));
  };

  const filteredPackages = icdSearch
    ? pmjayPackages.filter(p =>
        p.name.toLowerCase().includes(icdSearch.toLowerCase()) ||
        p.code.toLowerCase().includes(icdSearch.toLowerCase())
      )
    : pmjayPackages;

  const checklistItems = [
    "PMJAY card / Aadhaar copy",
    "Admission slip",
    "Lab reports (relevant)",
    "Treating doctor's prescription",
    "Surgical estimate (if surgery)",
  ];

  return (
    <div className="space-y-4 border-t border-border pt-4 mt-4">
      <div className="flex items-center gap-2">
        <Badge className="bg-orange-50 text-orange-700 border-orange-200 text-[10px]">PMJAY</Badge>
        <span className="text-sm font-bold text-foreground">Ayushman Bharat Workflow</span>
      </div>

      {/* Eligibility Check */}
      <div className="bg-muted/50 rounded-lg border border-border p-4 space-y-3">
        <Label className="text-[11px] uppercase text-muted-foreground font-semibold">Beneficiary Eligibility Check</Label>
        <div className="flex gap-2">
          <Input
            placeholder="PMJAY Beneficiary ID (14 digits) or Aadhaar"
            value={beneficiaryId}
            onChange={e => setBeneficiaryId(e.target.value)}
            className="flex-1"
          />
          <Button onClick={checkEligibility} disabled={checking || beneficiaryId.length < 8} size="sm" className="gap-1.5">
            {checking ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            Check
          </Button>
        </div>

        {eligibility === "verified" && (
          <div className="bg-emerald-50 border-l-[3px] border-emerald-500 rounded-r-lg p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-emerald-700 text-sm font-bold">
              <CheckCircle2 size={16} /> PMJAY Beneficiary Verified
              {verifyMode === "sandbox" && <span className="text-[10px] font-normal text-amber-600 ml-2">(Sandbox — configure NHA key for live)</span>}
            </div>
            <div className="text-xs text-emerald-600 space-y-0.5">
              <p>Beneficiary Name: <strong>{beneficiaryData?.name || "—"}</strong></p>
              <p>Family ID: {beneficiaryData?.family_id || "—"}</p>
              <p>Scheme: {beneficiaryData?.scheme || "Ayushman Bharat PMJAY"}</p>
              <p>State: {beneficiaryData?.state || "—"}</p>
              {beneficiaryData?.balance_amount != null && (
                <p>Balance: <strong>₹{Number(beneficiaryData.balance_amount).toLocaleString("en-IN")}</strong></p>
              )}
            </div>
          </div>
        )}

        {eligibility === "failed" && (
          <div className="bg-destructive/10 border-l-[3px] border-destructive rounded-r-lg p-3 flex items-center gap-2 text-destructive text-sm">
            <XCircle size={16} /> Beneficiary not found. Please check ID and retry.
          </div>
        )}
      </div>

      {/* Package Selection */}
      {eligibility === "verified" && (
        <div className="space-y-3">
          <Label className="text-[11px] uppercase text-muted-foreground font-semibold">PMJAY Package Selection</Label>
          <Input
            placeholder="Search by package name or code..."
            value={icdSearch}
            onChange={e => setIcdSearch(e.target.value)}
            className="text-sm"
          />
          <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto">
            {filteredPackages.map(pkg => (
              <button
                key={pkg.code}
                onClick={() => handlePackageSelect(pkg)}
                className={cn(
                  "text-left p-3 rounded-lg border transition-colors",
                  selectedPackage === pkg.code
                    ? "bg-primary/5 border-primary"
                    : "border-border hover:bg-muted/50"
                )}
              >
                <div className="text-[10px] font-mono text-muted-foreground">{pkg.code}</div>
                <div className="text-xs font-medium text-foreground mt-0.5">{pkg.name}</div>
                <div className="text-sm font-bold text-foreground mt-1">₹{pkg.rate.toLocaleString("en-IN")}</div>
              </button>
            ))}
          </div>

          {/* Checklist */}
          <div className="space-y-2 mt-3">
            <Label className="text-[11px] uppercase text-muted-foreground font-semibold block">PMJAY Document Checklist</Label>
            {checklistItems.map((item, i) => (
              <label key={i} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={checklist[i]}
                  onChange={() => toggleChecklist(i)}
                  className="rounded border-input"
                />
                {item}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PmjaySection;
