import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { autoPostJournalEntry } from "@/lib/accounting";
import { Loader2 } from "lucide-react";

const CATEGORIES = [
  "rent", "electricity", "water", "telephone", "internet", "fuel", "vehicle",
  "maintenance", "repair", "housekeeping", "laundry", "catering", "insurance",
  "professional_fees", "marketing", "printing", "stationery", "bank_charges",
  "depreciation", "miscellaneous", "other",
];

const PAYMENT_MODES = ["cash", "bank_transfer", "cheque", "upi", "card"];

interface Props {
  hospitalId: string;
  userId: string;
  onClose: () => void;
}

const RecordExpenseModal: React.FC<Props> = ({ hospitalId, userId, onClose }) => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [departments, setDepartments] = useState<any[]>([]);
  const [form, setForm] = useState({
    expense_date: new Date().toISOString().split("T")[0],
    expense_category: "miscellaneous",
    vendor_name: "",
    description: "",
    amount: "",
    gst_amount: "0",
    payment_mode: "cash",
    reference_number: "",
    department_id: "",
  });

  useEffect(() => {
    supabase.from("departments").select("id, name").eq("hospital_id", hospitalId).order("name", { ascending: true }).then(({ data }) => setDepartments(data || []));
  }, [hospitalId]);

  const totalAmount = (Number(form.amount) || 0) + (Number(form.gst_amount) || 0);

  const handleSave = async () => {
    if (!form.description || !form.amount) { toast({ title: "Fill description and amount", variant: "destructive" }); return; }
    setSaving(true);

    const { data: expense, error } = await supabase.from("expense_records").insert({
      hospital_id: hospitalId,
      expense_date: form.expense_date,
      expense_category: form.expense_category as any,
      vendor_name: form.vendor_name || null,
      description: form.description,
      amount: Number(form.amount),
      gst_amount: Number(form.gst_amount) || 0,
      total_amount: totalAmount,
      payment_mode: form.payment_mode as any,
      reference_number: form.reference_number || null,
      department_id: form.department_id || null,
      created_by: userId,
    }).select().maybeSingle();

    if (error) { toast({ title: "Failed to save", variant: "destructive" }); setSaving(false); return; }

    // Auto-post journal entry for expense
    await autoPostJournalEntry({
      triggerEvent: "expense_recorded",
      sourceModule: "accounts",
      sourceId: expense.id,
      amount: totalAmount,
      description: `Expense: ${form.description}`,
      hospitalId,
      postedBy: userId,
    });

    toast({ title: "Expense recorded ✓" });
    setSaving(false);
    onClose();
  };

  const update = (k: string, v: string) => setForm({ ...form, [k]: v });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Record Expense</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" value={form.expense_date} onChange={(e) => update("expense_date", e.target.value)} className="h-9 text-xs" />
            </div>
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={form.expense_category} onValueChange={(v) => update("expense_category", v)}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c} className="text-xs">{c.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Description *</Label>
            <Textarea value={form.description} onChange={(e) => update("description", e.target.value)} className="text-xs" rows={2} />
          </div>
          <div>
            <Label className="text-xs">Vendor Name</Label>
            <Input value={form.vendor_name} onChange={(e) => update("vendor_name", e.target.value)} className="h-9 text-xs" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Amount *</Label>
              <Input type="number" value={form.amount} onChange={(e) => update("amount", e.target.value)} className="h-9 text-xs" placeholder="₹" />
            </div>
            <div>
              <Label className="text-xs">GST</Label>
              <Input type="number" value={form.gst_amount} onChange={(e) => update("gst_amount", e.target.value)} className="h-9 text-xs" />
            </div>
            <div>
              <Label className="text-xs">Total</Label>
              <Input value={`₹${totalAmount.toLocaleString("en-IN")}`} readOnly className="h-9 text-xs bg-muted" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Payment Mode</Label>
              <Select value={form.payment_mode} onValueChange={(v) => update("payment_mode", v)}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_MODES.map((m) => <SelectItem key={m} value={m} className="text-xs">{m.replace("_", " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Reference #</Label>
              <Input value={form.reference_number} onChange={(e) => update("reference_number", e.target.value)} className="h-9 text-xs" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Department (optional)</Label>
            <Select value={form.department_id} onValueChange={(v) => update("department_id", v)}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                {departments.map((d) => <SelectItem key={d.id} value={d.id} className="text-xs">{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Save Expense
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default RecordExpenseModal;
