import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Megaphone, Eye, Send } from "lucide-react";

interface Props {
  hospitalId: string;
  onClose: () => void;
  onComplete: () => void;
}

const DEFAULT_TEMPLATE = `Dear {patient_name}, your outstanding bill of ₹{amount} at {hospital_name} (Bill: {bill_number}) is pending for {days} days. Please visit us or pay online: {pay_link}. For queries, please contact the hospital.`;

const CollectionCampaignModal: React.FC<Props> = ({ hospitalId, onClose, onComplete }) => {
  const { toast } = useToast();
  const [name, setName] = useState(`Collection Campaign ${new Date().toLocaleDateString("en-IN")}`);
  const [minAmount, setMinAmount] = useState(500);
  const [minDays, setMinDays] = useState(30);
  const [billTypes, setBillTypes] = useState<string[]>(["all"]);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [matchCount, setMatchCount] = useState(0);
  const [matchTotal, setMatchTotal] = useState(0);
  const [previews, setPreviews] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [sent, setSent] = useState(0);

  const cutoffDate = new Date(Date.now() - minDays * 86400000).toISOString().split("T")[0];

  useEffect(() => {
    countMatches();
  }, [minAmount, minDays, billTypes]);

  const countMatches = async () => {
    let query = supabase
      .from("bills")
      .select("id, balance_due", { count: "exact" })
      .eq("hospital_id", hospitalId)
      .in("payment_status", ["unpaid", "partial", "partially_paid"])
      .gte("balance_due", minAmount)
      .lte("bill_date", cutoffDate);

    if (!billTypes.includes("all")) {
      query = query.in("bill_type", billTypes);
    }

    const { count, data } = await query;
    setMatchCount(count || 0);
    setMatchTotal((data || []).reduce((s, b) => s + Number(b.balance_due), 0));
  };

  const previewMessages = async () => {
    let query = supabase
      .from("bills")
      .select("bill_number, balance_due, bill_date, patients(full_name, phone)")
      .eq("hospital_id", hospitalId)
      .in("payment_status", ["unpaid", "partial", "partially_paid"])
      .gte("balance_due", minAmount)
      .lte("bill_date", cutoffDate)
      .limit(3);

    const { data } = await query;
    const msgs = (data || []).map((b: any) => {
      const days = Math.floor((Date.now() - new Date(b.bill_date).getTime()) / 86400000);
      return template
        .replace("{patient_name}", b.patients?.full_name || "Patient")
        .replace("{amount}", Number(b.balance_due).toLocaleString("en-IN"))
        .replace("{hospital_name}", "Hospital")
        .replace("{bill_number}", b.bill_number)
        .replace("{days}", String(days))
        .replace("{pay_link}", `${window.location.origin}/pay/sample-link`);
    });
    setPreviews(msgs);
  };

  const runCampaign = async () => {
    setRunning(true);
    const { data: userData } = await supabase.from("users").select("id").limit(1).maybeSingle();

    // Create campaign record
    const { data: campaign } = await supabase.from("collection_campaigns" as any).insert({
      hospital_id: hospitalId,
      campaign_name: name,
      filter_criteria: { min_amount: minAmount, min_days_overdue: minDays, bill_types: billTypes },
      message_template: template,
      status: "running",
      created_by: userData?.id,
    }).select("id").maybeSingle();

    // Get matching bills
    let query = supabase
      .from("bills")
      .select("id, bill_number, balance_due, bill_date, patient_id, patients(full_name, phone)")
      .eq("hospital_id", hospitalId)
      .in("payment_status", ["unpaid", "partial", "partially_paid"])
      .gte("balance_due", minAmount)
      .lte("bill_date", cutoffDate)
      .limit(200);

    if (!billTypes.includes("all")) {
      query = query.in("bill_type", billTypes);
    }

    const { data: bills } = await query;
    let sentCount = 0;

    for (const bill of (bills || []) as any[]) {
      const patient = bill.patients;
      if (!patient?.phone) continue;

      const days = Math.floor((Date.now() - new Date(bill.bill_date).getTime()) / 86400000);

      // Generate pay link for this bill
      const token = crypto.randomUUID();
      await supabase.from("payment_links" as any).insert({
        hospital_id: hospitalId,
        bill_id: bill.id,
        patient_id: bill.patient_id,
        link_token: token,
        amount: bill.balance_due,
        created_by: userData?.id,
        sent_via: ["whatsapp"],
      });

      const payUrl = `${window.location.origin}/pay/${token}`;
      const msg = template
        .replace("{patient_name}", patient.full_name || "Patient")
        .replace("{amount}", Number(bill.balance_due).toLocaleString("en-IN"))
        .replace("{hospital_name}", "Hospital")
        .replace("{bill_number}", bill.bill_number)
        .replace("{days}", String(days))
        .replace("{pay_link}", payUrl);

      const cleanPhone = patient.phone.replace(/\D/g, "");
      const fullPhone = cleanPhone.startsWith("91") ? cleanPhone : `91${cleanPhone}`;
      window.open(`https://wa.me/${fullPhone}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");

      sentCount++;
      setSent(sentCount);

      // Brief delay
      await new Promise(r => setTimeout(r, 1500));
    }

    // Update campaign
    if (campaign) {
      await supabase.from("collection_campaigns" as any).update({
        status: "completed",
        sent_count: sentCount,
        total_bills: bills?.length || 0,
      }).eq("id", (campaign as any).id);
    }

    toast({ title: `Campaign sent to ${sentCount} patients ✓` });
    setRunning(false);
    onComplete();
  };

  const toggleBillType = (type: string) => {
    if (type === "all") {
      setBillTypes(["all"]);
    } else {
      const without = billTypes.filter(t => t !== "all" && t !== type);
      if (billTypes.includes(type)) {
        setBillTypes(without.length ? without : ["all"]);
      } else {
        setBillTypes([...without, type]);
      }
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Megaphone size={18} /> Collection Campaign</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs">Campaign Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 mt-1" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Min Outstanding (₹)</Label>
              <Input type="number" value={minAmount} onChange={(e) => setMinAmount(Number(e.target.value))} className="h-9 mt-1 font-mono" />
            </div>
            <div>
              <Label className="text-xs">Min Days Overdue</Label>
              <Input type="number" value={minDays} onChange={(e) => setMinDays(Number(e.target.value))} className="h-9 mt-1 font-mono" />
            </div>
          </div>

          <div>
            <Label className="text-xs mb-2 block">Bill Types</Label>
            <div className="flex gap-3 flex-wrap">
              {["all", "opd", "ipd", "pharmacy"].map(t => (
                <label key={t} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <Checkbox checked={billTypes.includes(t)} onCheckedChange={() => toggleBillType(t)} />
                  <span className="capitalize">{t === "all" ? "All Types" : t.toUpperCase()}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="bg-muted/50 rounded-lg p-3 flex items-center justify-between">
            <span className="text-sm">
              <strong>{matchCount}</strong> patients • <strong>₹{matchTotal.toLocaleString("en-IN")}</strong> outstanding
            </span>
            <Badge variant="outline" className="text-[10px]">Preview</Badge>
          </div>

          <div>
            <Label className="text-xs">Message Template</Label>
            <Textarea value={template} onChange={(e) => setTemplate(e.target.value)} className="mt-1 text-xs min-h-[80px]" />
            <p className="text-[10px] text-muted-foreground mt-1">
              Variables: {"{patient_name}"} {"{amount}"} {"{bill_number}"} {"{days}"} {"{pay_link}"} {"{hospital_name}"}
            </p>
          </div>

          {previews.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold">Sample Messages:</p>
              {previews.map((msg, i) => (
                <div key={i} className="bg-muted/30 rounded-lg p-2.5 text-[11px] whitespace-pre-wrap border border-border">
                  {msg}
                </div>
              ))}
            </div>
          )}

          {running && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
              <p className="text-sm font-bold text-blue-700">Sending... {sent} messages sent</p>
              <p className="text-[11px] text-blue-600 mt-1">WhatsApp windows will open for each patient</p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={previewMessages} disabled={running} className="gap-1">
            <Eye size={14} /> Preview 3 Messages
          </Button>
          <Button onClick={runCampaign} disabled={running || matchCount === 0} className="gap-1">
            <Send size={14} /> {running ? `Sending (${sent})...` : `Send to ${matchCount} Patients`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CollectionCampaignModal;
