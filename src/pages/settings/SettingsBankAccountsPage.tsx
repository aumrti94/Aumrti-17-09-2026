import React, { useState, useEffect } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil } from "lucide-react";
import { toast } from "sonner";

interface BankAccount {
  id: string;
  account_name: string;
  bank_name: string;
  account_number: string;
  ifsc_code: string | null;
  opening_balance: number | null;
  is_active: boolean | null;
}

const emptyForm = { account_name: "", bank_name: "", account_number: "", ifsc_code: "", opening_balance: 0 };

const SettingsBankAccountsPage: React.FC = () => {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const hospitalId = localStorage.getItem("hospital_id") || "";

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("bank_accounts").select("*").eq("hospital_id", hospitalId).order("account_name");
    setAccounts((data as BankAccount[]) || []);
    setLoading(false);
  };

  useEffect(() => { if (hospitalId) load(); }, [hospitalId]);

  const openAdd = () => { setEditId(null); setForm(emptyForm); setModalOpen(true); };
  const openEdit = (a: BankAccount) => {
    setEditId(a.id);
    setForm({ account_name: a.account_name, bank_name: a.bank_name, account_number: a.account_number, ifsc_code: a.ifsc_code || "", opening_balance: a.opening_balance || 0 });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.account_name || !form.bank_name || !form.account_number) { toast.error("Name, bank, and account number are required"); return; }
    setSaving(true);
    const payload = { hospital_id: hospitalId, account_name: form.account_name, bank_name: form.bank_name, account_number: form.account_number, ifsc_code: form.ifsc_code || null, opening_balance: form.opening_balance || 0 };

    if (editId) {
      const { error } = await supabase.from("bank_accounts").update(payload).eq("id", editId);
      if (error) toast.error(error.message); else toast.success("Account updated");
    } else {
      const { error } = await supabase.from("bank_accounts").insert(payload);
      if (error) toast.error(error.message); else toast.success("Account added");
    }
    setSaving(false);
    setModalOpen(false);
    load();
  };

  const toggleActive = async (a: BankAccount) => {
    await supabase.from("bank_accounts").update({ is_active: !a.is_active }).eq("id", a.id);
    load();
  };

  const fmt = (v: number | null) => `₹${(v || 0).toLocaleString("en-IN")}`;

  return (
    <SettingsPageWrapper title="Bank Accounts" hideSave>
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-muted-foreground">Configure bank accounts used in reconciliation and payments.</p>
        <Button onClick={openAdd} size="sm"><Plus size={14} className="mr-1" /> Add Account</Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
      ) : accounts.length === 0 ? (
        <div className="text-center py-16 border border-dashed rounded-xl">
          <p className="text-sm text-muted-foreground mb-3">No bank accounts configured yet.</p>
          <Button onClick={openAdd} variant="outline" size="sm"><Plus size={14} className="mr-1" /> Add First Account</Button>
        </div>
      ) : (
        <div className="border rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account Name</TableHead>
                <TableHead>Bank</TableHead>
                <TableHead>Account No.</TableHead>
                <TableHead>IFSC</TableHead>
                <TableHead className="text-right">Opening Bal.</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map(a => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.account_name}</TableCell>
                  <TableCell>{a.bank_name}</TableCell>
                  <TableCell className="font-mono text-xs">****{a.account_number.slice(-4)}</TableCell>
                  <TableCell className="font-mono text-xs">{a.ifsc_code || "—"}</TableCell>
                  <TableCell className="text-right">{fmt(a.opening_balance)}</TableCell>
                  <TableCell>
                    <Badge variant={a.is_active !== false ? "default" : "secondary"}>
                      {a.is_active !== false ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(a)}><Pencil size={13} /></Button>
                      <Switch checked={a.is_active !== false} onCheckedChange={() => toggleActive(a)} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editId ? "Edit" : "Add"} Bank Account</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div><Label>Account Name *</Label><Input value={form.account_name} onChange={e => setForm(p => ({ ...p, account_name: e.target.value }))} placeholder="e.g. Main Operating Account" /></div>
            <div><Label>Bank Name *</Label><Input value={form.bank_name} onChange={e => setForm(p => ({ ...p, bank_name: e.target.value }))} placeholder="e.g. HDFC Bank" /></div>
            <div><Label>Account Number *</Label><Input value={form.account_number} onChange={e => setForm(p => ({ ...p, account_number: e.target.value }))} placeholder="Account number" /></div>
            <div><Label>IFSC Code</Label><Input value={form.ifsc_code} onChange={e => setForm(p => ({ ...p, ifsc_code: e.target.value }))} placeholder="e.g. HDFC0001234" /></div>
            <div><Label>Opening Balance (₹)</Label><Input type="number" value={form.opening_balance} onChange={e => setForm(p => ({ ...p, opening_balance: Number(e.target.value) }))} /></div>
            <Button onClick={handleSave} disabled={saving} className="w-full">{saving ? "Saving…" : editId ? "Update Account" : "Add Account"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </SettingsPageWrapper>
  );
};

export default SettingsBankAccountsPage;
