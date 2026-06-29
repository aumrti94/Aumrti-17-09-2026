import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

const tpas = [
  "Star Health", "New India", "United India", "Oriental", "National Insurance",
  "ICICI Lombard", "HDFC ERGO", "Bajaj Allianz", "Medi Assist", "Paramount",
  "MD India", "Vidal Health", "Other",
];

const govSchemes = ["PMJAY (Ayushman Bharat)", "CGHS", "ECHS", "State Government Scheme", "Other"];

interface Props {
  hospitalId: string;
  onComplete: () => void;
}

const Step6Payments: React.FC<Props> = ({ hospitalId, onComplete }) => {
  const { toast } = useToast();
  const [cardEnabled, setCardEnabled] = useState(false);
  const [insuranceEnabled, setInsuranceEnabled] = useState(false);
  const [govEnabled, setGovEnabled] = useState(false);
  const [razorpayKey, setRazorpayKey] = useState("");
  const [selectedTpas, setSelectedTpas] = useState<Set<string>>(new Set());
  const [selectedSchemes, setSelectedSchemes] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const toggleSet = (set: Set<string>, item: string, setter: React.Dispatch<React.SetStateAction<Set<string>>>) => {
    setter((prev) => {
      const next = new Set(prev);
      next.has(item) ? next.delete(item) : next.add(item);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    const methods = ["cash"];
    if (cardEnabled) methods.push("card_upi");
    if (insuranceEnabled) methods.push("insurance");
    if (govEnabled) methods.push("government");

    await supabase.from("hospitals").update({
      payment_methods: methods,
      razorpay_key_id: razorpayKey || null,
    } as any).eq("id", hospitalId);

    setSaving(false);
    onComplete();
  };

  return (
    <div>
      <span className="inline-block bg-[#EEF2FF] text-[#4F46E5] text-[11px] px-2.5 py-0.5 rounded-full font-medium mb-4">~2 min</span>
      <h2 className="text-[22px] font-bold text-foreground">How will patients pay?</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-6">Enable the payment methods your hospital accepts.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Cash */}
        <div className="border border-border rounded-xl p-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">💵</span>
              <div><p className="text-sm font-semibold">Cash</p><p className="text-[11px] text-muted-foreground">Accept cash at the counter</p></div>
            </div>
            <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full">Always enabled</span>
          </div>
        </div>

        {/* Card/UPI */}
        <div className={`border rounded-xl p-4 transition-colors ${cardEnabled ? "border-primary bg-[hsl(220,54%,97%)]" : "border-border"}`}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">💳</span>
              <div><p className="text-sm font-semibold">Card, UPI & Net Banking</p><p className="text-[11px] text-muted-foreground">Powered by Razorpay</p></div>
            </div>
            <Switch checked={cardEnabled} onCheckedChange={setCardEnabled} />
          </div>
          {cardEnabled && (
            <div className="mt-3 space-y-2">
              <Input value={razorpayKey} onChange={(e) => setRazorpayKey(e.target.value)} placeholder="Razorpay Key ID (rzp_live_...)" />
              <a href="https://dashboard.razorpay.com" target="_blank" rel="noopener" className="text-[11px] text-secondary hover:underline">
                How to get Razorpay credentials ↗
              </a>
            </div>
          )}
        </div>

        {/* Insurance */}
        <div className={`border rounded-xl p-4 transition-colors ${insuranceEnabled ? "border-primary bg-[hsl(220,54%,97%)]" : "border-border"}`}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">🏥</span>
              <div><p className="text-sm font-semibold">Insurance & TPA</p><p className="text-[11px] text-muted-foreground">Accept cashless claims</p></div>
            </div>
            <Switch checked={insuranceEnabled} onCheckedChange={setInsuranceEnabled} />
          </div>
          {insuranceEnabled && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {tpas.map((t) => (
                <button key={t} onClick={() => toggleSet(selectedTpas, t, setSelectedTpas)}
                  className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${selectedTpas.has(t) ? "border-primary bg-[hsl(220,54%,95%)] text-primary" : "border-border text-muted-foreground"}`}>
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Government */}
        <div className={`border rounded-xl p-4 transition-colors ${govEnabled ? "border-primary bg-[hsl(220,54%,97%)]" : "border-border"}`}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">🏛️</span>
              <div><p className="text-sm font-semibold">PMJAY / CGHS / ECHS</p><p className="text-[11px] text-muted-foreground">Government health schemes</p></div>
            </div>
            <Switch checked={govEnabled} onCheckedChange={setGovEnabled} />
          </div>
          {govEnabled && (
            <div className="mt-3 space-y-1.5">
              {govSchemes.map((s) => (
                <label key={s} className="flex items-center gap-2 text-[12px] text-foreground cursor-pointer">
                  <Checkbox checked={selectedSchemes.has(s)} onCheckedChange={() => toggleSet(selectedSchemes, s, setSelectedSchemes)} />
                  {s}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-between mt-8">
        <div />
        <button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground px-7 py-2.5 rounded-lg text-sm font-semibold hover:bg-[hsl(220,54%,16%)] transition-colors disabled:opacity-40 active:scale-[0.97]">
          {saving ? "Saving..." : "Save & Continue →"}
        </button>
      </div>
    </div>
  );
};

export default Step6Payments;
