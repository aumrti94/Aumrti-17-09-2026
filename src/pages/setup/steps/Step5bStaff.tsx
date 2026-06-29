import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Users } from "lucide-react";

interface StaffRow {
  name: string;
  role: string;
  email: string;
  mobile: string;
}

const ROLES = [
  { value: "nurse",        label: "Nurse" },
  { value: "receptionist", label: "Receptionist" },
  { value: "pharmacist",   label: "Pharmacist" },
  { value: "lab_tech",     label: "Lab Technician" },
  { value: "accountant",   label: "Accountant" },
  { value: "hr_manager",   label: "HR Manager" },
];

interface Props {
  hospitalId: string;
  onComplete: () => void;
  onSkip: () => void;
}

const Step5bStaff: React.FC<Props> = ({ hospitalId, onComplete, onSkip }) => {
  const { toast } = useToast();
  const [rows, setRows] = useState<StaffRow[]>([
    { name: "", role: "nurse",        email: "", mobile: "" },
    { name: "", role: "receptionist", email: "", mobile: "" },
  ]);
  const [saving, setSaving] = useState(false);

  const update = (i: number, field: keyof StaffRow, val: string) => {
    setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r));
  };

  const addRow = () => setRows((prev) => [...prev, { name: "", role: "nurse", email: "", mobile: "" }]);
  const removeRow = (i: number) => {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  };

  const handleSave = async () => {
    const valid = rows.filter((r) => r.name.trim() && r.role);
    if (valid.length === 0) {
      toast({ title: "Add at least one staff member", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const inserts = valid.map((r) => ({
        hospital_id: hospitalId,
        full_name: r.name.trim(),
        role: r.role as any,
        email: r.email.trim() || `${r.name.trim().toLowerCase().replace(/\s+/g, ".")}@placeholder.local`,
        phone: r.mobile.trim() || null,
        can_login: false,
        is_active: true,
      }));
      const { error } = await supabase.from("users").insert(inserts);
      if (error) throw error;
      toast({ title: `${valid.length} staff member(s) added!` });
      onComplete();
    } catch (err: any) {
      toast({ title: "Failed to add staff", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
          <Users size={16} className="text-primary" />
        </div>
        <span className="text-xs font-semibold text-primary uppercase tracking-wide">Step 6 · Other Staff</span>
      </div>
      <h2 className="text-[22px] font-bold text-foreground mt-2">Add your care team</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-5">
        Add nurses, reception, pharmacist, and other staff. Email and login can be set up later.
      </p>

      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-[13px] text-blue-700 mb-6">
        You don't need to add everyone now — staff can be added anytime from <strong>Settings → Staff</strong>.
      </div>

      <div className="bg-card rounded-2xl border border-border p-5 shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground text-xs border-b border-border">
                <th className="pb-2 pr-3 font-medium">Full Name</th>
                <th className="pb-2 pr-3 font-medium">Role</th>
                <th className="pb-2 pr-3 font-medium">Email (optional)</th>
                <th className="pb-2 pr-3 font-medium">Mobile (optional)</th>
                <th className="pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-border/50 last:border-0">
                  <td className="py-2.5 pr-3">
                    <Input
                      value={r.name}
                      onChange={(e) => update(i, "name", e.target.value)}
                      placeholder="e.g. Priya Sharma"
                      className="h-8 text-sm"
                    />
                  </td>
                  <td className="py-2.5 pr-3 w-44">
                    <select
                      value={r.role}
                      onChange={(e) => update(i, "role", e.target.value)}
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                      {ROLES.map((role) => (
                        <option key={role.value} value={role.value}>{role.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2.5 pr-3">
                    <Input
                      type="email"
                      value={r.email}
                      onChange={(e) => update(i, "email", e.target.value)}
                      placeholder="email@hospital.com"
                      className="h-8 text-sm"
                    />
                  </td>
                  <td className="py-2.5 pr-3 w-36">
                    <Input
                      value={r.mobile}
                      onChange={(e) => update(i, "mobile", e.target.value)}
                      placeholder="9876543210"
                      className="h-8 text-sm"
                    />
                  </td>
                  <td className="py-2.5 w-8">
                    <button
                      onClick={() => removeRow(i)}
                      disabled={rows.length <= 1}
                      className="text-muted-foreground hover:text-destructive disabled:opacity-30"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button
          onClick={addRow}
          className="mt-3 flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <Plus size={15} /> Add another staff member
        </button>
      </div>

      <div className="flex items-center justify-between mt-8">
        <button onClick={onSkip} className="text-sm text-muted-foreground hover:text-foreground">
          Skip for now →
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-primary text-primary-foreground px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-[hsl(220,54%,16%)] disabled:opacity-60 transition-colors"
        >
          {saving ? "Saving…" : "Save & Continue →"}
        </button>
      </div>
    </div>
  );
};

export default Step5bStaff;
