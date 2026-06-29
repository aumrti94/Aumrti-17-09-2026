import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, X, Trash2, Mail } from "lucide-react";

interface ManualDoc {
  name: string;
  speciality: string;
  regNo: string;
  mobile: string;
  fee: string;
  followUpFee: string;
}

interface Props {
  hospitalId: string;
  onComplete: (doctors: Array<{ id: string; name: string }>) => void;
}

const Step4Doctors: React.FC<Props> = ({ hospitalId, onComplete }) => {
  const { toast } = useToast();
  const [emails, setEmails] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState("");
  const [inviting, setInviting] = useState(false);
  const [invited, setInvited] = useState(false);

  const [doctors, setDoctors] = useState<ManualDoc[]>([
    { name: "", speciality: "", regNo: "", mobile: "", fee: "", followUpFee: "" },
  ]);
  const [saving, setSaving] = useState(false);

  const addEmail = (val: string) => {
    const e = val.trim().replace(/,$/g, "");
    if (e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !emails.includes(e)) {
      setEmails((prev) => [...prev, e]);
    }
    setEmailInput("");
  };

  const handleEmailKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addEmail(emailInput);
    }
  };

  const handleInvite = async () => {
    if (emails.length === 0) return;
    setInviting(true);
    try {
      const res = await supabase.functions.invoke("invite-doctors", {
        body: { emails, hospital_id: hospitalId },
      });
      if (res.error) throw new Error(res.error.message);
      setInvited(true);
      toast({ title: "Invitations sent!", description: `${emails.length} doctor(s) invited.` });
    } catch (err: any) {
      toast({ title: "Failed to send invites", description: err.message, variant: "destructive" });
    } finally {
      setInviting(false);
    }
  };

  const updateDoc = (i: number, field: keyof ManualDoc, value: string) => {
    setDoctors((prev) => prev.map((d, idx) => idx === i ? { ...d, [field]: value } : d));
  };

  const handleSaveManual = async () => {
    const valid = doctors.filter((d) => d.name.trim());
    if (valid.length === 0) { onComplete([]); return; }
    setSaving(true);
    const rows = valid.map((d) => ({
      id: crypto.randomUUID(),
      hospital_id: hospitalId,
      full_name: d.name,
      email: `${d.name.toLowerCase().replace(/\s/g, ".")}@hospital.local`,
      role: "doctor" as const,
      registration_number: d.regNo || null,
      phone: d.mobile || null,
      is_active: true,
    }));
    const { error } = await supabase.from("users").insert(rows as any);
    if (error) {
      toast({ title: "Error adding doctors", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }
    // Create service_master rows for doctors with fees
    const svcRows = valid
      .map((v, i) => ({ ...v, doctorId: rows[i].id }))
      .filter((v) => v.fee && parseFloat(v.fee) > 0)
      .map((v) => ({
        hospital_id: hospitalId,
        name: `Consultation - ${v.name}`,
        category: "consultation",
        item_type: "consultation",
        doctor_id: v.doctorId,
        fee: parseFloat(v.fee) || 500,
        follow_up_fee: v.followUpFee ? parseFloat(v.followUpFee) : 200,
        validity_days: 7,
        is_active: true,
      }));
    if (svcRows.length > 0) {
      await (supabase as any).from("service_master").insert(svcRows);
    }
    setSaving(false);
    onComplete(rows.map((r) => ({ id: r.id, name: r.full_name })));
  };

  return (
    <div>
      <span className="inline-block bg-[#EEF2FF] text-[#4F46E5] text-[11px] px-2.5 py-0.5 rounded-full font-medium mb-4">~5 min</span>
      <h2 className="text-[22px] font-bold text-foreground">Add your doctors</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-6">Invite them by email or add manually. They'll set their own passwords.</p>

      <Tabs defaultValue="invite">
        <TabsList className="grid w-full grid-cols-2 mb-4">
          <TabsTrigger value="invite" className="gap-1.5"><Mail size={14} /> Invite by Email</TabsTrigger>
          <TabsTrigger value="manual" className="gap-1.5"><Plus size={14} /> Add Manually</TabsTrigger>
        </TabsList>

        <TabsContent value="invite" className="space-y-4">
          <p className="text-[13px] text-muted-foreground">Doctors will receive an email invitation to create their account.</p>

          <div className="border border-border rounded-lg p-3 min-h-[80px] flex flex-wrap gap-1.5 items-start cursor-text" onClick={() => document.getElementById("email-input")?.focus()}>
            {emails.map((e) => (
              <span key={e} className="inline-flex items-center gap-1 bg-[hsl(220,54%,95%)] text-primary text-[13px] px-2.5 py-0.5 rounded-full">
                {e}
                <button onClick={() => setEmails((prev) => prev.filter((x) => x !== e))}><X size={12} /></button>
              </span>
            ))}
            <input
              id="email-input"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={handleEmailKeyDown}
              onBlur={() => emailInput && addEmail(emailInput)}
              placeholder={emails.length === 0 ? "Enter email and press Enter or comma" : ""}
              className="flex-1 min-w-[200px] outline-none text-sm bg-transparent"
            />
          </div>

          {invited ? (
            <p className="text-sm text-[hsl(160,84%,39%)] font-medium">✓ Invitations sent! Doctors will receive an email to set up their account.</p>
          ) : (
            <button onClick={handleInvite} disabled={emails.length === 0 || inviting} className="border border-primary text-primary px-5 py-2 rounded-md text-sm font-medium hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-40">
              {inviting ? "Sending..." : "Send Invitations"}
            </button>
          )}
        </TabsContent>

        <TabsContent value="manual" className="space-y-3">
          <div className="grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_1fr_32px] gap-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide px-1">
            <span>Full Name</span><span>Speciality</span><span>Reg. No</span><span>Mobile</span><span>Fee (₹)</span><span>Follow-up</span><span />
          </div>
          {doctors.map((d, i) => (
            <div key={i} className="grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_1fr_32px] gap-2 items-center">
              <Input value={d.name} onChange={(e) => updateDoc(i, "name", e.target.value)} placeholder="Dr. Example" />
              <Input value={d.speciality} onChange={(e) => updateDoc(i, "speciality", e.target.value)} placeholder="General Medicine" />
              <Input value={d.regNo} onChange={(e) => updateDoc(i, "regNo", e.target.value)} placeholder="MH-12345" />
              <Input value={d.mobile} onChange={(e) => updateDoc(i, "mobile", e.target.value)} placeholder="9876543210" />
              <Input type="number" value={d.fee} onChange={(e) => updateDoc(i, "fee", e.target.value)} placeholder="500" />
              <Input type="number" value={d.followUpFee} onChange={(e) => updateDoc(i, "followUpFee", e.target.value)} placeholder="200" />
              <button onClick={() => setDoctors((prev) => prev.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {doctors.length < 5 && (
            <button onClick={() => setDoctors((prev) => [...prev, { name: "", speciality: "", regNo: "", mobile: "", fee: "", followUpFee: "" }])} className="flex items-center gap-1.5 text-sm text-primary font-medium hover:underline">
              <Plus size={14} /> Add Row
            </button>
          )}
        </TabsContent>
      </Tabs>

      <div className="flex justify-between mt-8">
        <button onClick={() => onComplete([])} className="text-sm text-muted-foreground hover:text-foreground">I'll add doctors later →</button>
        <button onClick={handleSaveManual} disabled={saving} className="bg-primary text-primary-foreground px-7 py-2.5 rounded-lg text-sm font-semibold hover:bg-[hsl(220,54%,16%)] transition-colors disabled:opacity-40 active:scale-[0.97]">
          {saving ? "Saving..." : "Save & Continue →"}
        </button>
      </div>
    </div>
  );
};

export default Step4Doctors;
