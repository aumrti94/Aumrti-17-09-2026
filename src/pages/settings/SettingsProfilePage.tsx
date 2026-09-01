import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Shield, ShieldCheck, ShieldOff, Loader2, Smartphone, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ALL_PATIENT_LANGUAGES } from "@/lib/translateUtils";
import MFAEnrollmentModal from "@/components/auth/MFAEnrollmentModal";

const SettingsProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: "", address: "", state: "", pincode: "",
    gstin: "", nabh_number: "", primary_color: "#0EA5E9",
    nabl_accreditation_number: "", nabl_valid_upto: "",
    drug_license_number: "", drug_license_valid_upto: "",
    registration_80g: "", trust_pan: "",
    uhid_prefix: "UHID", uhid_date_format: "YYYYMMDD",
  });
  const [patientLanguages, setPatientLanguages] = useState<string[]>(["English"]);
  const [showMfaEnroll, setShowMfaEnroll] = useState(false);
  const [mfaRemoving, setMfaRemoving]     = useState(false);

  const { data: mfaFactors, refetch: refetchMfa } = useQuery({
    queryKey: ["mfa-factors"],
    queryFn: async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      return data?.totp ?? [];
    },
  });

  const { data: trustedDevices, refetch: refetchDevices } = useQuery({
    queryKey: ["trusted-devices"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("user_trusted_devices")
        .select("id, device_name, created_at, expires_at")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const removeTrustedDevice = async (id: string) => {
    await (supabase as any).from("user_trusted_devices").delete().eq("id", id);
    refetchDevices();
  };

  const removeMfa = async () => {
    const factor = mfaFactors?.[0];
    if (!factor) return;
    setMfaRemoving(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
      if (error) throw error;
      toast({ title: "MFA removed" });
      refetchMfa();
    } catch (e: any) {
      toast({ title: "Could not remove MFA", description: e.message, variant: "destructive" });
    } finally {
      setMfaRemoving(false);
    }
  };

  const enrolledFactor = mfaFactors?.find(f => f.status === "verified");

  const { data: hospital } = useQuery({
    queryKey: ["settings-hospital"],
    queryFn: async () => {
      const { data: me } = await supabase.from("users").select("hospital_id").limit(1).maybeSingle();
      if (!me) return null;
      const { data, error } = await supabase.from("hospitals").select("*").eq("id", me.hospital_id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (hospital) {
      setForm({
        name: hospital.name || "",
        address: hospital.address || "",
        state: hospital.state || "",
        pincode: hospital.pincode || "",
        gstin: hospital.gstin || "",
        nabh_number: hospital.nabh_number || "",
        primary_color: hospital.primary_color || "#0EA5E9",
        nabl_accreditation_number: (hospital as any).nabl_accreditation_number || "",
        nabl_valid_upto: (hospital as any).nabl_valid_upto || "",
        drug_license_number: (hospital as any).drug_license_number || "",
        drug_license_valid_upto: (hospital as any).drug_license_valid_upto || "",
        registration_80g: (hospital as any).registration_80g || "",
        trust_pan: (hospital as any).trust_pan || "",
        uhid_prefix: (hospital as any).uhid_prefix || "UHID",
        uhid_date_format: (hospital as any).uhid_date_format || "YYYYMMDD",
      });
      const langs: string[] = (hospital as any).patient_languages || ["English"];
      setPatientLanguages(langs.includes("English") ? langs : ["English", ...langs]);
    }
  }, [hospital]);

  const save = useMutation({
    mutationFn: async () => {
      if (!hospital) return;
      // The hospital's legal name. Every tenant-scoped query in the product (and every QA
      // fixture) resolves the tenant by this column — an empty name doesn't just look wrong
      // on screen, it makes the hospital unresolvable everywhere else.
      if (!form.name.trim()) {
        throw new Error("Hospital name cannot be empty.");
      }
      // Validate GSTIN format: 15-character alphanumeric (Indian standard)
      if (form.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(form.gstin.trim().toUpperCase())) {
        throw new Error("Invalid GSTIN format. Expected format: 22AAAAA0000A1Z5");
      }
      const { error } = await supabase.from("hospitals").update({
        name: form.name.trim(),
        address: form.address || null,
        state: form.state || null,
        pincode: form.pincode || null,
        gstin: form.gstin ? form.gstin.trim().toUpperCase() : null,
        nabh_number: form.nabh_number || null,
        primary_color: form.primary_color,
        nabl_accreditation_number: form.nabl_accreditation_number || null,
        nabl_valid_upto: form.nabl_valid_upto || null,
        drug_license_number: form.drug_license_number || null,
        drug_license_valid_upto: form.drug_license_valid_upto || null,
        registration_80g: form.registration_80g || null,
        trust_pan: form.trust_pan || null,
        patient_languages: patientLanguages,
        uhid_prefix: form.uhid_prefix.trim().toUpperCase() || "UHID",
        uhid_date_format: form.uhid_date_format,
      } as any).eq("id", hospital.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Hospital profile updated" });
      qc.invalidateQueries({ queryKey: ["settings-hospital"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-6 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/settings")} className="text-muted-foreground hover:text-foreground active:scale-95"><ArrowLeft size={18} /></button>
          <h1 className="text-lg font-bold text-foreground">Hospital Profile</h1>
        </div>
        <button onClick={() => save.mutate()} disabled={save.isPending} className="bg-primary text-primary-foreground px-5 py-2 rounded-lg text-sm font-medium hover:opacity-90 active:scale-[0.97] disabled:opacity-40">
          {save.isPending ? "Saving..." : "Save Changes"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto flex justify-center pt-8 px-6 pb-10">
        <div className="w-full max-w-2xl space-y-5">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Hospital Name *</label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-10" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Address</label>
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Full address" className="h-10" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">State</label>
              <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} className="h-10" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Pincode</label>
              <Input value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} className="h-10" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">GSTIN</label>
              <Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} placeholder="22AAAAA0000A1Z5" className="h-10" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">NABH Number</label>
              <Input value={form.nabh_number} onChange={(e) => setForm({ ...form, nabh_number: e.target.value })} className="h-10" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">NABL Accreditation No.</label>
              <Input value={form.nabl_accreditation_number} onChange={(e) => setForm({ ...form, nabl_accreditation_number: e.target.value })} placeholder="MC-0000" className="h-10" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">NABL Valid Up To</label>
              <Input type="date" value={form.nabl_valid_upto} onChange={(e) => setForm({ ...form, nabl_valid_upto: e.target.value })} className="h-10" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Drug License No. (Form 20B/21B)</label>
              <Input value={form.drug_license_number} onChange={(e) => setForm({ ...form, drug_license_number: e.target.value })} placeholder="e.g. 20B/21B-XXXXX" className="h-10" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Drug License Valid Up To</label>
              <Input type="date" value={form.drug_license_valid_upto} onChange={(e) => setForm({ ...form, drug_license_valid_upto: e.target.value })} className="h-10" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">80G Registration No. (Charitable)</label>
              <Input value={form.registration_80g} onChange={(e) => setForm({ ...form, registration_80g: e.target.value })} placeholder="AAATH1234QF20213" className="h-10" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Trust PAN (for 80G receipts)</label>
              <Input value={form.trust_pan} onChange={(e) => setForm({ ...form, trust_pan: e.target.value })} placeholder="AAATH1234Q" className="h-10" />
            </div>
          </div>

          {/* ── UHID Configuration ── */}
          <div className="border border-border rounded-xl p-4 space-y-3">
            <div>
              <p className="text-[13px] font-semibold text-foreground">UHID Configuration</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Customise the unique patient ID format for this hospital. Applied to all new registrations.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">UHID Prefix</label>
                <Input
                  value={form.uhid_prefix}
                  onChange={(e) => setForm({ ...form, uhid_prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
                  placeholder="e.g. BH, NIMR, GH"
                  maxLength={10}
                  className="h-10 font-mono"
                />
                <p className="text-[10px] text-muted-foreground mt-1">Letters and numbers only, max 10 chars</p>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Date in UHID</label>
                <select
                  value={form.uhid_date_format}
                  onChange={(e) => setForm({ ...form, uhid_date_format: e.target.value })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="YYYYMMDD">Full date — {form.uhid_prefix || "BH"}-20260606-0001</option>
                  <option value="YYYY">Year only — {form.uhid_prefix || "BH"}-2026-0001</option>
                  <option value="NONE">No date — {form.uhid_prefix || "BH"}-0001</option>
                </select>
              </div>
            </div>
            <div className="bg-muted/40 rounded-lg px-3 py-2">
              <p className="text-[11px] text-muted-foreground">
                Preview: <span className="font-mono font-semibold text-foreground">
                  {form.uhid_prefix || "UHID"}
                  {form.uhid_date_format === "YYYYMMDD" ? `-${new Date().toISOString().slice(0,10).replace(/-/g,"")}` : ""}
                  {form.uhid_date_format === "YYYY" ? `-${new Date().getFullYear()}` : ""}
                  -0001
                </span>
              </p>
            </div>
          </div>

          <div className="w-40">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Brand Color</label>
            <div className="flex items-center gap-2">
              <input type="color" value={form.primary_color} onChange={(e) => setForm({ ...form, primary_color: e.target.value })} className="h-10 w-10 rounded border border-input cursor-pointer" />
              <Input value={form.primary_color} onChange={(e) => setForm({ ...form, primary_color: e.target.value })} className="h-10 w-28 font-mono text-sm" />
            </div>
          </div>

          {/* Preferred Patient Languages */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Preferred Patient Languages
            </label>
            <p className="text-[11px] text-muted-foreground mb-2">
              Languages available for discharge instructions, OPD prescription advice, and patient WhatsApp messages.
              English is always included.
            </p>
            <div className="flex flex-wrap gap-2">
              {ALL_PATIENT_LANGUAGES.map((lang) => {
                const isSelected = patientLanguages.includes(lang.code);
                const isEnglish  = lang.code === "English";
                return (
                  <button
                    key={lang.code}
                    type="button"
                    disabled={isEnglish}
                    onClick={() => {
                      if (isEnglish) return;
                      setPatientLanguages((prev) =>
                        isSelected
                          ? prev.filter((l) => l !== lang.code)
                          : [...prev, lang.code]
                      );
                    }}
                    className={[
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                      isSelected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:bg-muted",
                      isEnglish ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
                    ].join(" ")}
                  >
                    {lang.native !== lang.label ? `${lang.native} ${lang.label}` : lang.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

          {/* ── MFA Security Section ──────────────────────────────────────── */}
          <div className="border border-border rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Shield size={15} className="text-primary" />
              <h3 className="text-[14px] font-semibold text-foreground">Two-Factor Authentication (MFA)</h3>
            </div>

            {enrolledFactor ? (
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center shrink-0 mt-0.5">
                    <ShieldCheck size={15} className="text-green-500" />
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-foreground">MFA Active</p>
                    <p className="text-[12px] text-muted-foreground mt-0.5">
                      Your account is protected with an authenticator app.
                    </p>
                  </div>
                </div>
                <button
                  onClick={removeMfa}
                  disabled={mfaRemoving}
                  className="shrink-0 flex items-center gap-1.5 text-[12px] text-destructive hover:text-destructive/80 border border-destructive/30 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
                >
                  {mfaRemoving ? <Loader2 size={12} className="animate-spin" /> : <ShieldOff size={12} />}
                  Remove MFA
                </button>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Shield size={15} className="text-amber-500" />
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-foreground">MFA Not Configured</p>
                    <p className="text-[12px] text-muted-foreground mt-0.5">
                      Add a second layer of security to your login.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowMfaEnroll(true)}
                  className="shrink-0 flex items-center gap-1.5 text-[12px] text-primary font-medium border border-primary/30 rounded-lg px-3 py-1.5 hover:bg-primary/5 transition-colors"
                >
                  <ShieldCheck size={12} />
                  Enable MFA
                </button>
              </div>
            )}

            {/* Trusted devices list */}
            {trustedDevices && trustedDevices.length > 0 && (
              <div>
                <p className="text-[12px] font-medium text-muted-foreground mb-2">Trusted Devices</p>
                <div className="space-y-1.5">
                  {trustedDevices.map((d: any) => (
                    <div key={d.id} className="flex items-center justify-between gap-3 bg-muted/30 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Smartphone size={12} className="text-muted-foreground shrink-0" />
                        <span className="text-[12px] text-foreground truncate">{d.device_name || "Unknown device"}</span>
                        <span className="text-[11px] text-muted-foreground shrink-0">
                          · Expires {new Date(d.expires_at).toLocaleDateString("en-IN")}
                        </span>
                      </div>
                      <button
                        onClick={() => removeTrustedDevice(d.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                        title="Remove trusted device"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

      {showMfaEnroll && (
        <MFAEnrollmentModal
          canDismiss
          onEnrolled={() => { setShowMfaEnroll(false); refetchMfa(); }}
          onDismiss={() => setShowMfaEnroll(false)}
        />
      )}
    </div>
  );
};

export default SettingsProfilePage;
