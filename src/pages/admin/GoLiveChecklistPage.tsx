import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, ExternalLink, CheckCircle2, Circle, Rocket, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface CheckItem {
  id: string;
  label: string;
  auto: boolean;
  link?: string;
  linkLabel?: string;
  group: string;
}

const GROUPS = [
  { id: "setup", label: "Hospital Setup", emoji: "🏥", count: 7 },
  { id: "clinical", label: "Clinical Configuration", emoji: "🩺", count: 6 },
  { id: "training", label: "Staff Training", emoji: "🎓", count: 5 },
  { id: "security", label: "Security", emoji: "🔒", count: 4 },
  { id: "compliance", label: "Compliance", emoji: "📋", count: 5 },
  { id: "technical", label: "Technical Verification", emoji: "🔧", count: 3 },
];

const ITEMS: CheckItem[] = [
  // Setup
  { id: "hospital_profile", label: "Hospital profile complete (name, address, phone, GSTIN)", auto: true, link: "/settings/profile", linkLabel: "Verify →", group: "setup" },
  { id: "department_exists", label: "At least 1 department created", auto: true, link: "/settings/departments", linkLabel: "Fix →", group: "setup" },
  { id: "ward_beds_exist", label: "At least 1 ward + beds created", auto: true, link: "/settings/wards", linkLabel: "Fix →", group: "setup" },
  { id: "doctor_exists", label: "At least 1 doctor added as staff", auto: true, link: "/settings/staff", linkLabel: "Fix →", group: "setup" },
  { id: "consultation_fee", label: "OPD consultation fee configured (> ₹0)", auto: true, link: "/settings/services", linkLabel: "Fix →", group: "setup" },
  { id: "logo_uploaded", label: "Hospital logo uploaded", auto: true, link: "/settings/branding", linkLabel: "Fix →", group: "setup" },
  { id: "razorpay_config", label: "Razorpay or UPI ID configured (for payments)", auto: true, link: "/settings/razorpay", linkLabel: "Fix →", group: "setup" },
  // Clinical
  { id: "lab_tests_min", label: "Lab test master has tests (minimum 20)", auto: true, link: "/settings/lab-tests", linkLabel: "Fix →", group: "clinical" },
  { id: "drugs_min", label: "Drug master has drugs (minimum 50)", auto: true, link: "/settings/drugs", linkLabel: "Fix →", group: "clinical" },
  { id: "drug_stock", label: "Drug batches/stock received", auto: true, group: "clinical" },
  { id: "consent_forms", label: "Default consent forms configured (≥ 3)", auto: true, link: "/settings/consent-forms", linkLabel: "Fix →", group: "clinical" },
  { id: "ndps_marked", label: "NDPS drugs marked in drug master (if applicable)", auto: false, link: "/settings/drugs", linkLabel: "Mark NDPS drugs →", group: "clinical" },
  { id: "shift_config", label: "Shift schedule configured", auto: true, link: "/settings/shifts", linkLabel: "Fix →", group: "clinical" },
  // Training
  { id: "train_reception", label: "Reception staff trained: patient registration + OPD queue", auto: false, group: "training" },
  { id: "train_doctors", label: "Doctors trained: OPD consultation + voice scribe (at least 2)", auto: false, group: "training" },
  { id: "train_nurses", label: "Nurses trained: MAR + ward rounds + handover", auto: false, group: "training" },
  { id: "train_lab", label: "Lab technicians trained: sample collection + result entry", auto: false, group: "training" },
  { id: "train_billing", label: "Billing staff trained: bill creation + payment collection", auto: false, group: "training" },
  // Security
  { id: "staff_accounts", label: "All staff have individual login accounts (no sharing)", auto: true, group: "security" },
  { id: "password_changed", label: "Super admin password changed from default", auto: false, group: "security" },
  { id: "demo_data_cleared", label: "Test hospital/demo data removed or clearly marked", auto: false, group: "security" },
  { id: "portal_url_shared", label: "Patient portal URL shared with test patient", auto: false, group: "security" },
  // Compliance
  { id: "gstin_valid", label: "GSTIN confirmed in hospital profile (15 characters)", auto: true, link: "/settings/profile", linkLabel: "Fix →", group: "compliance" },
  { id: "ndps_restricted", label: "NDPS register access restricted to pharmacist only", auto: false, group: "compliance" },
  { id: "consent_working", label: "Patient consent checkbox working on registration", auto: false, group: "compliance" },
  { id: "backup_tested", label: "Backup & export tested successfully", auto: false, link: "/settings/backup", linkLabel: "Test →", group: "compliance" },
  { id: "dpdp_aware", label: "Staff aware of data privacy (DPDP) obligations", auto: false, group: "compliance" },
  // Technical
  { id: "e2e_journey", label: "Test patient journey: Register → OPD → Lab → Result → Bill → Payment", auto: false, group: "technical" },
  { id: "whatsapp_test", label: "WhatsApp notifications working (send test message)", auto: false, group: "technical" },
  { id: "analytics_data", label: "Analytics dashboard showing data", auto: true, group: "technical" },
];

const GoLiveChecklistPage: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [autoChecks, setAutoChecks] = useState<Record<string, boolean>>({});
  const [manualChecks, setManualChecks] = useState<Record<string, boolean>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    Object.fromEntries(GROUPS.map(g => [g.id, true]))
  );
  const [loading, setLoading] = useState(true);

  // Load hospital id
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("users").select("hospital_id").eq("auth_user_id", user.id).maybeSingle();
      if (data?.hospital_id) setHospitalId(data.hospital_id);
    })();
  }, []);

  // Load saved manual checks
  useEffect(() => {
    if (!hospitalId) return;
    (async () => {
      const { data } = await supabase
        .from("system_config")
        .select("value")
        .eq("hospital_id", hospitalId)
        .eq("key", "golive_checklist")
        .maybeSingle();
      if (data?.value && typeof data.value === "object") {
        setManualChecks(data.value as Record<string, boolean>);
      }
    })();
  }, [hospitalId]);

  // Run auto-checks
  const runAutoChecks = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const checks: Record<string, boolean> = {};

    try {
      const [
        hospitalRes,
        deptRes,
        wardRes,
        bedRes,
        doctorRes,
        feeRes,
        labRes,
        drugRes,
        batchRes,
        consentRes,
        shiftRes,
        staffRes,
        billsRes,
        encountersRes,
        razorpayRes,
      ] = await Promise.all([
        supabase.from("hospitals").select("name, address, phone, gstin, logo_url").eq("id", hospitalId).maybeSingle(),
        supabase.from("departments").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId),
        supabase.from("wards").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId),
        supabase.from("beds").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId),
        supabase.from("users").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("role", "doctor"),
        supabase.from("service_master").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("item_type", "consultation").gt("fee", 0),
        supabase.from("lab_test_master").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId),
        supabase.from("drug_master").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId),
        supabase.from("drug_batches").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).gt("quantity_available", 0),
        supabase.from("consent_templates").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId),
        supabase.from("shift_master").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId),
        supabase.from("users").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("is_active", true),
        supabase.from("bills").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId),
        supabase.from("opd_encounters").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId),
        supabase.from("system_config").select("id").eq("hospital_id", hospitalId).eq("key", "razorpay_config").maybeSingle(),
      ]);

      const h = hospitalRes.data;
      checks.hospital_profile = !!(h?.name && h?.address && h?.phone);
      checks.department_exists = (deptRes.count ?? 0) > 0;
      checks.ward_beds_exist = (wardRes.count ?? 0) > 0 && (bedRes.count ?? 0) > 0;
      checks.doctor_exists = (doctorRes.count ?? 0) > 0;
      checks.consultation_fee = (feeRes.count ?? 0) > 0;
      checks.logo_uploaded = !!h?.logo_url;
      checks.razorpay_config = !!razorpayRes.data;
      checks.lab_tests_min = (labRes.count ?? 0) >= 20;
      checks.drugs_min = (drugRes.count ?? 0) >= 50;
      checks.drug_stock = (batchRes.count ?? 0) > 0;
      checks.consent_forms = (consentRes.count ?? 0) >= 3;
      checks.shift_config = (shiftRes.count ?? 0) > 0;
      checks.staff_accounts = (staffRes.count ?? 0) >= 3;
      checks.gstin_valid = !!(h?.gstin && h.gstin.length === 15);
      checks.analytics_data = (billsRes.count ?? 0) > 0 && (encountersRes.count ?? 0) > 0;
    } catch (e) {
      console.error("Go-live auto-check error:", e);
    }

    setAutoChecks(checks);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { runAutoChecks(); }, [runAutoChecks]);

  // Save manual checks
  const toggleManual = async (id: string) => {
    const updated = { ...manualChecks, [id]: !manualChecks[id] };
    setManualChecks(updated);
    if (!hospitalId) return;

    const { data: existing } = await supabase
      .from("system_config")
      .select("id")
      .eq("hospital_id", hospitalId)
      .eq("key", "golive_checklist")
      .maybeSingle();

    if (existing) {
      await supabase.from("system_config").update({ value: updated as any }).eq("id", existing.id);
    } else {
      await supabase.from("system_config").insert({
        hospital_id: hospitalId,
        key: "golive_checklist",
        value: updated as any,
      } as any);
    }
  };

  const isChecked = (item: CheckItem): boolean => {
    if (item.auto) return autoChecks[item.id] ?? false;
    return manualChecks[item.id] ?? false;
  };

  const totalDone = ITEMS.filter(isChecked).length;
  const totalItems = ITEMS.length;
  const pct = Math.round((totalDone / totalItems) * 100);

  const readinessBadge = () => {
    if (totalDone === totalItems) return { label: "✅ PRODUCTION READY", color: "bg-emerald-100 text-emerald-800 border-emerald-300" };
    if (totalDone > 25) return { label: "🟢 READY FOR PILOT", color: "bg-green-100 text-green-800 border-green-300" };
    if (totalDone >= 15) return { label: "🟡 ALMOST READY", color: "bg-amber-100 text-amber-800 border-amber-300" };
    return { label: "🔴 NOT READY", color: "bg-red-100 text-red-800 border-red-300" };
  };

  const badge = readinessBadge();
  const progressColor = totalDone > 25 ? "bg-emerald-500" : totalDone >= 15 ? "bg-amber-500" : "bg-red-500";

  const toggleGroup = (id: string) => setExpandedGroups(prev => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="h-[calc(100vh-56px)] overflow-y-auto bg-background">
      <div className="max-w-[800px] mx-auto px-8 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Rocket className="w-6 h-6" /> Pilot Hospital Go-Live Checklist
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Complete all items before processing the first real patient</p>
          </div>
          <div className={cn("px-3 py-1.5 rounded-full text-xs font-bold border", badge.color)}>
            {badge.label}
          </div>
        </div>

        {/* Progress bar */}
        <div className="mb-8 bg-card rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-foreground">{totalDone} of {totalItems} items complete</span>
            <span className="text-sm font-bold text-foreground">{pct}%</span>
          </div>
          <div className="h-3 bg-muted rounded-full overflow-hidden">
            <div className={cn("h-full rounded-full transition-all duration-500", progressColor)} style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* Celebration */}
        {totalDone === totalItems && (
          <div className="mb-8 bg-emerald-50 dark:bg-emerald-950/30 border-2 border-emerald-400 rounded-xl p-6 text-center animate-in zoom-in duration-300">
            <PartyPopper className="w-12 h-12 text-emerald-600 mx-auto mb-3" />
            <h2 className="text-xl font-bold text-emerald-800 dark:text-emerald-300 mb-1">
              🎉 System is ready for your first real patient!
            </h2>
            <p className="text-sm text-emerald-700 dark:text-emerald-400 mb-4">All {totalItems} checklist items are verified and complete.</p>
            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" size="sm" onClick={() => {
                const summary = ITEMS.map(i => `✅ ${i.label}`).join("\n");
                const blob = new Blob([`Go-Live Checklist — All ${totalItems} items complete\n\n${summary}`], { type: "text/plain" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url; a.download = "go-live-certificate.txt"; a.click();
                URL.revokeObjectURL(url);
              }}>
                📋 Download Go-Live Certificate
              </Button>
            </div>
          </div>
        )}

        {/* Groups */}
        {loading ? (
          <div className="space-y-4">
            {[1,2,3].map(i => (
              <div key={i} className="h-16 bg-muted rounded-xl skeleton-shimmer" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {GROUPS.map(group => {
              const groupItems = ITEMS.filter(i => i.group === group.id);
              const groupDone = groupItems.filter(isChecked).length;
              const expanded = expandedGroups[group.id];

              return (
                <div key={group.id} className="bg-card border border-border rounded-xl overflow-hidden">
                  <button
                    onClick={() => toggleGroup(group.id)}
                    className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{group.emoji}</span>
                      <span className="font-semibold text-foreground text-sm">{group.label}</span>
                      <span className={cn(
                        "text-xs font-bold px-2 py-0.5 rounded-full",
                        groupDone === groupItems.length ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"
                      )}>
                        {groupDone}/{groupItems.length}
                      </span>
                    </div>
                    {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                  </button>

                  {expanded && (
                    <div className="border-t border-border">
                      {groupItems.map(item => {
                        const checked = isChecked(item);
                        const isAuto = item.auto;

                        return (
                          <div
                            key={item.id}
                            className={cn(
                              "flex items-center gap-3 px-5 py-3 border-b border-border last:border-b-0 transition-colors",
                              checked ? "bg-emerald-50/50 dark:bg-emerald-950/10" : ""
                            )}
                          >
                            {isAuto ? (
                              checked ? (
                                <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                              ) : (
                                <Circle className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                              )
                            ) : (
                              <button
                                onClick={() => toggleManual(item.id)}
                                className="flex-shrink-0"
                              >
                                {checked ? (
                                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                                ) : (
                                  <Circle className="w-5 h-5 text-muted-foreground hover:text-foreground transition-colors" />
                                )}
                              </button>
                            )}

                            <span className={cn(
                              "text-sm flex-1",
                              checked ? "text-muted-foreground line-through" : "text-foreground"
                            )}>
                              {item.label}
                            </span>

                            {item.link && !checked && (
                              <button
                                onClick={() => navigate(item.link!)}
                                className="text-xs font-medium text-primary hover:underline flex items-center gap-1 flex-shrink-0"
                              >
                                {item.linkLabel || "Fix →"}
                                <ExternalLink className="w-3 h-3" />
                              </button>
                            )}

                            {isAuto && (
                              <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded flex-shrink-0">
                                auto
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default GoLiveChecklistPage;
