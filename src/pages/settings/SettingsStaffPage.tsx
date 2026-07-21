import React, { useState, useMemo, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useCapacityCheck } from "@/hooks/useCapacityCheck";
import {
  ArrowLeft, Plus, X, Users, Stethoscope, HeartPulse,
  Receipt, Pill, TestTube, ClipboardList, Shield, Wrench, Trash2, ShieldCheck,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import StaffPrivilegesPanel from "@/components/hr/StaffPrivilegesPanel";
import StaffAccessPanel from "@/components/settings/StaffAccessPanel";

/* ─── Types ─── */
type AppRole = string;

interface StaffForm {
  full_name: string;
  phone: string;
  email: string;
  role: AppRole;
  department_id: string;
  registration_number: string;
  ward_id: string;
  // Employment & Salary
  employee_id: string;
  employment_type: string;
  employee_type: string;
  basic_salary: string;
  hra_percent: string;
  da_percent: string;
  conveyance: string;
  medical_allowance: string;
  pf_applicable: boolean;
  esic_applicable: boolean;
  uan_number: string;
  pan_number: string;
  esi_ip_number: string;
  license_expiry_date: string;
  hpr_id: string;
  // Doctor pricing
  consultation_fee: string;
  follow_up_fee: string;
  validity_days: string;
  emergency_fee: string;
  ipd_consultation_fee: string;
  ot_surgeon_fee: string;
  ot_anaesthetist_fee: string;
}

const EMPTY_FORM: StaffForm = {
  full_name: "", phone: "", email: "", role: "" as AppRole,
  department_id: "", registration_number: "", ward_id: "",
  employee_id: "", employment_type: "permanent", employee_type: "staff", basic_salary: "",
  hra_percent: "20", da_percent: "10", conveyance: "1600", medical_allowance: "1250",
  pf_applicable: true, esic_applicable: false, uan_number: "", pan_number: "", esi_ip_number: "", license_expiry_date: "",
  hpr_id: "",
  consultation_fee: "", follow_up_fee: "", validity_days: "7", emergency_fee: "", ipd_consultation_fee: "",
  ot_surgeon_fee: "", ot_anaesthetist_fee: "",
};

/* ─── Role config ─── */
const ROLE_META: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  doctor:            { icon: Stethoscope,   label: "Doctor",            color: "bg-blue-50 text-blue-700 border-blue-200" },
  nurse:             { icon: HeartPulse,    label: "Nurse",             color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  accountant:        { icon: Receipt,       label: "Accountant",        color: "bg-amber-50 text-amber-700 border-amber-200" },
  billing_executive: { icon: Receipt,       label: "Billing Executive", color: "bg-amber-50 text-amber-700 border-amber-200" },
  billing_staff:     { icon: Receipt,       label: "Billing Staff",     color: "bg-amber-50 text-amber-700 border-amber-200" },
  cfo:               { icon: Receipt,       label: "CFO",               color: "bg-amber-50 text-amber-700 border-amber-200" },
  pharmacist:        { icon: Pill,          label: "Pharmacist",        color: "bg-violet-50 text-violet-700 border-violet-200" },
  lab_tech:          { icon: TestTube,      label: "Lab Tech",          color: "bg-rose-50 text-rose-700 border-rose-200" },
  lab_technician:    { icon: TestTube,      label: "Lab Technician",    color: "bg-rose-50 text-rose-700 border-rose-200" },
  radiologist:       { icon: TestTube,      label: "Radiologist",       color: "bg-rose-50 text-rose-700 border-rose-200" },
  receptionist:      { icon: ClipboardList, label: "Reception",         color: "bg-green-50 text-green-700 border-green-200" },
  hr_manager:        { icon: Users,         label: "HR Manager",        color: "bg-cyan-50 text-cyan-700 border-cyan-200" },
  hospital_admin:    { icon: Shield,        label: "Admin",             color: "bg-[hsl(222,55%,23%)] text-white border-transparent" },
  super_admin:       { icon: Shield,        label: "Super Admin",       color: "bg-[hsl(222,55%,23%)] text-white border-transparent" },
};

const DEFAULT_ROLE_CARDS: { role: AppRole; icon: React.ElementType; label: string }[] = [
  { role: "doctor",         icon: Stethoscope,   label: "Doctor" },
  { role: "nurse",          icon: HeartPulse,     label: "Nurse" },
  { role: "accountant",     icon: Receipt,        label: "Billing" },
  { role: "pharmacist",     icon: Pill,           label: "Pharmacist" },
  { role: "lab_tech",       icon: TestTube,       label: "Lab Tech" },
  { role: "receptionist",   icon: ClipboardList,  label: "Reception" },
  { role: "hospital_admin", icon: Shield,         label: "Admin / CEO" },
];

/* Valid app_role enum values from Postgres — staff role MUST be one of these */
const VALID_APP_ROLES = [
  "super_admin", "hospital_admin", "doctor", "nurse", "receptionist",
  "pharmacist", "lab_tech", "accountant", "billing_executive", "hr_manager",
  "lab_technician", "radiologist", "cfo", "billing_staff",
] as const;
const VALID_APP_ROLES_SET = new Set<string>(VALID_APP_ROLES);

/* ─── Bulk doctor row ─── */
interface BulkRow { name: string; speciality: string; phone: string; dept_id: string; fee: string }
const EMPTY_BULK: BulkRow = { name: "", speciality: "", phone: "", dept_id: "", fee: "" };

/* ─── Page ─── */
const SettingsStaffPage: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { checkStaffCapacity } = useCapacityCheck();

  const location = useLocation();
  const [filter, setFilter] = useState("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<StaffForm>(EMPTY_FORM);
  const [hiredApplicantId, setHiredApplicantId] = useState<string | null>(null);

  // Recruitment → hire: open the add-staff drawer pre-filled from the applicant.
  useEffect(() => {
    const prefill = (location.state as any)?.prefill;
    if (!prefill) return;
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      full_name: prefill.full_name || "",
      phone: prefill.phone || "",
      email: prefill.email || "",
      department_id: prefill.department_id || "",
    });
    setHiredApplicantId(prefill.applicant_id || null);
    setDrawerOpen(true);
    // clear router state so a refresh/back doesn't re-open
    window.history.replaceState({}, "");
  }, [location.state]);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([{ ...EMPTY_BULK }]);

  const [loginModal, setLoginModal] = useState<{ open: boolean; userId: string; userName: string; email: string } | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [creatingLogin, setCreatingLogin] = useState(false);
  const [resettingMfaId, setResettingMfaId] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<"profile" | "privileges" | "access">("profile");

  // HPR verification state (per-open-drawer)
  const [hprVerifying, setHprVerifying] = useState(false);
  const [hprResult, setHprResult] = useState<{ name: string; speciality: string; qualification: string; council: string } | null>(null);
  const [hprError, setHprError] = useState<string | null>(null);

  const { hospitalId } = useHospitalId();

  /* ─── Queries ─── */
  const { data: users, isLoading } = useQuery({
    queryKey: ["settings-staff"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("id, full_name, email, phone, role, is_active, registration_number, department_id, auth_user_id, can_login, hpr_id, hpr_verified_at, mfa_required")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: departments } = useQuery({
    queryKey: ["settings-departments-list"],
    queryFn: async () => {
      const { data } = await supabase.from("departments").select("id, name").eq("is_active", true).order("name");
      return data ?? [];
    },
  });

  const { data: wards } = useQuery({
    queryKey: ["settings-wards-list"],
    queryFn: async () => {
      const { data } = await supabase.from("wards").select("id, name").eq("is_active", true).order("name");
      return data ?? [];
    },
  });

  const { data: customRoles } = useQuery({
    queryKey: ["settings-custom-roles"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("role_permissions")
        .select("role_name, role_label, is_system_role")
        .order("role_label");
      return data ?? [];
    },
  });

  /* ─── Dynamic role cards + filter tabs ─── */
  // Show the 7 system defaults plus any custom roles whose role_name maps to a
  // valid Postgres app_role enum value. Custom roles outside the enum are ignored
  // because users.role is a strict ENUM and would reject them.
  const ROLE_CARDS = useMemo(() => {
    const defaultRoleSet = new Set(DEFAULT_ROLE_CARDS.map((c) => c.role));
    const labelOverride = new Map<string, string>();
    (customRoles ?? []).forEach((r: any) => {
      if (VALID_APP_ROLES_SET.has(r.role_name) && r.role_label) {
        labelOverride.set(r.role_name, r.role_label);
      }
    });
    const baseCards = DEFAULT_ROLE_CARDS.map((c) => ({
      ...c,
      label: labelOverride.get(c.role) || c.label,
    }));
    const extraCards = (customRoles ?? [])
      .filter((r: any) => VALID_APP_ROLES_SET.has(r.role_name) && !defaultRoleSet.has(r.role_name))
      .map((r: any) => {
        const meta = ROLE_META[r.role_name];
        return {
          role: r.role_name as AppRole,
          icon: meta?.icon ?? Users,
          label: r.role_label || meta?.label || r.role_name,
        };
      });
    return [...baseCards, ...extraCards];
  }, [customRoles]);

  /* ─── Computed ─── */
  const filtered = useMemo(() => {
    if (!users) return [];
    if (filter === "all") return users;
    if (filter === "admin") return users.filter((u) => u.role === "hospital_admin" || u.role === "super_admin");
    return users.filter((u) => u.role === filter);
  }, [users, filter]);

  const FILTER_TABS = useMemo(() => {
    const tabs: { key: string; label: string }[] = [{ key: "all", label: "All" }];
    if (!users) return tabs;
    const roleCounts = new Map<string, number>();
    users.forEach((u) => {
      const r = u.role;
      // Skip any legacy/invalid role values that aren't in the enum
      if (!VALID_APP_ROLES_SET.has(r)) return;
      roleCounts.set(r, (roleCounts.get(r) || 0) + 1);
    });
    roleCounts.forEach((_, role) => {
      if (role === "hospital_admin" || role === "super_admin") {
        if (!tabs.find((t) => t.key === "admin")) tabs.push({ key: "admin", label: "Admin" });
      } else {
        const meta = ROLE_META[role];
        const customRole = customRoles?.find((cr: any) => cr.role_name === role);
        tabs.push({ key: role, label: customRole?.role_label || meta?.label || role });
      }
    });
    return tabs;
  }, [users, customRoles]);

  const doctorCount = useMemo(() => users?.filter((u) => u.role === "doctor").length ?? 0, [users]);

  /* ─── Mutations ─── */
  const getHospitalId = async () => {
    const { data } = await supabase.from("users").select("hospital_id").limit(1).maybeSingle();
    if (!data) throw new Error("No hospital context");
    return data.hospital_id;
  };

  // Only send department_id for roles that actually use the departments dropdown
  const getSafeDepartmentId = () => {
    return form.department_id && form.department_id.trim() !== "" ? form.department_id : null;
  };

  const buildProfilePayload = (userId: string, hid: string, deptId: string | null) => ({
    user_id: userId,
    hospital_id: hid,
    designation: form.role,
    employment_type: form.employment_type || "permanent",
    employee_type: form.employee_type || "staff",
    department_id: deptId,
    registration_number: form.registration_number || null,
    employee_id: form.employee_id || null,
    basic_salary: form.basic_salary ? parseFloat(form.basic_salary) : null,
    hra_percent: form.hra_percent ? parseFloat(form.hra_percent) : 20,
    da_percent: form.da_percent ? parseFloat(form.da_percent) : 10,
    conveyance: form.conveyance ? parseFloat(form.conveyance) : 1600,
    medical_allowance: form.medical_allowance ? parseFloat(form.medical_allowance) : 1250,
    pf_applicable: form.pf_applicable,
    esic_applicable: form.esic_applicable,
    uan_number: form.uan_number || null,
    pan_number: form.pan_number || null,
    esi_ip_number: form.esi_ip_number || null,
    license_expiry_date: form.license_expiry_date || null,
    is_active: true,
  });

  // Per-doctor OT contract rate (surgeon_fee / anaesthesia_fee) — same mechanism as
  // the consultation fee above: a service_master row scoped by doctor_id, resolved
  // ahead of the hospital-wide default by chargeOTCase's rate lookup (serviceBilling.ts).
  const saveOtFeeRow = async (hid: string, doctorId: string, itemType: "surgeon_fee" | "anaesthesia_fee", label: string, feeValue: string) => {
    if (!feeValue) return;
    const { data: existing } = await (supabase as any).from("service_master")
      .select("id")
      .eq("hospital_id", hid).eq("doctor_id", doctorId).eq("item_type", itemType)
      .maybeSingle();
    const payload = {
      hospital_id: hid,
      name: `${label} - Dr. ${form.full_name}`,
      category: itemType,
      item_type: itemType,
      doctor_id: doctorId,
      fee: parseFloat(feeValue),
      is_active: true,
    };
    if (existing?.id) {
      await (supabase as any).from("service_master").update(payload).eq("id", existing.id);
    } else {
      await (supabase as any).from("service_master").insert(payload);
    }
  };

  const saveStaff = useMutation({
    mutationFn: async () => {
      // Guard: role must be a valid Postgres app_role enum value
      if (!form.role || !VALID_APP_ROLES_SET.has(form.role)) {
        throw new Error("Please select a valid role before saving.");
      }
      // Phone validation: must be exactly 10 digits if provided
      if (form.phone && !/^\d{10}$/.test(form.phone.trim())) {
        throw new Error("Phone number must be exactly 10 digits.");
      }
      // Duplicate email check for new staff
      if (!editingId && form.email && !form.email.endsWith("@placeholder.local")) {
        const { data: existing } = await supabase
          .from("users")
          .select("id")
          .eq("email", form.email.toLowerCase().trim())
          .maybeSingle();
        if (existing) {
          throw new Error("A staff member with this email already exists.");
        }
      }
      const hid = await getHospitalId();
      const deptId = getSafeDepartmentId();
      if (editingId) {
        const { error } = await supabase.from("users").update({
          full_name: form.full_name,
          phone: form.phone || null,
          email: form.email,
          role: form.role as any,
          department_id: deptId,
          registration_number: form.registration_number || null,
          hpr_id: form.hpr_id || null,
        } as any).eq("id", editingId);
        if (error) throw error;

        // Upsert staff_profiles with salary data
        await (supabase as any).from("staff_profiles").upsert(
          buildProfilePayload(editingId, hid, deptId),
          { onConflict: "user_id" }
        );
      } else {
        // Check staff capacity against plan limit before inserting
        const capacity = await checkStaffCapacity();
        if (!capacity.allowed) {
          throw new Error(
            `Staff limit reached (${capacity.current}/${capacity.max} on ${capacity.plan_slug} plan). Upgrade your plan at Settings → Plan & Billing to add more staff.`
          );
        }
        const newId = crypto.randomUUID();
        const { error } = await supabase.from("users").insert({
          id: newId,
          hospital_id: hid,
          full_name: form.full_name,
          email: form.email || `${form.phone || Date.now()}@placeholder.local`,
          phone: form.phone || null,
          role: form.role as any,
          department_id: deptId,
          registration_number: form.registration_number || null,
          hpr_id: form.hpr_id || null,
          is_active: true,
          can_login: false,
          auth_user_id: null,
        } as any);
        if (error) throw error;

        // Create staff_profiles row with salary data
        await (supabase as any).from("staff_profiles").insert(buildProfilePayload(newId, hid, deptId));

        // If this staff was created from a recruitment "hire", link the applicant.
        if (hiredApplicantId) {
          await (supabase as any).from("job_applicants").update({ hired_user_id: newId }).eq("id", hiredApplicantId);
          setHiredApplicantId(null);
        }

        // Create service_master row for doctor consultation fee
        if (form.role === "doctor" && form.consultation_fee) {
          const { error: feeErr } = await (supabase as any).from("service_master").insert({
            hospital_id: hid,
            name: `Consultation - Dr. ${form.full_name}`,
            category: "consultation",
            item_type: "consultation",
            doctor_id: newId,
            department_id: deptId,
            fee: parseFloat(form.consultation_fee),
            follow_up_fee: form.follow_up_fee ? parseFloat(form.follow_up_fee) : null,
            validity_days: parseInt(form.validity_days) || 7,
            emergency_fee: form.emergency_fee ? parseFloat(form.emergency_fee) : null,
            ipd_consultation_fee: form.ipd_consultation_fee ? parseFloat(form.ipd_consultation_fee) : null,
            is_active: true,
          });
          if (feeErr) console.error("Fee save error:", feeErr);
        }
        if (form.role === "doctor") {
          await saveOtFeeRow(hid, newId, "surgeon_fee", "OT Surgeon Fee", form.ot_surgeon_fee);
          await saveOtFeeRow(hid, newId, "anaesthesia_fee", "OT Anaesthetist Fee", form.ot_anaesthetist_fee);
        }
      }

      // Save/update service_master for doctor on edit
      if (editingId && form.role === "doctor" && form.consultation_fee) {
        const deptId2 = getSafeDepartmentId();
        // Check if fee row already exists
        const { data: existingFee } = await (supabase as any).from("service_master")
          .select("id")
          .eq("hospital_id", hid)
          .eq("doctor_id", editingId)
          .eq("item_type", "consultation")
          .maybeSingle();
        
        const feePayload = {
          hospital_id: hid,
          name: `Consultation - Dr. ${form.full_name}`,
          category: "consultation",
          item_type: "consultation",
          doctor_id: editingId,
          department_id: deptId2,
          fee: parseFloat(form.consultation_fee),
          follow_up_fee: form.follow_up_fee ? parseFloat(form.follow_up_fee) : null,
          validity_days: parseInt(form.validity_days) || 7,
          emergency_fee: form.emergency_fee ? parseFloat(form.emergency_fee) : null,
          ipd_consultation_fee: form.ipd_consultation_fee ? parseFloat(form.ipd_consultation_fee) : null,
          is_active: true,
        };

        if (existingFee?.id) {
          const { error: feeErr } = await (supabase as any).from("service_master")
            .update(feePayload).eq("id", existingFee.id);
          if (feeErr) console.error("Fee update error:", feeErr);
        } else {
          const { error: feeErr } = await (supabase as any).from("service_master")
            .insert(feePayload);
          if (feeErr) console.error("Fee insert error:", feeErr);
        }
      }
      if (editingId && form.role === "doctor") {
        await saveOtFeeRow(hid, editingId, "surgeon_fee", "OT Surgeon Fee", form.ot_surgeon_fee);
        await saveOtFeeRow(hid, editingId, "anaesthesia_fee", "OT Anaesthetist Fee", form.ot_anaesthetist_fee);
      }
    },
    onSuccess: () => {
      toast({ title: `${form.full_name} ${editingId ? "updated" : "added"} as ${ROLE_META[form.role]?.label ?? form.role} ✓` });
      qc.invalidateQueries({ queryKey: ["settings-staff"] });
      closeDrawer();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("users").update({ is_active: !active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings-staff"] }),
  });

  const bulkSave = useMutation({
    mutationFn: async () => {
      const hid = await getHospitalId();
      const valid = bulkRows.filter((r) => r.name.trim());
      if (!valid.length) return;
      const rows = valid.map((r) => ({
        id: crypto.randomUUID(),
        hospital_id: hid,
        full_name: r.name,
        email: `${r.name.toLowerCase().replace(/\s+/g, ".")}@placeholder.local`,
        phone: r.phone || null,
        role: "doctor" as const,
        department_id: r.dept_id && r.dept_id.trim() !== "" ? r.dept_id : null,
        registration_number: null,
        is_active: true,
        can_login: false,
        auth_user_id: null,
      }));
      const { error } = await supabase.from("users").insert(rows as any);
      if (error) throw error;

      // Create staff_profiles for bulk-added doctors
      const profileRows = rows.map((r) => ({
        hospital_id: hid,
        user_id: r.id,
        designation: "doctor",
        department_id: r.department_id,
        is_active: true,
      }));
      await (supabase as any).from("staff_profiles").insert(profileRows);

      // Create service_master rows for doctors with fees
      const svcRows = valid
        .map((v, i) => ({ ...v, id: rows[i].id, dept_id: rows[i].department_id }))
        .filter((v) => v.fee && parseFloat(v.fee) > 0)
        .map((v) => ({
          hospital_id: hid,
          name: `Consultation - ${v.name}`,
          category: "consultation",
          item_type: "consultation",
          doctor_id: v.id,
          department_id: v.dept_id,
          fee: parseFloat(v.fee),
          is_active: true,
        }));
      if (svcRows.length > 0) {
        await (supabase as any).from("service_master").insert(svcRows);
      }
      return valid.length;
    },
    onSuccess: (count) => {
      toast({ title: `${count} doctors added successfully` });
      qc.invalidateQueries({ queryKey: ["settings-staff"] });
      setBulkOpen(false);
      setBulkRows([{ ...EMPTY_BULK }]);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  /* ─── MFA reset handler ─── */
  const handleResetMfa = async (authUserId: string, userName: string) => {
    if (!window.confirm(`Reset MFA for ${userName}? They will need to re-enrol their authenticator app on next login.`)) return;
    setResettingMfaId(authUserId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke("reset-staff-mfa", {
        body: { auth_user_id: authUserId },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      toast({ title: `MFA reset for ${userName}`, description: "They can log in normally and re-enrol their authenticator." });
    } catch (err: any) {
      toast({ title: "Failed to reset MFA", description: err.message, variant: "destructive" });
    } finally {
      setResettingMfaId(null);
    }
  };

  /* ─── MFA toggle handler ─── */
  const handleToggleMfa = async (userId: string, authUserId: string | null, userName: string, currentlyEnabled: boolean) => {
    const enabling = !currentlyEnabled;

    if (!enabling && authUserId) {
      // Disabling MFA — remove the TOTP factor so the user isn't blocked
      try {
        const { data: { session } } = await supabase.auth.getSession();
        await supabase.functions.invoke("reset-staff-mfa", {
          body: { auth_user_id: authUserId },
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
      } catch {
        // Non-fatal — factor may not exist yet; proceed to update flag
      }
    }

    const { error } = await supabase
      .from("users")
      .update({ mfa_required: enabling } as any)
      .eq("id", userId);

    if (error) {
      toast({ title: "Failed to update MFA setting", description: error.message, variant: "destructive" });
    } else {
      toast({
        title: enabling ? `MFA enabled for ${userName}` : `MFA disabled for ${userName}`,
        description: enabling
          ? "They will be prompted to set up an authenticator app on next login."
          : "They can now log in directly without an authenticator code.",
      });
      qc.invalidateQueries({ queryKey: ["settings-staff"] });
    }
  };

  /* ─── Login handler ─── */
  const handleCreateLogin = async () => {
    if (!loginModal) return;
    if (!loginEmail || loginPassword.length < 8) {
      toast({ title: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }
    // Pre-check if email already exists in users table
    const { data: existingUser } = await supabase
      .from("users")
      .select("id, full_name")
      .eq("email", loginEmail.trim().toLowerCase())
      .neq("id", loginModal.userId)
      .limit(1);

    if (existingUser && existingUser.length > 0) {
      toast({
        title: "Email already in use",
        description: `This email is already assigned to ${existingUser[0].full_name}. Please use a different email.`,
        variant: "destructive",
      });
      return;
    }

    setCreatingLogin(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-staff-login", {
        body: {
          user_id: loginModal.userId,
          email: loginEmail.trim().toLowerCase(),
          password: loginPassword,
          full_name: loginModal.userName,
        },
      });
      if (error || data?.error) {
        throw new Error(data?.error || error?.message || "Failed to create login");
      }
      toast({ title: `Login created for ${loginModal.userName}`, description: "They can now sign in with their email and password." });
      // Sync email back to users table if it changed
      const normalizedEmail = loginEmail.trim().toLowerCase();
      if (normalizedEmail !== loginModal.email) {
        await supabase.from("users").update({ email: normalizedEmail } as any).eq("id", loginModal.userId);
      }
      qc.invalidateQueries({ queryKey: ["settings-staff"] });
      setLoginModal(null);
      setLoginPassword("");
      setLoginEmail("");
    } catch (err: any) {
      const msg = (err.message || "").toLowerCase();
      let title = "Failed to create login";
      let description = err.message;
      if (msg.includes("already") || msg.includes("exists") || msg.includes("duplicate") || msg.includes("unique") || msg.includes("registered")) {
        title = "Email already registered";
        description = "This email already has a login account. Please use a different email address.";
      } else if (msg.includes("non-2xx") || msg.includes("status code")) {
        // Edge function returned an error — most likely duplicate email in Supabase Auth
        title = "Email already registered";
        description = "This email is already in use. Please use a different email address.";
      } else if (msg.includes("invalid") && msg.includes("email")) {
        title = "Invalid email";
        description = "Please enter a valid email address.";
      } else if (msg.includes("rate") || msg.includes("limit")) {
        title = "Too many attempts. Please wait a moment and try again.";
      }
      toast({ title, description, variant: "destructive" });
    } finally {
      setCreatingLogin(false);
    }
  };

  /* ─── Helpers ─── */
  const openDrawer = async (user?: any) => {
    if (user) {
      setEditingId(user.id);
      // Fetch staff_profiles data for salary fields
      const { data: profile } = await (supabase as any)
        .from("staff_profiles").select("*").eq("user_id", user.id).maybeSingle();
      // Fetch service_master for doctor consultation pricing + OT contract rates
      let svcRow: any = null;
      let otSurgeonRow: any = null;
      let otAnaesRow: any = null;
      if (user.role === "doctor") {
        const hid = await getHospitalId();
        const { data } = await (supabase as any).from("service_master")
          .select("fee, follow_up_fee, validity_days, emergency_fee, ipd_consultation_fee")
          .eq("hospital_id", hid).eq("doctor_id", user.id)
          .eq("item_type", "consultation").maybeSingle();
        svcRow = data;
        const { data: otRows } = await (supabase as any).from("service_master")
          .select("fee, item_type")
          .eq("hospital_id", hid).eq("doctor_id", user.id)
          .in("item_type", ["surgeon_fee", "anaesthesia_fee"]);
        otSurgeonRow = (otRows || []).find((r: any) => r.item_type === "surgeon_fee");
        otAnaesRow = (otRows || []).find((r: any) => r.item_type === "anaesthesia_fee");
      }
      setForm({
        full_name: user.full_name, phone: user.phone ?? "", email: user.email,
        role: user.role, department_id: user.department_id ?? "", registration_number: user.registration_number ?? "", ward_id: "",
        hpr_id: (user as any).hpr_id ?? "",
        employee_id: profile?.employee_id ?? "",
        employment_type: profile?.employment_type ?? "permanent",
        employee_type: profile?.employee_type ?? "staff",
        basic_salary: profile?.basic_salary?.toString() ?? "",
        hra_percent: profile?.hra_percent?.toString() ?? "20",
        da_percent: profile?.da_percent?.toString() ?? "10",
        conveyance: profile?.conveyance?.toString() ?? "1600",
        medical_allowance: profile?.medical_allowance?.toString() ?? "1250",
        pf_applicable: profile?.pf_applicable ?? true,
        esic_applicable: profile?.esic_applicable ?? false,
        uan_number: profile?.uan_number ?? "",
        pan_number: profile?.pan_number ?? "",
        esi_ip_number: profile?.esi_ip_number ?? "",
        license_expiry_date: profile?.license_expiry_date ?? "",
        consultation_fee: svcRow?.fee?.toString() ?? "",
        follow_up_fee: svcRow?.follow_up_fee?.toString() ?? "",
        validity_days: svcRow?.validity_days?.toString() ?? "7",
        emergency_fee: svcRow?.emergency_fee?.toString() ?? "",
        ipd_consultation_fee: svcRow?.ipd_consultation_fee?.toString() ?? "",
        ot_surgeon_fee: otSurgeonRow?.fee?.toString() ?? "",
        ot_anaesthetist_fee: otAnaesRow?.fee?.toString() ?? "",
      });
    } else {
      setEditingId(null);
      setForm({ ...EMPTY_FORM });
    }
    setHprResult(null);
    setHprError(null);
    setDrawerOpen(true);
  };

  const closeDrawer = () => { setDrawerOpen(false); setEditingId(null); setForm({ ...EMPTY_FORM }); setDrawerTab("profile"); setHprResult(null); setHprError(null); };

  const initials = (name: string) => name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

  const deptName = (id: string | null) => departments?.find((d) => d.id === id)?.name ?? "—";

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col overflow-hidden relative">
      {/* HEADER */}
      <div className="flex-shrink-0 px-6 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/settings")} className="text-muted-foreground hover:text-foreground active:scale-95">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-lg font-bold text-foreground">Doctors & Staff</h1>
            <p className="text-xs text-muted-foreground">Settings › Doctors & Staff</p>
          </div>
        </div>
        <button onClick={() => openDrawer()} className="flex items-center gap-1.5 bg-[hsl(222,55%,23%)] text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 active:scale-[0.97]">
          <Plus size={14} /> Add Staff Member
        </button>
      </div>

      {/* FILTER TABS */}
      <div className="flex-shrink-0 px-6 py-2.5 border-b border-border flex gap-1.5 overflow-x-auto">
        {FILTER_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={cn(
              "px-4 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors active:scale-[0.97]",
              filter === t.key ? "bg-[hsl(222,55%,23%)] text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* QUICK ADD DOCTORS BANNER */}
      {!isLoading && doctorCount === 0 && (
        <div className="flex-shrink-0 mx-6 mt-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-center justify-between">
          <p className="text-[13px] text-blue-800 font-medium">👨‍⚕️ No doctors added yet — OPD and IPD are blocked</p>
          <button onClick={() => { setBulkOpen(true); setBulkRows([{ ...EMPTY_BULK }, { ...EMPTY_BULK }, { ...EMPTY_BULK }]); }}
            className="text-sm font-medium text-blue-700 border border-blue-300 rounded-lg px-3 py-1.5 hover:bg-blue-100 active:scale-[0.97]">
            Quick Add Doctors
          </button>
        </div>
      )}

      {/* TABLE */}
      <div className="flex-1 overflow-y-auto">
        {!isLoading && filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
              <Users size={24} className="text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">No staff added yet</p>
            <p className="text-xs text-muted-foreground max-w-[240px]">Add your first doctor to start using clinical modules</p>
            <button onClick={() => openDrawer()} className="flex items-center gap-1.5 bg-[hsl(222,55%,23%)] text-white px-4 py-2 rounded-lg text-sm font-medium active:scale-[0.97]">
              <Plus size={14} /> Add First Doctor
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/50 backdrop-blur-sm z-10">
              <tr className="text-left text-[11px] text-muted-foreground uppercase tracking-wider">
                <th className="px-6 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Department</th>
                <th className="px-4 py-2.5 font-medium">Phone</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">Loading...</td></tr>}
              {filtered.map((u) => {
                const meta = ROLE_META[u.role] ?? ROLE_META.receptionist;
                return (
                  <tr key={u.id} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="px-6 py-2.5">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-[hsl(222,55%,23%)] text-white flex items-center justify-center text-[11px] font-semibold shrink-0">
                          {initials(u.full_name)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-[13px] font-medium text-foreground truncate">{u.full_name}</p>
                            {(u as any).hpr_verified_at && (
                              <span title="HPR Verified" className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium shrink-0">
                                <ShieldCheck size={9} /> HPR
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground truncate">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={cn("text-[11px] px-2 py-0.5 rounded-full border font-medium", meta.color)}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[13px] text-muted-foreground">{deptName(u.department_id)}</td>
                    <td className="px-4 py-2.5 text-[13px] text-muted-foreground">{u.phone || "—"}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className={cn("h-2 w-2 rounded-full", u.is_active ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                         <span className="text-[12px] text-muted-foreground">{u.is_active ? "Active" : "Inactive"}</span>
                         {u.can_login && <span className="text-[10px] text-emerald-600 ml-2">• Login enabled</span>}
                       </div>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                         <button onClick={() => openDrawer(u)} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted">Edit</button>
                         <button
                           onClick={() => toggleActive.mutate({ id: u.id, active: u.is_active })}
                           className="text-xs text-muted-foreground hover:text-destructive px-2 py-1 rounded hover:bg-muted"
                         >
                           {u.is_active ? "Deactivate" : "Activate"}
                         </button>
                         {!(u as any).auth_user_id && u.is_active && (
                           <button
                             onClick={() => {
                               setLoginModal({ open: true, userId: u.id, userName: u.full_name, email: u.email });
                                setLoginEmail(u.email?.includes("@placeholder.local") ? "" : u.email);
                                setLoginPassword("");
                             }}
                             className="text-xs text-primary hover:text-primary/80 px-2 py-1 rounded hover:bg-primary/10 font-medium"
                           >
                             Enable Login
                           </button>
                         )}
                         {(u as any).auth_user_id && (
                           <>
                             <span className="text-[11px] text-emerald-600 px-2 py-1 font-medium">✓ Can Login</span>
                             {/* MFA enable/disable toggle */}
                             <button
                               onClick={() => handleToggleMfa(u.id, (u as any).auth_user_id, u.full_name, !!(u as any).mfa_required)}
                               title={(u as any).mfa_required ? "MFA on — click to disable" : "MFA off — click to enable"}
                               className={cn(
                                 "text-[11px] px-2 py-1 rounded font-medium border transition-colors",
                                 (u as any).mfa_required
                                   ? "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
                                   : "text-muted-foreground border-border hover:bg-muted"
                               )}
                             >
                               {(u as any).mfa_required ? "🔒 MFA On" : "MFA Off"}
                             </button>
                             {/* Reset MFA — only shown when MFA is on and user has a login */}
                             {(u as any).mfa_required && (
                               <button
                                 onClick={() => handleResetMfa((u as any).auth_user_id, u.full_name)}
                                 disabled={resettingMfaId === (u as any).auth_user_id}
                                 title="Reset authenticator — use if staff lost their device"
                                 className="text-[11px] text-amber-600 hover:text-amber-700 px-2 py-1 rounded hover:bg-amber-50 font-medium disabled:opacity-40"
                               >
                                 {resettingMfaId === (u as any).auth_user_id ? "Resetting…" : "Reset Auth"}
                               </button>
                             )}
                           </>
                         )}
                       </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ─── SLIDE-OVER DRAWER ─── */}
      {drawerOpen && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={closeDrawer} />
          <div className={cn(
            "fixed right-0 top-0 bottom-0 w-full bg-card border-l border-border z-50 flex flex-col shadow-xl animate-in slide-in-from-right duration-200",
            editingId && (drawerTab === "privileges" || drawerTab === "access") ? "sm:w-[560px]" : "sm:w-[420px]"
          )}>
            <div className="flex-shrink-0 px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-bold text-foreground">
                {editingId ? (form.full_name || "Edit Staff Member") : "Add Staff Member"}
              </h2>
              <button onClick={closeDrawer} className="text-muted-foreground hover:text-foreground active:scale-95"><X size={18} /></button>
            </div>

            {editingId && (
              <div className="flex-shrink-0 flex border-b border-border">
                {([
                  { id: "profile" as const, label: "Profile" },
                  { id: "access" as const, label: "Access" },
                  { id: "privileges" as const, label: "Privileges" },
                ] as const).map(t => (
                  <button
                    key={t.id}
                    onClick={() => setDrawerTab(t.id)}
                    className={cn(
                      "flex-1 py-2.5 text-sm font-medium transition-colors border-b-2",
                      drawerTab === t.id
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}

            {editingId && drawerTab === "privileges" ? (
              <div className="flex-1 overflow-hidden min-h-0">
                <StaffPrivilegesPanel userId={editingId} staffName={form.full_name} />
              </div>
            ) : editingId && drawerTab === "access" ? (
              <div className="flex-1 overflow-hidden min-h-0">
                <StaffAccessPanel userId={editingId} role={form.role} staffName={form.full_name} />
              </div>
            ) : (
            <>
            <div className="flex-1 overflow-y-auto min-h-0 px-6 py-5 space-y-5">
              {/* Role selection */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-2 block uppercase tracking-wide">Role *</label>
                <div className="grid grid-cols-2 gap-2">
                  {ROLE_CARDS.map((rc) => {
                    const Icon = rc.icon;
                    const selected = form.role === rc.role;
                    return (
                      <button
                        key={rc.role}
                        onClick={() => setForm({ ...form, role: rc.role, department_id: "", ward_id: "", registration_number: "" })}
                        className={cn(
                          "flex items-center gap-2.5 px-3 py-2.5 rounded-lg border-[1.5px] text-left transition-colors active:scale-[0.98]",
                          selected
                            ? "border-[hsl(222,55%,23%)] bg-blue-50"
                            : "border-border hover:border-muted-foreground/30"
                        )}
                      >
                        <Icon size={16} className={selected ? "text-[hsl(222,55%,23%)]" : "text-muted-foreground"} />
                        <span className={cn("text-[13px] font-medium", selected ? "text-[hsl(222,55%,23%)]" : "text-foreground")}>{rc.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Basic details */}
              <div className="space-y-3">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Basic Details</label>
                <div>
                  <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Full Name *</label>
                  <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Dr. Priya Sharma" className="h-10" />
                </div>
                <div>
                  <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Phone Number *</label>
                  <Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="9876543210" className="h-10" />
                </div>
                <div>
                  <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Email Address <span className="text-muted-foreground/60">(required for login)</span></label>
                  <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="priya@hospital.com" className="h-10" />
                  {!form.email && !editingId && (
                    <p className="text-[11px] text-amber-600 mt-1">No email — this staff member will not be able to log in. Add email to enable login later.</p>
                  )}
                </div>
              </div>

              {/* Department — shown for all roles */}
              <div className="space-y-3">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {form.role === "doctor" ? "Doctor Details" : "Assignment"}
                </label>
                <div>
                  <label className="text-[14px] font-medium text-muted-foreground mb-1 block">
                    {form.role === "doctor" ? "Department *" : "Assigned Department"} {form.role !== "doctor" && <span className="text-muted-foreground/60">(optional)</span>}
                  </label>
                  <select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                    <option value="">Select department</option>
                    {departments?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                {form.role === "doctor" && (
                  <>
                    <div>
                      <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Registration No (MCI/NMC)</label>
                      <Input value={form.registration_number} onChange={(e) => setForm({ ...form, registration_number: e.target.value })} placeholder="MH-12345" className="h-10" />
                    </div>
                    <div>
                      <label className="text-[14px] font-medium text-muted-foreground mb-1 block">HPR ID (Healthcare Professionals Registry)</label>
                      <div className="flex gap-2">
                        <Input value={form.hpr_id} onChange={(e) => { setForm({ ...form, hpr_id: e.target.value }); setHprResult(null); setHprError(null); }} placeholder="e.g. 12345678901234" className="h-10 flex-1" />
                        <button
                          type="button"
                          disabled={hprVerifying || !form.hpr_id?.trim()}
                          className="inline-flex items-center gap-1.5 h-10 px-3 rounded-md border border-input bg-background text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={async () => {
                            if (!form.hpr_id?.trim()) return;
                            setHprVerifying(true); setHprResult(null); setHprError(null);
                            const { data, error } = await supabase.functions.invoke("abdm-hpr-verify", {
                              body: { hpr_id: form.hpr_id.trim(), hospital_id: hospitalId ?? undefined, user_id: editingId ?? undefined },
                            });
                            setHprVerifying(false);
                            if (error || !data?.success) { setHprError(data?.error ?? error?.message ?? "Verification failed"); return; }
                            setHprResult(data.doctor);
                            if (editingId) qc.invalidateQueries({ queryKey: ["settings-staff"] });
                          }}
                        >
                          <ShieldCheck className="h-4 w-4 text-blue-600" />
                          {hprVerifying ? "Verifying…" : "Verify HPR"}
                        </button>
                      </div>
                      {hprResult && (
                        <div className="mt-1.5 flex items-start gap-1.5 text-[12px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2.5 py-1.5">
                          <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span><strong>HPR Verified:</strong> {hprResult.name}{hprResult.speciality ? ` · ${hprResult.speciality}` : ""}{hprResult.qualification ? ` · ${hprResult.qualification}` : ""}</span>
                        </div>
                      )}
                      {hprError && (
                        <p className="mt-1 text-[12px] text-red-600">{hprError}</p>
                      )}
                      {!hprResult && !hprError && editingId && (users?.find(u => u.id === editingId) as any)?.hpr_verified_at && (
                        <p className="text-[11px] text-emerald-600 mt-1">Verified on {new Date((users?.find(u => u.id === editingId) as any).hpr_verified_at).toLocaleDateString()}</p>
                      )}
                      <p className="text-[11px] text-muted-foreground mt-1">Issued by the National Health Authority HPR registry.</p>
                    </div>
                  </>
                )}
              </div>

              {form.role === "nurse" && (
                <div className="space-y-3">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Nurse Details</label>
                  <div>
                    <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Ward Assignment <span className="text-muted-foreground/60">(display only)</span></label>
                    <select value={form.ward_id} onChange={(e) => setForm({ ...form, ward_id: e.target.value })}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                      <option value="">Select ward</option>
                      {wards?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Nursing Registration No</label>
                    <Input value={form.registration_number} onChange={(e) => setForm({ ...form, registration_number: e.target.value })} placeholder="Optional" className="h-10" />
                  </div>
                </div>
              )}

              {/* Consultation Pricing — doctor only */}
              {form.role === "doctor" && (
                <div className="space-y-3">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Consultation Pricing</label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Consultation Fee (₹)</label>
                      <Input type="number" value={form.consultation_fee} onChange={(e) => setForm({ ...form, consultation_fee: e.target.value })} placeholder="500" className="h-10" />
                    </div>
                    <div>
                      <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Follow-up Fee (₹)</label>
                      <Input type="number" value={form.follow_up_fee} onChange={(e) => setForm({ ...form, follow_up_fee: e.target.value })} placeholder="200" className="h-10" />
                    </div>
                    <div>
                      <label className="text-[14px] font-medium text-muted-foreground mb-1 block">IPD Consultation Fee (₹)</label>
                      <Input type="number" value={form.ipd_consultation_fee} onChange={(e) => setForm({ ...form, ipd_consultation_fee: e.target.value })} placeholder="800" className="h-10" />
                      <p className="text-[10px] text-muted-foreground mt-0.5">Charged for IPD ward rounds (optional)</p>
                    </div>
                    <div>
                      <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Validity (days)</label>
                      <Input type="number" value={form.validity_days} onChange={(e) => setForm({ ...form, validity_days: e.target.value })} placeholder="7" className="h-10" />
                      <p className="text-[10px] text-muted-foreground mt-0.5">Follow-up valid within these many days</p>
                    </div>
                    <div>
                      <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Emergency Fee (₹)</label>
                      <Input type="number" value={form.emergency_fee} onChange={(e) => setForm({ ...form, emergency_fee: e.target.value })} placeholder="1500" className="h-10" />
                      <p className="text-[10px] text-muted-foreground mt-0.5">Charged for emergency visits (optional)</p>
                    </div>
                  </div>
                </div>
              )}

              {/* OT Fees — doctor only, optional per-doctor contract rate */}
              {form.role === "doctor" && (
                <div className="space-y-3">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">OT Fees</label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Surgeon Fee (₹)</label>
                      <Input type="number" value={form.ot_surgeon_fee} onChange={(e) => setForm({ ...form, ot_surgeon_fee: e.target.value })} placeholder="Hospital default" className="h-10" />
                      <p className="text-[10px] text-muted-foreground mt-0.5">Overrides the hospital-wide OT surgeon fee when this doctor operates</p>
                    </div>
                    <div>
                      <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Anaesthetist Fee (₹)</label>
                      <Input type="number" value={form.ot_anaesthetist_fee} onChange={(e) => setForm({ ...form, ot_anaesthetist_fee: e.target.value })} placeholder="Hospital default" className="h-10" />
                      <p className="text-[10px] text-muted-foreground mt-0.5">Overrides the hospital-wide OT anaesthesia fee when this doctor administers</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Employment & Salary</label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Employee ID</label>
                    <Input value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} placeholder="EMP-001" className="h-10" />
                  </div>
                  <div>
                    <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Employment Type</label>
                    <select value={form.employment_type} onChange={(e) => setForm({ ...form, employment_type: e.target.value })}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                      <option value="permanent">Permanent</option>
                      <option value="contract">Contract</option>
                      <option value="visiting">Visiting</option>
                      <option value="intern">Intern</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Payroll Type</label>
                    <select value={form.employee_type} onChange={(e) => setForm({ ...form, employee_type: e.target.value })}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                      <option value="staff">Salaried Staff (Form 16 / TDS 192)</option>
                      <option value="consultant">Consultant (Form 16A / TDS 194J)</option>
                      <option value="trainee">Trainee / Stipend</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Basic Salary (₹/month)</label>
                  <Input type="number" value={form.basic_salary} onChange={(e) => setForm({ ...form, basic_salary: e.target.value })} placeholder="25000" className="h-10" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[14px] font-medium text-muted-foreground mb-1 block">HRA %</label>
                    <Input type="number" value={form.hra_percent} onChange={(e) => setForm({ ...form, hra_percent: e.target.value })} className="h-10" />
                  </div>
                  <div>
                    <label className="text-[14px] font-medium text-muted-foreground mb-1 block">DA %</label>
                    <Input type="number" value={form.da_percent} onChange={(e) => setForm({ ...form, da_percent: e.target.value })} className="h-10" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Conveyance (₹)</label>
                    <Input type="number" value={form.conveyance} onChange={(e) => setForm({ ...form, conveyance: e.target.value })} className="h-10" />
                  </div>
                  <div>
                    <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Medical Allow. (₹)</label>
                    <Input type="number" value={form.medical_allowance} onChange={(e) => setForm({ ...form, medical_allowance: e.target.value })} className="h-10" />
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 text-[13px] text-foreground cursor-pointer">
                    <input type="checkbox" checked={form.pf_applicable} onChange={(e) => setForm({ ...form, pf_applicable: e.target.checked })} className="rounded border-input" />
                    PF Applicable
                  </label>
                  <label className="flex items-center gap-2 text-[13px] text-foreground cursor-pointer">
                    <input type="checkbox" checked={form.esic_applicable} onChange={(e) => setForm({ ...form, esic_applicable: e.target.checked })} className="rounded border-input" />
                    ESIC Applicable
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[14px] font-medium text-muted-foreground mb-1 block">UAN (EPF)</label>
                    <Input value={form.uan_number} onChange={(e) => setForm({ ...form, uan_number: e.target.value })} placeholder="12-digit UAN" className="h-10" maxLength={12} />
                  </div>
                  <div>
                    <label className="text-[14px] font-medium text-muted-foreground mb-1 block">PAN</label>
                    <Input value={form.pan_number} onChange={(e) => setForm({ ...form, pan_number: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" className="h-10" maxLength={10} />
                  </div>
                  <div>
                    <label className="text-[14px] font-medium text-muted-foreground mb-1 block">ESI IP No.</label>
                    <Input value={form.esi_ip_number} onChange={(e) => setForm({ ...form, esi_ip_number: e.target.value })} placeholder="ESI IP number" className="h-10" />
                  </div>
                </div>
                <div>
                  <label className="text-[14px] font-medium text-muted-foreground mb-1 block">License Expiry Date</label>
                  <Input type="date" value={form.license_expiry_date} onChange={(e) => setForm({ ...form, license_expiry_date: e.target.value })} className="h-10" />
                  <p className="text-[11px] text-muted-foreground mt-1">For multiple credentials with individual expiries, use HR → Credentials (the system of record); this single field also feeds the expiry alerts.</p>
                  {form.license_expiry_date && (() => {
                    const daysLeft = Math.ceil((new Date(form.license_expiry_date).getTime() - Date.now()) / 86400000);
                    if (daysLeft <= 60) return <p className={`text-[11px] mt-1 ${daysLeft <= 0 ? "text-destructive" : "text-amber-600"}`}>{daysLeft <= 0 ? "⚠ License EXPIRED" : `⚠ Expires in ${daysLeft} days`}</p>;
                    return null;
                  })()}
                </div>
                <div>
                  <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Credential Document <span className="text-muted-foreground/60">(PDF/Image)</span></label>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file || !editingId) return;
                      if (file.size > 5 * 1024 * 1024) { alert("File too large (max 5MB)"); return; }
                      const { data: { user } } = await supabase.auth.getUser();
                      const path = `credentials/${editingId}/${file.name}`;
                      const { error: uploadErr } = await supabase.storage.from("hospital-assets").upload(path, file, { upsert: true });
                      if (uploadErr) { alert("Upload failed: " + uploadErr.message); return; }
                      const { data: urlData } = supabase.storage.from("hospital-assets").getPublicUrl(path);
                      await supabase.from("users").update({ credential_doc_url: urlData.publicUrl } as any).eq("id", editingId);
                      alert("Document uploaded successfully");
                    }}
                    className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
                  />
                  {!editingId && <p className="text-[11px] text-muted-foreground mt-1">Save staff first, then upload credential document</p>}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 px-6 py-4 border-t border-border flex gap-3 pb-[env(safe-area-inset-bottom,16px)]">
              <button onClick={closeDrawer} className="flex-1 h-12 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted active:scale-[0.98]">
                Cancel
              </button>
              <button
                onClick={() => saveStaff.mutate()}
                disabled={!form.full_name || (!form.phone && !form.email) || saveStaff.isPending}
                className="flex-[2] h-12 rounded-lg bg-[hsl(222,55%,23%)] text-white text-sm font-semibold hover:opacity-90 active:scale-[0.97] disabled:opacity-40"
              >
                {saveStaff.isPending ? "Saving..." : editingId ? "Update Staff Member" : "Save Staff Member"}
              </button>
            </div>
            </>
            )}
          </div>
        </>
      )}

      {/* ─── BULK ADD DOCTORS MODAL ─── */}
      {bulkOpen && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40 flex items-center justify-center" onClick={() => setBulkOpen(false)}>
            <div className="bg-card rounded-xl border border-border shadow-xl w-full max-w-[700px] max-h-[calc(100vh-100px)] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex-shrink-0 px-6 py-4 border-b border-border flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-foreground">Quick Add Doctors</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Add multiple doctors at once</p>
                </div>
                <button onClick={() => setBulkOpen(false)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
                <div className="grid grid-cols-[2fr_1.5fr_1fr_1.5fr_1fr_28px] gap-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide px-1">
                  <span>Full Name</span><span>Speciality</span><span>Phone</span><span>Department</span><span>Fee (₹)</span><span />
                </div>
                {bulkRows.map((row, i) => (
                  <div key={i} className="grid grid-cols-[2fr_1.5fr_1fr_1.5fr_1fr_28px] gap-2 items-center">
                    <Input value={row.name} onChange={(e) => {
                      const r = [...bulkRows]; r[i] = { ...r[i], name: e.target.value }; setBulkRows(r);
                    }} placeholder="Dr. Example" className="h-9" />
                    <Input value={row.speciality} onChange={(e) => {
                      const r = [...bulkRows]; r[i] = { ...r[i], speciality: e.target.value }; setBulkRows(r);
                    }} placeholder="General Medicine" className="h-9" />
                    <Input value={row.phone} onChange={(e) => {
                      const r = [...bulkRows]; r[i] = { ...r[i], phone: e.target.value }; setBulkRows(r);
                    }} placeholder="9876543210" className="h-9" />
                    <select value={row.dept_id} onChange={(e) => {
                      const r = [...bulkRows]; r[i] = { ...r[i], dept_id: e.target.value }; setBulkRows(r);
                    }} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                      <option value="">Dept</option>
                      {departments?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                    <Input type="number" value={row.fee} onChange={(e) => {
                      const r = [...bulkRows]; r[i] = { ...r[i], fee: e.target.value }; setBulkRows(r);
                    }} placeholder="500" className="h-9" />
                    <button onClick={() => setBulkRows((r) => r.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                {bulkRows.length < 10 && (
                  <button onClick={() => setBulkRows((r) => [...r, { ...EMPTY_BULK }])} className="flex items-center gap-1.5 text-sm text-primary font-medium hover:underline mt-1">
                    <Plus size={14} /> Add Another Doctor
                  </button>
                )}
              </div>

              <div className="flex-shrink-0 px-6 py-4 border-t border-border">
                <button
                  onClick={() => bulkSave.mutate()}
                  disabled={!bulkRows.some((r) => r.name.trim()) || bulkSave.isPending}
                  className="w-full h-11 rounded-lg bg-[hsl(222,55%,23%)] text-white text-sm font-semibold hover:opacity-90 active:scale-[0.97] disabled:opacity-40"
                >
                  {bulkSave.isPending ? "Saving..." : `Save All Doctors (${bulkRows.filter((r) => r.name.trim()).length})`}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ─── LOGIN CREDENTIALS MODAL ─── */}
      {loginModal && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => { setLoginModal(null); setLoginPassword(""); setLoginEmail(""); }} />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-card rounded-xl border border-border shadow-xl w-full max-w-[420px] p-6">
            <h2 className="text-lg font-bold text-foreground mb-1">Create Login Credentials</h2>
            <p className="text-sm text-muted-foreground mb-5">
              {loginModal.userName} will be able to sign in at the login page with these credentials.
            </p>

            <div className="space-y-4">
              <div>
                <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Email</label>
                <Input
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="staff@hospital.com"
                  className="h-10"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  {loginModal.email?.includes("@placeholder.local")
                    ? "Enter the staff member's real email address for login"
                    : "Must be a valid, unique email address"}
                </p>
              </div>
              <div>
                <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Password</label>
                <Input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className="h-10"
                />
                {loginPassword.length > 0 && loginPassword.length < 8 && (
                  <p className="text-[11px] text-destructive mt-1">Password must be at least 8 characters</p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={() => { setLoginModal(null); setLoginPassword(""); setLoginEmail(""); }}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateLogin}
                disabled={creatingLogin || !loginEmail || loginPassword.length < 8}
                className="px-5 py-2 rounded-lg bg-[hsl(222,55%,23%)] text-white text-sm font-semibold hover:opacity-90 active:scale-[0.97] disabled:opacity-40"
              >
                {creatingLogin ? "Creating..." : "Create Login"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default SettingsStaffPage;
