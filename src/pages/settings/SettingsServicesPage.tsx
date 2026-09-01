import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { getWardNursingRates, setWardNursingRate } from "@/lib/wardNursingRate";
import { ArrowLeft, Plus, X, Receipt, ListPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import BulkPasteAddModal from "@/components/settings/BulkPasteAddModal";
import { resolveServiceGstPercent, getDefaultGSTRate } from "@/lib/gstRules";

const TABS = [
  { key: "consultation", label: "OPD Consultation" },
  { key: "procedure", label: "Procedures" },
  { key: "package", label: "Packages" },
  { key: "lab", label: "Lab Tests" },
  { key: "radiology", label: "Radiology" },
  { key: "ot", label: "OT & Surgery" },
  { key: "ipd_beds", label: "IPD Beds & Wards" },
  { key: "emergency", label: "Emergency" },
  { key: "specialized", label: "Specialized Services" },
  // Catch-all for every category without a tab of its own. Previously keyed strictly
  // to category='other', which left anything else the drawer could save rendering on
  // no tab at all — invisible and uneditable despite being billable.
  { key: "other", label: "Other" },
  { key: "day_care", label: "Day Care" },
  { key: "all", label: "All Services" },
  { key: "rates", label: "Default Rates" },
];

// Tabs that render their own table from a module-owned source table rather than the
// generic service_master list, so the "Add Service" drawer does not apply to them.
const NON_CATALOG_TABS = ["ot", "ipd_beds", "emergency", "specialized", "lab", "radiology", "package", "day_care", "all"];

// Categories already surfaced by a tab of their own THAT RENDERS MANUAL SERVICE_MASTER ROWS.
// Everything else falls to the "Other" catch-all — that fallback is what keeps a newly-added 
// category from silently disappearing. 'ot' and 'emergency' are here because upsertFixedCharge 
// writes those rows with source_table NULL (they are hospital-authored, not mirrored), so without
// them listed the OT and Emergency charges would appear twice.
// 
// Removed 'package', 'lab', 'radiology' because their tabs render from module tables, not manual service_master rows.
const DEDICATED_TAB_CATEGORIES = [
  "consultation", "procedure", "ot", "emergency",
];

/**
 * The categories a service can be filed under — the full vocabulary GST_RATE_RULES
 * models, so every option resolves to a defensible statutory rate instead of falling
 * through to the 18% 'service' default. `category` is written to item_type verbatim
 * on save, which is what makes the GST come out right.
 *
 * Deliberately omitted: 'service' (the legacy 18% trap this list exists to avoid) and
 * room_charge_luxury / room_charge_icu, which are derived from a ward's bed category
 * and rate by ward_catalog_item_type — not something to pick by hand.
 */
const SERVICE_CATEGORIES: { value: string; label: string }[] = [
  { value: "consultation", label: "Consultation" },
  { value: "procedure",    label: "Procedure" },
  { value: "surgery",      label: "Surgery" },
  { value: "package",      label: "Package" },
  { value: "lab",          label: "Lab" },
  { value: "radiology",    label: "Radiology" },
  { value: "nursing",      label: "Nursing" },
  { value: "blood",        label: "Blood / Component" },
  { value: "ambulance",    label: "Ambulance" },
  { value: "room_charge",  label: "Room / Bed Charge" },
  { value: "oxygen",       label: "Medical Oxygen" },
  { value: "pharmacy",     label: "Pharmacy / Drugs" },
  { value: "consumable",   label: "Consumable" },
  { value: "cafeteria",    label: "Cafeteria / Food" },
  { value: "cosmetic",     label: "Cosmetic (non-therapeutic)" },
  { value: "parking",      label: "Parking" },
  { value: "other",        label: "Other" },
];

// Where each mirrored row actually comes from, so All Services can point the user at
// the tab that owns the price instead of letting them edit a mirror the sync trigger
// (20261008000136 / …139) will overwrite on the next source edit.
const MIRROR_SOURCE_LABELS: Record<string, { label: string; tab: string }> = {
  lab_test_master:        { label: "Lab Test Master",   tab: "lab" },
  lab_test_groups:        { label: "Lab Panels",        tab: "lab" },
  radiology_study_master: { label: "Radiology",         tab: "radiology" },
  health_packages:        { label: "Health Packages",   tab: "package" },
  wards:                  { label: "Wards & Beds",      tab: "ipd_beds" },
  service_rates:          { label: "Specialized",       tab: "specialized" },
  day_care_procedures:    { label: "Day Care",          tab: "day_care" },
};

// Specialized clinical modules — one configurable default rate each, stored in
// service_rates by item_code. Codes match MODULE_RATE_CODE in src/lib/serviceRates.ts
// so the configured rate flows into each module's billing (autoChargeService / postCharge).
const SPECIALIZED_SERVICES = [
  { item_code: "dialysis_session",       item_name: "Dialysis Session",            default_rate: 2500 },
  { item_code: "physiotherapy_session",  item_name: "Physiotherapy Session",       default_rate: 400 },
  { item_code: "ambulance_trip",         item_name: "Ambulance Trip",              default_rate: 1500 },
  { item_code: "home_care_visit",        item_name: "Home Care Visit",             default_rate: 800 },
  { item_code: "mental_health_session",  item_name: "Mental Health Session",       default_rate: 1000 },
  { item_code: "mortuary_charge",        item_name: "Mortuary (per day)",          default_rate: 500 },
  { item_code: "dietetics_consult",      item_name: "Dietitian Consultation",      default_rate: 300 },
  { item_code: "ayush_consult",          item_name: "AYUSH Consultation",          default_rate: 400 },
  { item_code: "chemo_per_mg",           item_name: "Chemotherapy (per mg)",       default_rate: 50 },
  { item_code: "blood_unit",             item_name: "Blood Unit / Component",      default_rate: 1500 },
  { item_code: "vaccination_admin",      item_name: "Vaccination Admin Fee",       default_rate: 100 },
  { item_code: "dental_consult",         item_name: "Dental Consultation",         default_rate: 300 },
  { item_code: "ivf_cycle",              item_name: "IVF Cycle (base)",            default_rate: 20000 },
  { item_code: "chronic_care_review",    item_name: "Chronic Care Review",         default_rate: 300 },
];

// OT charge types managed from this page. item_type matches what OTBillingTab reads
// (src/components/ot/tabs/OTBillingTab.tsx) so configured rates flow into OT bills.
const OT_CHARGE_TYPES = [
  { item_type: "ot_charge", label: "OT Facility (per hour)", fallback: 2000 },
  { item_type: "surgeon_fee", label: "Surgeon Fee", fallback: 5000 },
  { item_type: "anaesthesia_fee", label: "Anaesthesia Fee", fallback: 1500 },
];

// Emergency charge. item_type matches getEdChargeRate() so the casualty fee flows
// into ED / IPD bills from the Emergency workspace. ed_observation / ed_specialist_consult
// are read by getEdItemRate() for the itemized ED charges panel (quick-charge shortcuts).
const ED_CHARGE_TYPES = [
  { item_type: "ed_consultation", label: "Casualty / Emergency Fee", fallback: 300 },
  { item_type: "ed_observation", label: "Observation / ED Bed (per hour)", fallback: 200 },
  { item_type: "ed_specialist_consult", label: "Specialist Consult (in ED)", fallback: 500 },
];

// Common item codes used by modules (OT, Dialysis, IPD, etc.) for fallback billing rates.
const DEFAULT_RATE_SEEDS: { item_code: string; item_name: string; item_type: string; default_rate: number }[] = [
  { item_code: "registration_fee", item_name: "Registration Fee",     item_type: "registration", default_rate: 0 },
  { item_code: "consultation",     item_name: "OPD Consultation",     item_type: "consultation", default_rate: 500 },
  { item_code: "anaesthesia_fee",  item_name: "Anaesthesia Fee",      item_type: "procedure",    default_rate: 1500 },
  { item_code: "surgery_fee",      item_name: "Surgery / Surgeon Fee", item_type: "procedure",   default_rate: 5000 },
  { item_code: "dialysis_session", item_name: "Dialysis Session",     item_type: "procedure",    default_rate: 2500 },
  { item_code: "icu_per_day",      item_name: "ICU Bed (per day)",    item_type: "ward",         default_rate: 5000 },
  { item_code: "ward_per_day",     item_name: "General Ward (per day)", item_type: "ward",       default_rate: 1500 },
];

const DEFAULT_PROCEDURES = [
  { name: "ECG", category: "procedure", fee: 150 },
  { name: "X-Ray Chest (PA View)", category: "radiology", fee: 200 },
  { name: "USG Abdomen", category: "radiology", fee: 500 },
  { name: "IV Cannula Insertion", category: "procedure", fee: 150 },
  { name: "Dressing (Simple)", category: "procedure", fee: 100 },
  { name: "Dressing (Complex)", category: "procedure", fee: 250 },
  { name: "Nebulization", category: "procedure", fee: 100 },
  { name: "Injection Administration", category: "procedure", fee: 50 },
  { name: "Blood Collection (Phlebotomy)", category: "procedure", fee: 50 },
  { name: "Urine Catheter Insertion", category: "procedure", fee: 300 },
  { name: "Ryles Tube Insertion", category: "procedure", fee: 250 },
  { name: "Blood Transfusion", category: "procedure", fee: 500 },
  { name: "Oxygen Administration (per day)", category: "procedure", fee: 200 },
  { name: "Ventilator (per day)", category: "procedure", fee: 2000 },
  { name: "Monitor Charges (per day)", category: "procedure", fee: 500 },
];

const SettingsServicesPage: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("consultation");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", category: "consultation", fee: "", follow_up_fee: "", gst_applicable: false, gst_percent: "0" });
  const [bulkOpen, setBulkOpen] = useState(false);

  // Rates by Payer drawer
  const [payerRatesOpen, setPayerRatesOpen] = useState(false);
  const [payerRatesService, setPayerRatesService] = useState<{ id: string; name: string; category: string } | null>(null);
  const [payerRatesData, setPayerRatesData] = useState<Record<string, { rate: string; gst: string; from: string; to: string; rateId?: string }>>({});
  const [payerRatesSaving, setPayerRatesSaving] = useState(false);

  const PAYER_TYPES_FOR_RATES = [
    { value: "corporate", label: "Corporate" },
    { value: "tpa", label: "TPA / Insurance" },
    { value: "pmjay", label: "PMJAY / Ayushman" },
    { value: "cghs", label: "CGHS" },
    { value: "esi", label: "ESI" },
    { value: "state_scheme", label: "State Scheme" },
    { value: "credit", label: "Credit / Deferred" },
    { value: "other", label: "Other" },
  ];

  // Bulk fee
  const [bulkFee, setBulkFee] = useState("");

  // All Services tab search
  const [allSearch, setAllSearch] = useState("");

  const { data: services, isLoading } = useQuery({
    queryKey: ["settings-services"],
    queryFn: async () => {
      // Mirrors the Billing line-item picker's own query (LineItemsTab), so the
      // All Services tab shows exactly the catalog billing can find — including
      // item_type / source_table, which drive the effective-GST column.
      const { data, error } = await supabase.from("service_master")
        .select("id, name, category, item_type, fee, follow_up_fee, is_active, gst_applicable, gst_percent, source_table")
        .eq("is_active", true)
        .order("category").order("name");
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; name: string; category: string; item_type: string | null;
        fee: number; follow_up_fee: number | null; is_active: boolean;
        gst_applicable: boolean; gst_percent: number | null; source_table: string | null;
      }>;
    },
  });

  // Day Care procedures — standard_rate is what day-care billing charges.
  // Same shape as SettingsDayCareProceduresPage, which owns add/edit.
  const { data: dayCareProcedures } = useQuery({
    queryKey: ["settings-day-care-fees"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("day_care_procedures")
        .select("id, procedure_name, procedure_code, specialty, standard_rate, is_active")
        .eq("is_active", true).order("procedure_name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; procedure_name: string; procedure_code: string | null; specialty: string | null; standard_rate: number | null; is_active: boolean }>;
    },
  });

  const { data: departments } = useQuery({
    queryKey: ["settings-dept-for-services"],
    queryFn: async () => {
      const { data } = await supabase.from("departments").select("id, name").eq("is_active", true).order("name");
      return data ?? [];
    },
  });

  const { data: serviceRates } = useQuery({
    queryKey: ["settings-service-rates"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("service_rates")
        .select("id, item_code, item_name, item_type, default_rate, gst_rate, is_active")
        .order("item_code");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; item_code: string; item_name: string; item_type: string; default_rate: number; gst_rate: number; is_active: boolean }>;
    },
  });

  // OT & Surgery charges — read by item_type (matches OTBillingTab lookups).
  const { data: otCharges } = useQuery({
    queryKey: ["settings-ot-charges"],
    queryFn: async () => {
      const { data, error } = await supabase.from("service_master")
        .select("id, item_type, name, fee, gst_applicable, gst_percent")
        .in("item_type", OT_CHARGE_TYPES.map((t) => t.item_type));
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; item_type: string; name: string; fee: number; gst_applicable: boolean; gst_percent: number }>;
    },
  });

  // Emergency charge — read by item_type (matches getEdChargeRate in serviceBilling.ts).
  const { data: edCharges } = useQuery({
    queryKey: ["settings-ed-charges"],
    queryFn: async () => {
      const { data, error } = await supabase.from("service_master")
        .select("id, item_type, name, fee, gst_applicable, gst_percent")
        .in("item_type", ED_CHARGE_TYPES.map((t) => t.item_type));
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; item_type: string; name: string; fee: number; gst_applicable: boolean; gst_percent: number }>;
    },
  });

  // IPD Beds & Wards — ward.rate_per_day is the source of truth for bed-day billing.
  const { data: wardRates } = useQuery({
    queryKey: ["settings-ward-rates"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("wards")
        .select("id, name, type, rate_per_day, is_active").order("name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; type: string; rate_per_day: number | null; is_active: boolean }>;
    },
  });

  // Separate query on purpose — naming nursing_rate_per_day in the select above would take
  // the whole ward tariff table down on a database without migration 20261011000091.
  const { data: wardNursingRates } = useQuery({
    queryKey: ["settings-ward-nursing-rates"],
    queryFn: getWardNursingRates,
  });

  // Lab Tests — canonical fee lives in lab_test_master (read by billing). Edited here directly.
  const { data: labTests } = useQuery({
    queryKey: ["settings-lab-tests-fees"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("lab_test_master")
        .select("id, test_name, test_code, category, fee, is_active").eq("is_active", true).order("test_name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; test_name: string; test_code: string | null; category: string | null; fee: number | null; is_active: boolean }>;
    },
  });

  const { data: labGroups } = useQuery({
    queryKey: ["settings-lab-groups-fees"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("lab_test_groups")
        .select("id, group_name, group_code, fee, is_active").eq("is_active", true).order("group_name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; group_name: string; group_code: string | null; fee: number | null; is_active: boolean }>;
    },
  });

  // Radiology — canonical fee lives in radiology_study_master (read by billing).
  const { data: radiologyStudies } = useQuery({
    queryKey: ["settings-radiology-fees"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("radiology_study_master")
        .select("id, study_name, modality_type, fee, is_active").eq("is_active", true).order("modality_type").order("study_name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; study_name: string; modality_type: string | null; fee: number | null; is_active: boolean }>;
    },
  });

  // Health Packages — canonical price lives in health_packages (read by BookPackageModal).
  const { data: healthPackages } = useQuery({
    queryKey: ["settings-health-packages-fees"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("health_packages")
        .select("id, package_name, package_code, price, is_active").order("package_name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; package_name: string; package_code: string | null; price: number | null; is_active: boolean }>;
    },
  });

  const getHospitalId = async () => {
    const { data } = await supabase.from("users").select("hospital_id").limit(1).maybeSingle();
    if (!data) throw new Error("No hospital context");
    return data.hospital_id;
  };

  // Upsert a fixed charge by item_type (find-or-create one row per type per hospital).
  const upsertFixedCharge = async (opts: {
    itemType: string; label: string; category: string; invalidateKey: string;
    rows: Array<{ id: string; item_type: string }> | undefined;
    patch: { fee?: number; gst_applicable?: boolean; gst_percent?: number };
  }) => {
    const hid = await getHospitalId();
    const existing = (opts.rows ?? []).find((c) => c.item_type === opts.itemType);
    if (existing) {
      await supabase.from("service_master").update(opts.patch as any).eq("id", existing.id);
    } else {
      await supabase.from("service_master").insert({
        hospital_id: hid, name: opts.label, category: opts.category, item_type: opts.itemType,
        fee: opts.patch.fee ?? 0,
        gst_applicable: opts.patch.gst_applicable ?? false,
        gst_percent: opts.patch.gst_percent ?? 0,
      } as any);
    }
    qc.invalidateQueries({ queryKey: [opts.invalidateKey] });
  };

  const upsertOtCharge = (itemType: string, label: string, patch: { fee?: number; gst_applicable?: boolean; gst_percent?: number }) =>
    upsertFixedCharge({ itemType, label, category: "ot", invalidateKey: "settings-ot-charges", rows: otCharges, patch });

  const upsertEdCharge = (itemType: string, label: string, patch: { fee?: number; gst_applicable?: boolean; gst_percent?: number }) =>
    upsertFixedCharge({ itemType, label, category: "emergency", invalidateKey: "settings-ed-charges", rows: edCharges, patch });

  // Edit a ward's per-day rate: write to wards (source of truth) + mirror to catalog.
  const updateWardRate = async (wardId: string, value: string) => {
    const rate = parseFloat(value);
    if (isNaN(rate) || rate < 0) return;
    // The catalog mirror is kept in sync by a DB trigger (see serviceCatalogSync.ts).
    await (supabase as any).from("wards").update({ rate_per_day: rate }).eq("id", wardId);
    qc.invalidateQueries({ queryKey: ["settings-ward-rates"] });
    qc.invalidateQueries({ queryKey: ["settings-services"] });
  };

  /**
   * Per-ward nursing charge. Blank clears it back to 0, which means "nursing is included
   * in the room rate" — the required treatment for CGHS/ESI/TPA patients, so clearing has
   * to be possible, not just setting.
   */
  const updateWardNursingRate = async (wardId: string, value: string) => {
    const rate = value.trim() === "" ? 0 : parseFloat(value);
    if (isNaN(rate) || rate < 0) return;
    const saved = await setWardNursingRate(wardId, rate);
    if (!saved) {
      toast({
        title: "Nursing rate not saved",
        description: "This database has not had the ward nursing-rate migration applied yet.",
        variant: "destructive",
      });
      return;
    }
    qc.invalidateQueries({ queryKey: ["settings-ward-nursing-rates"] });
  };

  // Inline fee edits that write straight to each module's canonical table.
  const updateTableFee = async (table: string, id: string, column: string, value: string, invalidateKey: string) => {
    const num = parseFloat(value);
    if (isNaN(num) || num < 0) return;
    await (supabase as any).from(table).update({ [column]: num }).eq("id", id);
    qc.invalidateQueries({ queryKey: [invalidateKey] });
  };

  // Specialized module default rate → service_rates (upsert by item_code).
  const upsertSpecializedRate = async (item_code: string, item_name: string, value: string) => {
    const num = parseFloat(value);
    if (isNaN(num) || num < 0) return;
    const hid = await getHospitalId();
    const existing = (serviceRates ?? []).find((r) => r.item_code === item_code);
    if (existing) {
      await (supabase as any).from("service_rates").update({ default_rate: num }).eq("id", existing.id);
    } else {
      await (supabase as any).from("service_rates").insert({
        hospital_id: hid, item_code, item_name, item_type: "specialized",
        default_rate: num, gst_rate: 0, is_active: true,
      });
    }
    qc.invalidateQueries({ queryKey: ["settings-service-rates"] });
  };

  const seedSpecialized = useMutation({
    mutationFn: async () => {
      const hid = await getHospitalId();
      const existing = new Set((serviceRates ?? []).map((r) => r.item_code));
      const rows = SPECIALIZED_SERVICES.filter((s) => !existing.has(s.item_code))
        .map((s) => ({ item_code: s.item_code, item_name: s.item_name, item_type: "specialized", default_rate: s.default_rate, gst_rate: 0, is_active: true, hospital_id: hid }));
      if (rows.length === 0) return 0;
      const { error } = await (supabase as any).from("service_rates").insert(rows);
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (count) => {
      toast({ title: count ? `${count} specialized rates added` : "All specialized rates already present" });
      qc.invalidateQueries({ queryKey: ["settings-service-rates"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const seedRates = useMutation({
    mutationFn: async () => {
      const hid = await getHospitalId();
      const existing = new Set((serviceRates ?? []).map((r) => r.item_code));
      const rows = DEFAULT_RATE_SEEDS.filter((s) => !existing.has(s.item_code))
        .map((s) => ({ ...s, hospital_id: hid, gst_rate: 0, is_active: true }));
      if (rows.length === 0) return 0;
      const { error } = await (supabase as any).from("service_rates").insert(rows);
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (count) => {
      toast({ title: count ? `${count} default rates seeded` : "All defaults already present" });
      qc.invalidateQueries({ queryKey: ["settings-service-rates"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const inlineUpdateRate = async (id: string, field: "default_rate" | "gst_rate", value: string) => {
    const numVal = parseFloat(value);
    if (isNaN(numVal)) return;
    await (supabase as any).from("service_rates").update({ [field]: numVal }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["settings-service-rates"] });
  };

  // Only hospital-authored rows belong in the per-category tabs — mirrored rows are
  // edited on the tab that owns their source table, and would otherwise appear twice.
  const filtered = services?.filter((s) => {
    if (s.source_table) return false;
    if (tab === "consultation") return s.category === "consultation";
    if (tab === "procedure") return s.category === "procedure";
    if (tab === "package") return s.category === "package";
    if (tab === "lab") return s.category === "lab";
    if (tab === "radiology") return s.category === "radiology";
    // Catch-all: anything without a tab of its own lands here, so a category added
    // to SERVICE_CATEGORIES later can never become invisible.
    if (tab === "other") return !DEDICATED_TAB_CATEGORIES.includes(s.category);
    return true;
  }) ?? [];

  // ── All Services: the completeness view ────────────────────────────────────
  // Everything in service_master, grouped by category, with the GST percent that
  // will ACTUALLY land on a bill line — computed with the same helper Billing uses,
  // so a mis-taxed service is visible here rather than only on a patient's invoice.
  const allServicesGrouped = React.useMemo(() => {
    const q = allSearch.trim().toLowerCase();
    const rows = (services ?? []).filter((s) =>
      !q ||
      s.name.toLowerCase().includes(q) ||
      (s.category || "").toLowerCase().includes(q) ||
      (s.item_type || "").toLowerCase().includes(q)
    );
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = r.category || "uncategorised";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [services, allSearch]);

  const saveService = useMutation({
    mutationFn: async () => {
      const fee = parseFloat(form.fee);
      if (isNaN(fee) || fee < 0) throw new Error("Fee must be 0 or a positive number.");
      const followUpFee = form.follow_up_fee ? parseFloat(form.follow_up_fee) : null;
      if (followUpFee !== null && followUpFee < 0) throw new Error("Follow-up fee must be 0 or a positive number.");
      const hid = await getHospitalId();
      if (editingId) {
        const gstPct = form.gst_applicable ? (parseFloat(form.gst_percent) || 0) : 0;
        const { error } = await supabase.from("service_master").update({
          name: form.name, category: form.category, fee,
          // item_type must track category. service_master defaults it to 'service',
          // which GST_RATE_RULES prices at 18% — leaving it unset here is what taxed
          // every drawer-created service at 18% regardless of the toggle below.
          item_type: form.category,
          follow_up_fee: followUpFee,
          gst_applicable: form.gst_applicable,
          gst_percent: gstPct,
        } as any).eq("id", editingId);
        if (error) throw error;
      } else {
        const gstPct = form.gst_applicable ? (parseFloat(form.gst_percent) || 0) : 0;
        const { error } = await supabase.from("service_master").insert({
          hospital_id: hid, name: form.name, category: form.category,
          item_type: form.category,
          fee,
          follow_up_fee: followUpFee,
          gst_applicable: form.gst_applicable,
          gst_percent: gstPct,
        } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: `Service ${editingId ? "updated" : "added"}` });
      qc.invalidateQueries({ queryKey: ["settings-services"] });
      closeDrawer();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const loadDefaults = useMutation({
    mutationFn: async () => {
      const hid = await getHospitalId();
      const rows = DEFAULT_PROCEDURES.map((p) => ({
        hospital_id: hid, name: p.name, category: p.category, item_type: p.category, fee: p.fee,
      }));
      const { error } = await supabase.from("service_master").insert(rows);
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (count) => {
      toast({ title: `${count} default procedures loaded` });
      qc.invalidateQueries({ queryKey: ["settings-services"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const bulkAddServices = async (bulkRows: Record<string, string>[]) => {
    const hid = await getHospitalId();
    const defaultCategory = !NON_CATALOG_TABS.includes(tab) && tab !== "all" && tab !== "rates" ? tab : "other";
    const payload = bulkRows.map((r) => {
      const category = r.category?.trim() || defaultCategory;
      const fee = parseFloat(r.fee) || 0;
      return {
        hospital_id: hid, name: r.name.trim(), category, item_type: category, fee,
      };
    });
    const { error } = await supabase.from("service_master").insert(payload);
    if (error) return { error: error.message };
    qc.invalidateQueries({ queryKey: ["settings-services"] });
  };

  const applyBulkFee = useMutation({
    mutationFn: async () => {
      const hid = await getHospitalId();
      const fee = parseFloat(bulkFee);
      if (!fee) return;
      // For each department without a consultation entry, create one
      const existing = services?.filter((s) => s.category === "consultation").map((s) => s.name) ?? [];
      const missing = departments?.filter((d) => !existing.includes(`${d.name} Consultation`)) ?? [];
      if (missing.length > 0) {
        const rows = missing.map((d) => ({
          hospital_id: hid, name: `${d.name} Consultation`, category: "consultation" as const,
          item_type: "consultation", fee,
        }));
        await supabase.from("service_master").insert(rows);
      }
      // Update existing ones with 0 fee
      const zeroFee = services?.filter((s) => s.category === "consultation" && Number(s.fee) === 0) ?? [];
      for (const s of zeroFee) {
        await supabase.from("service_master").update({ fee }).eq("id", s.id);
      }
    },
    onSuccess: () => {
      toast({ title: "Consultation fees applied" });
      qc.invalidateQueries({ queryKey: ["settings-services"] });
      setBulkFee("");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const inlineUpdateFee = async (id: string, field: "fee" | "follow_up_fee", value: string) => {
    const numVal = parseFloat(value);
    if (isNaN(numVal)) return;
    await supabase.from("service_master").update({ [field]: numVal } as any).eq("id", id);
    qc.invalidateQueries({ queryKey: ["settings-services"] });
  };

  const openDrawer = (service?: any) => {
    if (service) {
      setEditingId(service.id);
      setForm({
        name: service.name, category: service.category,
        fee: String(service.fee), follow_up_fee: service.follow_up_fee ? String(service.follow_up_fee) : "",
        gst_applicable: service.gst_applicable,
        gst_percent: String((service as any).gst_percent ?? "0"),
      });
    } else {
      setEditingId(null);
      const genericCats = ["procedure", "package", "lab", "radiology", "other"];
      const category = genericCats.includes(tab) ? tab : "consultation";
      // Seed GST from the category the same way onCategoryChange does, so opening
      // the drawer and picking a category can't leave inconsistent defaults.
      const statutory = getDefaultGSTRate(category);
      setForm({
        name: "", category, fee: "", follow_up_fee: "",
        gst_applicable: statutory > 0, gst_percent: String(statutory),
      });
    }
    setDrawerOpen(true);
  };
  const closeDrawer = () => { setDrawerOpen(false); setEditingId(null); };

  /**
   * Picking a category pre-fills the GST fields with the statutory rate for that
   * category, so a taxable service (pharmacy 12%, parking 18%) isn't left at 0% by
   * omission. Still fully overridable — the checkbox remains authoritative on save
   * for hospital-authored rows (see resolveServiceGstPercent).
   */
  const onCategoryChange = (category: string) => {
    const statutory = getDefaultGSTRate(category);
    setForm((prev) => ({
      ...prev,
      category,
      gst_applicable: statutory > 0,
      gst_percent: String(statutory),
    }));
  };

  const openPayerRates = async (service: { id: string; name: string; category: string }) => {
    setPayerRatesService(service);
    const { data } = await (supabase as any).from("service_rates")
      .select("id, payer_type, default_rate, gst_rate, effective_from, effective_to")
      .eq("item_code", `svc_${service.id}`)
      .neq("payer_type", "all");
    const map: Record<string, { rate: string; gst: string; from: string; to: string; rateId?: string }> = {};
    (data || []).forEach((r: any) => {
      map[r.payer_type] = {
        rate: String(r.default_rate ?? ""),
        gst: String(r.gst_rate ?? "0"),
        from: r.effective_from || "",
        to: r.effective_to || "",
        rateId: r.id,
      };
    });
    setPayerRatesData(map);
    setPayerRatesOpen(true);
  };

  const savePayerRates = async () => {
    if (!payerRatesService) return;
    setPayerRatesSaving(true);
    const hid = await getHospitalId();
    const today = new Date().toISOString().split("T")[0];
    for (const pt of PAYER_TYPES_FOR_RATES) {
      const entry = payerRatesData[pt.value];
      if (!entry || !entry.rate) continue;
      const payload = {
        hospital_id: hid,
        item_code: `svc_${payerRatesService.id}`,
        item_name: payerRatesService.name,
        item_type: payerRatesService.category,
        payer_type: pt.value,
        default_rate: parseFloat(entry.rate) || 0,
        gst_rate: parseFloat(entry.gst) || 0,
        effective_from: entry.from || today,
        effective_to: entry.to || null,
        is_active: true,
      };
      if (entry.rateId) {
        await (supabase as any).from("service_rates").update(payload).eq("id", entry.rateId);
      } else {
        const { data: inserted } = await (supabase as any).from("service_rates").insert(payload).select("id").maybeSingle();
        if (inserted) {
          setPayerRatesData(prev => ({ ...prev, [pt.value]: { ...prev[pt.value], rateId: inserted.id } }));
        }
      }
    }
    setPayerRatesSaving(false);
    toast({ title: "Payer rates saved" });
    qc.invalidateQueries({ queryKey: ["settings-service-rates"] });
  };;

  const procedureCount = services?.filter((s) => s.category === "procedure" || s.category === "radiology").length ?? 0;

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col overflow-hidden relative">
      {/* HEADER */}
      <div className="flex-shrink-0 px-6 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/settings")} className="text-muted-foreground hover:text-foreground active:scale-95"><ArrowLeft size={18} /></button>
          <div>
            <h1 className="text-lg font-bold text-foreground">Services & Fees</h1>
            <p className="text-xs text-muted-foreground">Settings › Services & Fees</p>
          </div>
        </div>
        {!NON_CATALOG_TABS.includes(tab) && (
          <div className="flex items-center gap-2">
            <button onClick={() => setBulkOpen(true)} className="flex items-center gap-1.5 border border-border text-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-muted active:scale-[0.97]">
              <ListPlus size={14} /> Bulk Add
            </button>
            <button onClick={() => openDrawer()} className="flex items-center gap-1.5 bg-[hsl(222,55%,23%)] text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 active:scale-[0.97]">
              <Plus size={14} /> Add Service
            </button>
          </div>
        )}
      </div>

      <BulkPasteAddModal
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title="Bulk Add Services"
        description="Fill in a row per service — Category defaults to the current tab if left blank."
        columns={[
          { key: "name",     label: "Service Name", required: true, placeholder: "e.g. ECG" },
          { key: "fee",      label: "Fee (₹)", type: "number", placeholder: "0" },
          { key: "category", label: "Category", type: "select", options: SERVICE_CATEGORIES, placeholder: `Default: ${SERVICE_CATEGORIES.find(c => c.value === tab)?.label ?? tab}` },
        ]}
        existingKeys={new Set((services ?? []).map((s) => s.name.toLowerCase()))}
        onSubmit={bulkAddServices}
      />

      {/* TABS */}
      <div className="flex-shrink-0 px-6 py-2.5 border-b border-border flex gap-1.5 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors active:scale-[0.97]",
              tab === t.key ? "bg-[hsl(222,55%,23%)] text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}>
            {t.label}
          </button>
        ))}
      </div>

      {/* BULK FEE for consultation tab */}
      {tab === "consultation" && (
        <div className="flex-shrink-0 px-6 py-2.5 border-b border-border flex items-center gap-3 bg-muted/20">
          <span className="text-xs text-muted-foreground">Set all consultation fees:</span>
          <Input type="number" value={bulkFee} onChange={(e) => setBulkFee(e.target.value)} placeholder="₹500" className="h-8 w-24 text-sm" />
          <button onClick={() => applyBulkFee.mutate()} disabled={!bulkFee || applyBulkFee.isPending}
            className="text-xs font-medium text-primary hover:underline disabled:opacity-40">
            {applyBulkFee.isPending ? "Applying..." : "Apply to all"}
          </button>
        </div>
      )}

      {/* LOAD DEFAULTS for procedure tab */}
      {tab === "procedure" && procedureCount === 0 && (
        <div className="flex-shrink-0 mx-6 mt-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-center justify-between">
          <p className="text-[13px] text-blue-800 font-medium">No procedures yet — load common hospital procedures?</p>
          <button onClick={() => loadDefaults.mutate()} disabled={loadDefaults.isPending}
            className="text-sm font-medium text-blue-700 border border-blue-300 rounded-lg px-3 py-1.5 hover:bg-blue-100 active:scale-[0.97]">
            {loadDefaults.isPending ? "Loading..." : "Load Default Procedures"}
          </button>
        </div>
      )}

      {/* DEFAULT RATES TAB */}
      {tab === "rates" ? (
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Module Default Rates</h2>
              <p className="text-xs text-muted-foreground">Used as fallback fees by OT, Dialysis, IPD and other modules. Each hospital can set its own.</p>
            </div>
            <button
              onClick={() => seedRates.mutate()}
              disabled={seedRates.isPending}
              className="text-xs font-medium text-primary border border-input rounded-lg px-3 py-1.5 hover:bg-muted active:scale-[0.97] disabled:opacity-40"
            >
              {seedRates.isPending ? "Seeding…" : "Seed Common Codes"}
            </button>
          </div>
          <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
            <thead className="bg-muted/50">
              <tr className="text-left text-[11px] text-muted-foreground uppercase tracking-wider">
                <th className="px-4 py-2.5 font-medium">Item Code</th>
                <th className="px-4 py-2.5 font-medium">Display Name</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium text-right">Default Rate (₹)</th>
                <th className="px-4 py-2.5 font-medium text-right">GST %</th>
              </tr>
            </thead>
            <tbody>
              {(serviceRates ?? []).length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground text-xs">No rates configured. Click <span className="font-medium">Seed Common Codes</span> to start.</td></tr>
              ) : (serviceRates ?? []).map((r) => (
                <tr key={r.id} className="border-t border-border/50 hover:bg-muted/20">
                  <td className="px-4 py-2.5 font-mono text-xs text-foreground">{r.item_code}</td>
                  <td className="px-4 py-2.5 text-foreground">{r.item_name}</td>
                  <td className="px-4 py-2.5"><span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">{r.item_type}</span></td>
                  <td className="px-4 py-2.5 text-right">
                    <input
                      type="number"
                      defaultValue={Number(r.default_rate)}
                      onBlur={(e) => inlineUpdateRate(r.id, "default_rate", e.target.value)}
                      className="w-24 h-7 text-right text-sm font-medium tabular-nums bg-transparent border border-transparent hover:border-input focus:border-input rounded px-1 outline-none"
                    />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <input
                      type="number"
                      defaultValue={Number(r.gst_rate ?? 0)}
                      onBlur={(e) => inlineUpdateRate(r.id, "gst_rate", e.target.value)}
                      className="w-16 h-7 text-right text-sm tabular-nums text-muted-foreground bg-transparent border border-transparent hover:border-input focus:border-input rounded px-1 outline-none"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : tab === "ot" ? (
        /* OT & SURGERY TAB */
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-foreground">OT & Surgery Charges</h2>
            <p className="text-xs text-muted-foreground">Default rates pushed to a bill when an OT case is billed. Edits apply to new OT bills immediately.</p>
          </div>
          <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
            <thead className="bg-muted/50">
              <tr className="text-left text-[11px] text-muted-foreground uppercase tracking-wider">
                <th className="px-4 py-2.5 font-medium">Charge</th>
                <th className="px-4 py-2.5 font-medium text-right">Rate (₹)</th>
                <th className="px-4 py-2.5 font-medium text-right">GST %</th>
              </tr>
            </thead>
            <tbody>
              {OT_CHARGE_TYPES.map((t) => {
                const current = (otCharges ?? []).find((c) => c.item_type === t.item_type);
                return (
                  <tr key={t.item_type} className="border-t border-border/50 hover:bg-muted/20">
                    <td className="px-4 py-2.5 text-foreground">{t.label}</td>
                    <td className="px-4 py-2.5 text-right">
                      <input
                        type="number"
                        defaultValue={current ? Number(current.fee) : ""}
                        placeholder={String(t.fallback)}
                        onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0) upsertOtCharge(t.item_type, t.label, { fee: v }); }}
                        className="w-24 h-7 text-right text-sm font-medium tabular-nums bg-transparent border border-transparent hover:border-input focus:border-input rounded px-1 outline-none"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <input
                        type="number"
                        defaultValue={current ? Number(current.gst_percent ?? 0) : 0}
                        onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0) upsertOtCharge(t.item_type, t.label, { gst_percent: v, gst_applicable: v > 0 }); }}
                        className="w-16 h-7 text-right text-sm tabular-nums text-muted-foreground bg-transparent border border-transparent hover:border-input focus:border-input rounded px-1 outline-none"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[11px] text-muted-foreground mt-3">Implant / consumable costs are captured per-case in the OT module and billed automatically.</p>
        </div>
      ) : tab === "ipd_beds" ? (
        /* IPD BEDS & WARDS TAB */
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-foreground">IPD Beds & Wards — Per-Day Tariff</h2>
            <p className="text-xs text-muted-foreground">Room/bed charge per day for each ward. Syncs with Settings › Wards &amp; Beds and applies to IPD bed-day billing.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Nursing is billed as a separate per-day line only where a rate is set. Leave it
              blank for CGHS, ESI, PM-JAY and TPA patients — those schemes require nursing to be
              included in the room rent.
            </p>
          </div>
          {(wardRates ?? []).length === 0 ? (
            <div className="text-center text-muted-foreground text-xs py-10 border border-border rounded-lg">
              No wards configured yet. Add wards in{" "}
              <button onClick={() => navigate("/settings/wards")} className="text-primary hover:underline font-medium">Settings › Wards &amp; Beds</button>.
            </div>
          ) : (
            <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
              <thead className="bg-muted/50">
                <tr className="text-left text-[11px] text-muted-foreground uppercase tracking-wider">
                  <th className="px-4 py-2.5 font-medium">Ward</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium text-right">Rate / Day (₹)</th>
                  <th className="px-4 py-2.5 font-medium text-right">Nursing / Day (₹)</th>
                </tr>
              </thead>
              <tbody>
                {(wardRates ?? []).map((w) => (
                  <tr key={w.id} className="border-t border-border/50 hover:bg-muted/20">
                    <td className="px-4 py-2.5 text-foreground font-medium">{w.name}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">{w.type?.replace("_", " ")}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <input
                        type="number"
                        defaultValue={w.rate_per_day ? Number(w.rate_per_day) : ""}
                        placeholder="—"
                        onBlur={(e) => updateWardRate(w.id, e.target.value)}
                        className="w-28 h-7 text-right text-sm font-medium tabular-nums bg-transparent border border-transparent hover:border-input focus:border-input rounded px-1 outline-none"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <input
                        type="number"
                        key={`nursing-${w.id}-${wardNursingRates?.[w.id] ?? ""}`}
                        defaultValue={wardNursingRates?.[w.id] ? Number(wardNursingRates[w.id]) : ""}
                        placeholder="incl. in room"
                        onBlur={(e) => updateWardNursingRate(w.id, e.target.value)}
                        className="w-32 h-7 text-right text-sm font-medium tabular-nums bg-transparent border border-transparent hover:border-input focus:border-input rounded px-1 outline-none"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : tab === "emergency" ? (
        /* EMERGENCY TAB */
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-foreground">Emergency (Casualty) Charges</h2>
            <p className="text-xs text-muted-foreground">Casualty fee billed automatically when an ED patient is discharged or admitted. Set ₹0 to leave ED visits unbilled.</p>
          </div>
          <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
            <thead className="bg-muted/50">
              <tr className="text-left text-[11px] text-muted-foreground uppercase tracking-wider">
                <th className="px-4 py-2.5 font-medium">Charge</th>
                <th className="px-4 py-2.5 font-medium text-right">Rate (₹)</th>
                <th className="px-4 py-2.5 font-medium text-right">GST %</th>
              </tr>
            </thead>
            <tbody>
              {ED_CHARGE_TYPES.map((t) => {
                const current = (edCharges ?? []).find((c) => c.item_type === t.item_type);
                return (
                  <tr key={t.item_type} className="border-t border-border/50 hover:bg-muted/20">
                    <td className="px-4 py-2.5 text-foreground">{t.label}</td>
                    <td className="px-4 py-2.5 text-right">
                      <input
                        type="number"
                        defaultValue={current ? Number(current.fee) : ""}
                        placeholder={String(t.fallback)}
                        onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0) upsertEdCharge(t.item_type, t.label, { fee: v }); }}
                        className="w-24 h-7 text-right text-sm font-medium tabular-nums bg-transparent border border-transparent hover:border-input focus:border-input rounded px-1 outline-none"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <input
                        type="number"
                        defaultValue={current ? Number(current.gst_percent ?? 0) : 0}
                        onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0) upsertEdCharge(t.item_type, t.label, { gst_percent: v, gst_applicable: v > 0 }); }}
                        className="w-16 h-7 text-right text-sm tabular-nums text-muted-foreground bg-transparent border border-transparent hover:border-input focus:border-input rounded px-1 outline-none"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[11px] text-muted-foreground mt-3">Labs, radiology, procedures and pharmacy ordered in the ED are billed by their own modules.</p>
        </div>
      ) : tab === "lab" ? (
        /* LAB TESTS TAB — edits lab_test_master.fee / lab_test_groups.fee directly */
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Lab Test Fees</h2>
            <p className="text-xs text-muted-foreground">These are the fees billing uses. Add new tests in{" "}
              <button onClick={() => navigate("/settings/lab-tests")} className="text-primary hover:underline font-medium">Lab Test Master</button>.</p>
          </div>
          <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
            <thead className="bg-muted/50">
              <tr className="text-left text-[11px] text-muted-foreground uppercase tracking-wider">
                <th className="px-4 py-2.5 font-medium">Test Name</th>
                <th className="px-4 py-2.5 font-medium">Code</th>
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 font-medium text-right">Fee (₹)</th>
              </tr>
            </thead>
            <tbody>
              {(labTests ?? []).length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground text-xs">No lab tests yet. Add them in Lab Test Master.</td></tr>
              ) : (labTests ?? []).map((t) => (
                <tr key={t.id} className="border-t border-border/50 hover:bg-muted/20">
                  <td className="px-4 py-2.5 font-medium text-foreground">{t.test_name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{t.test_code || "—"}</td>
                  <td className="px-4 py-2.5"><span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">{t.category || "—"}</span></td>
                  <td className="px-4 py-2.5 text-right">
                    <input type="number" defaultValue={t.fee != null ? Number(t.fee) : ""} placeholder="0"
                      onBlur={(e) => updateTableFee("lab_test_master", t.id, "fee", e.target.value, "settings-lab-tests-fees")}
                      className="w-24 h-7 text-right text-sm font-medium tabular-nums bg-transparent border border-transparent hover:border-input focus:border-input rounded px-1 outline-none" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(labGroups ?? []).length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-foreground mb-2">Test Groups / Panels</h3>
              <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                <thead className="bg-muted/50">
                  <tr className="text-left text-[11px] text-muted-foreground uppercase tracking-wider">
                    <th className="px-4 py-2.5 font-medium">Group Name</th>
                    <th className="px-4 py-2.5 font-medium">Code</th>
                    <th className="px-4 py-2.5 font-medium text-right">Price (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {(labGroups ?? []).map((g) => (
                    <tr key={g.id} className="border-t border-border/50 hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-medium text-foreground">{g.group_name}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{g.group_code || "—"}</td>
                      <td className="px-4 py-2.5 text-right">
                        <input type="number" defaultValue={g.fee != null ? Number(g.fee) : ""} placeholder="0"
                          onBlur={(e) => updateTableFee("lab_test_groups", g.id, "fee", e.target.value, "settings-lab-groups-fees")}
                          className="w-24 h-7 text-right text-sm font-medium tabular-nums bg-transparent border border-transparent hover:border-input focus:border-input rounded px-1 outline-none" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : tab === "radiology" ? (
        /* RADIOLOGY TAB — edits radiology_study_master.fee directly */
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-foreground">Radiology Study Fees</h2>
            <p className="text-xs text-muted-foreground">These are the fees billing uses. Add studies in{" "}
              <button onClick={() => navigate("/settings/radiology")} className="text-primary hover:underline font-medium">Radiology Modalities</button>.</p>
          </div>
          <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
            <thead className="bg-muted/50">
              <tr className="text-left text-[11px] text-muted-foreground uppercase tracking-wider">
                <th className="px-4 py-2.5 font-medium">Study</th>
                <th className="px-4 py-2.5 font-medium">Modality</th>
                <th className="px-4 py-2.5 font-medium text-right">Fee (₹)</th>
              </tr>
            </thead>
            <tbody>
              {(radiologyStudies ?? []).length === 0 ? (
                <tr><td colSpan={3} className="px-4 py-10 text-center text-muted-foreground text-xs">No studies yet. Add them in Radiology Modalities.</td></tr>
              ) : (radiologyStudies ?? []).map((s) => (
                <tr key={s.id} className="border-t border-border/50 hover:bg-muted/20">
                  <td className="px-4 py-2.5 font-medium text-foreground">{s.study_name}</td>
                  <td className="px-4 py-2.5"><span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">{(s.modality_type || "—").replace(/_/g, " ")}</span></td>
                  <td className="px-4 py-2.5 text-right">
                    <input type="number" defaultValue={s.fee != null ? Number(s.fee) : ""} placeholder="0"
                      onBlur={(e) => updateTableFee("radiology_study_master", s.id, "fee", e.target.value, "settings-radiology-fees")}
                      className="w-24 h-7 text-right text-sm font-medium tabular-nums bg-transparent border border-transparent hover:border-input focus:border-input rounded px-1 outline-none" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : tab === "package" ? (
        /* PACKAGES TAB — edits health_packages.price directly */
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-foreground">Health Package Prices</h2>
            <p className="text-xs text-muted-foreground">These prices are what package booking bills. Create packages in the Health Packages module.</p>
          </div>
          <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
            <thead className="bg-muted/50">
              <tr className="text-left text-[11px] text-muted-foreground uppercase tracking-wider">
                <th className="px-4 py-2.5 font-medium">Package</th>
                <th className="px-4 py-2.5 font-medium">Code</th>
                <th className="px-4 py-2.5 font-medium text-right">Price (₹)</th>
              </tr>
            </thead>
            <tbody>
              {(healthPackages ?? []).length === 0 ? (
                <tr><td colSpan={3} className="px-4 py-10 text-center text-muted-foreground text-xs">No packages yet. Create them in the Health Packages module.</td></tr>
              ) : (healthPackages ?? []).map((p) => (
                <tr key={p.id} className="border-t border-border/50 hover:bg-muted/20">
                  <td className="px-4 py-2.5 font-medium text-foreground">{p.package_name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{p.package_code || "—"}</td>
                  <td className="px-4 py-2.5 text-right">
                    <input type="number" defaultValue={p.price != null ? Number(p.price) : ""} placeholder="0"
                      onBlur={(e) => updateTableFee("health_packages", p.id, "price", e.target.value, "settings-health-packages-fees")}
                      className="w-24 h-7 text-right text-sm font-medium tabular-nums bg-transparent border border-transparent hover:border-input focus:border-input rounded px-1 outline-none" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : tab === "specialized" ? (
        /* SPECIALIZED SERVICES TAB — one configurable rate per module (service_rates) */
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Specialized Service Rates</h2>
              <p className="text-xs text-muted-foreground">Default rate per module (Dialysis, Physio, Ambulance, etc.). Configured here, these stop ₹0 billing in each module.</p>
            </div>
            <button onClick={() => seedSpecialized.mutate()} disabled={seedSpecialized.isPending}
              className="text-xs font-medium text-primary border border-input rounded-lg px-3 py-1.5 hover:bg-muted active:scale-[0.97] disabled:opacity-40">
              {seedSpecialized.isPending ? "Adding…" : "Seed Defaults"}
            </button>
          </div>
          <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
            <thead className="bg-muted/50">
              <tr className="text-left text-[11px] text-muted-foreground uppercase tracking-wider">
                <th className="px-4 py-2.5 font-medium">Module Service</th>
                <th className="px-4 py-2.5 font-medium">Code</th>
                <th className="px-4 py-2.5 font-medium text-right">Rate (₹)</th>
              </tr>
            </thead>
            <tbody>
              {SPECIALIZED_SERVICES.map((s) => {
                const current = (serviceRates ?? []).find((r) => r.item_code === s.item_code);
                return (
                  <tr key={s.item_code} className="border-t border-border/50 hover:bg-muted/20">
                    <td className="px-4 py-2.5 text-foreground">{s.item_name}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{s.item_code}</td>
                    <td className="px-4 py-2.5 text-right">
                      <input type="number" defaultValue={current ? Number(current.default_rate) : ""} placeholder={String(s.default_rate)}
                        onBlur={(e) => upsertSpecializedRate(s.item_code, s.item_name, e.target.value)}
                        className="w-24 h-7 text-right text-sm font-medium tabular-nums bg-transparent border border-transparent hover:border-input focus:border-input rounded px-1 outline-none" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[11px] text-muted-foreground mt-3">Chemotherapy bills per-mg; Blood Unit applies per component issued. Per-item pricing (per vaccine, per dental procedure) stays in those modules.</p>
        </div>
      ) : tab === "day_care" ? (
        /* DAY CARE TAB — edits day_care_procedures.standard_rate directly */
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-foreground">Day Care Procedure Rates</h2>
            <p className="text-xs text-muted-foreground">The rate day-care billing charges. Add or edit procedures in{" "}
              <button onClick={() => navigate("/settings/day-care-procedures")} className="text-primary hover:underline font-medium">Day Care Procedures</button>.</p>
          </div>
          <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
            <thead className="bg-muted/50">
              <tr className="text-left text-[11px] text-muted-foreground uppercase tracking-wider">
                <th className="px-4 py-2.5 font-medium">Procedure</th>
                <th className="px-4 py-2.5 font-medium">Code</th>
                <th className="px-4 py-2.5 font-medium">Specialty</th>
                <th className="px-4 py-2.5 font-medium text-right">Rate (₹)</th>
              </tr>
            </thead>
            <tbody>
              {(dayCareProcedures ?? []).length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground text-xs">No day care procedures yet. Add them in Day Care Procedures.</td></tr>
              ) : (dayCareProcedures ?? []).map((p) => (
                <tr key={p.id} className="border-t border-border/50 hover:bg-muted/20">
                  <td className="px-4 py-2.5 font-medium text-foreground">{p.procedure_name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{p.procedure_code || "—"}</td>
                  <td className="px-4 py-2.5"><span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">{p.specialty || "—"}</span></td>
                  <td className="px-4 py-2.5 text-right">
                    <input type="number" defaultValue={p.standard_rate != null ? Number(p.standard_rate) : ""} placeholder="0"
                      onBlur={(e) => updateTableFee("day_care_procedures", p.id, "standard_rate", e.target.value, "settings-day-care-fees")}
                      className="w-24 h-7 text-right text-sm font-medium tabular-nums bg-transparent border border-transparent hover:border-input focus:border-input rounded px-1 outline-none" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-muted-foreground mt-3">A booking freezes the rate at the time it is made, so changing a rate here affects new bookings only.</p>
        </div>
      ) : tab === "all" ? (
        /* ALL SERVICES TAB — the whole billing catalog, nothing hidden */
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-foreground">All Billable Services</h2>
            <p className="text-xs text-muted-foreground">
              Everything the Billing screen can find, from every module. <span className="font-medium">GST %</span> is the rate that will actually land on a bill line.
            </p>
          </div>
          <Input value={allSearch} onChange={(e) => setAllSearch(e.target.value)}
            placeholder="Search all services by name, category or type…" className="h-9 mb-3 max-w-md" />
          {allServicesGrouped.length === 0 ? (
            <div className="text-center text-muted-foreground text-xs py-10 border border-border rounded-lg">
              {allSearch ? `No services match "${allSearch}".` : "No services configured yet."}
            </div>
          ) : allServicesGrouped.map(([category, rows]) => (
            <div key={category} className="mb-5">
              <h3 className="text-xs font-semibold text-foreground mb-2 capitalize">
                {category} <span className="text-muted-foreground font-normal">({rows.length})</span>
              </h3>
              <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                <thead className="bg-muted/50">
                  <tr className="text-left text-[11px] text-muted-foreground uppercase tracking-wider">
                    <th className="px-4 py-2.5 font-medium">Service Name</th>
                    <th className="px-4 py-2.5 font-medium">Billing Type</th>
                    <th className="px-4 py-2.5 font-medium">Managed In</th>
                    <th className="px-4 py-2.5 font-medium text-right">Fee (₹)</th>
                    <th className="px-4 py-2.5 font-medium text-right">GST %</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const mirror = s.source_table ? MIRROR_SOURCE_LABELS[s.source_table] : null;
                    const effectiveGst = resolveServiceGstPercent(s, Number(s.fee) || 0);
                    return (
                      <tr key={s.id} className="border-t border-border/50 hover:bg-muted/20">
                        <td className="px-4 py-2.5 font-medium text-foreground">{s.name}</td>
                        <td className="px-4 py-2.5">
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">{s.item_type || "—"}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          {s.source_table ? (
                            <button onClick={() => setTab(mirror?.tab ?? "all")}
                              className="text-[11px] text-primary hover:underline font-medium">
                              ↗ {mirror?.label ?? s.source_table}
                            </button>
                          ) : (
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">Manual</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {s.source_table ? (
                            <span className="text-sm font-medium tabular-nums text-muted-foreground pr-1">{Number(s.fee).toLocaleString("en-IN")}</span>
                          ) : (
                            <input type="number" defaultValue={Number(s.fee)}
                              onBlur={(e) => inlineUpdateFee(s.id, "fee", e.target.value)}
                              className="w-24 h-7 text-right text-sm font-medium tabular-nums bg-transparent border border-transparent hover:border-input focus:border-input rounded px-1 outline-none" />
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm tabular-nums text-muted-foreground">{effectiveGst}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground mt-1">
            Rows marked <span className="font-medium">Manual</span> were created here and their fee is editable inline. Mirrored rows are priced by the module that owns them — edit them there, or a background sync will overwrite the change.
          </p>
        </div>
      ) : (
      <>
      {/* TABLE */}
      <div className="flex-1 overflow-y-auto">
        {!isLoading && filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center"><Receipt size={24} className="text-muted-foreground" /></div>
            <p className="text-sm font-medium text-foreground">No {tab} services yet</p>
            <button onClick={() => openDrawer()} className="flex items-center gap-1.5 bg-[hsl(222,55%,23%)] text-white px-4 py-2 rounded-lg text-sm font-medium active:scale-[0.97]">
              <Plus size={14} /> Add First Service
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/50 backdrop-blur-sm z-10">
              <tr className="text-left text-[11px] text-muted-foreground uppercase tracking-wider">
                <th className="px-6 py-2.5 font-medium">Service Name</th>
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 font-medium text-right">Fee (₹)</th>
                {tab === "consultation" && <th className="px-4 py-2.5 font-medium text-right">Follow-up (₹)</th>}
                <th className="px-4 py-2.5 font-medium">GST</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">Loading...</td></tr>}
              {filtered.map((s) => (
                <tr key={s.id} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="px-6 py-3 font-medium text-foreground">{s.name}</td>
                  <td className="px-4 py-3">
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium capitalize">{s.category}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <input
                      type="number"
                      defaultValue={Number(s.fee)}
                      onBlur={(e) => inlineUpdateFee(s.id, "fee", e.target.value)}
                      className="w-20 h-7 text-right text-sm font-medium tabular-nums bg-transparent border border-transparent hover:border-input focus:border-input rounded px-1 outline-none"
                    />
                  </td>
                  {tab === "consultation" && (
                    <td className="px-4 py-3 text-right">
                      <input
                        type="number"
                        defaultValue={s.follow_up_fee ? Number(s.follow_up_fee) : ""}
                        onBlur={(e) => inlineUpdateFee(s.id, "follow_up_fee", e.target.value)}
                        placeholder="—"
                        className="w-20 h-7 text-right text-sm tabular-nums text-muted-foreground bg-transparent border border-transparent hover:border-input focus:border-input rounded px-1 outline-none"
                      />
                    </td>
                  )}
                  <td className="px-4 py-3 text-muted-foreground text-xs">{s.gst_applicable ? "Yes" : "No"}</td>
                  <td className="px-4 py-3 text-right flex items-center justify-end gap-1">
                    <button onClick={() => openPayerRates({ id: s.id, name: s.name, category: s.category })} className="text-xs text-purple-600 hover:text-purple-800 px-2 py-1 rounded hover:bg-purple-50 font-medium">Rates ↗</button>
                    <button onClick={() => openDrawer(s)} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      </>
      )}

      {/* PAYER RATES DRAWER */}
      {payerRatesOpen && payerRatesService && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setPayerRatesOpen(false)} />
          <div className="fixed right-0 top-0 bottom-0 w-[480px] bg-card border-l border-border z-50 flex flex-col shadow-xl animate-in slide-in-from-right duration-200">
            <div className="flex-shrink-0 px-6 py-4 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-foreground">Rates by Payer</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{payerRatesService.name}</p>
              </div>
              <button onClick={() => setPayerRatesOpen(false)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <p className="text-xs text-muted-foreground mb-4">Set payer-specific rates below. Leave blank to use the standard fee.</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-muted-foreground uppercase tracking-wider text-left">
                    <th className="pb-2 font-medium">Payer Type</th>
                    <th className="pb-2 font-medium text-right">Rate (₹)</th>
                    <th className="pb-2 font-medium text-right">GST %</th>
                    <th className="pb-2 font-medium text-right">Eff. From</th>
                    <th className="pb-2 font-medium text-right">Eff. To</th>
                  </tr>
                </thead>
                <tbody>
                  {PAYER_TYPES_FOR_RATES.map((pt) => {
                    const entry = payerRatesData[pt.value] || { rate: "", gst: "0", from: "", to: "" };
                    const setEntry = (patch: Partial<typeof entry>) =>
                      setPayerRatesData(prev => ({ ...prev, [pt.value]: { ...entry, ...patch } }));
                    return (
                      <tr key={pt.value} className="border-t border-border/50">
                        <td className="py-2 pr-2 font-medium text-foreground text-xs">{pt.label}</td>
                        <td className="py-2 px-1 text-right">
                          <input type="number" value={entry.rate} onChange={(e) => setEntry({ rate: e.target.value })} placeholder="—"
                            className="w-20 h-7 text-right text-sm tabular-nums bg-transparent border border-transparent hover:border-input focus:border-input rounded px-1 outline-none" />
                        </td>
                        <td className="py-2 px-1 text-right">
                          <input type="number" value={entry.gst} onChange={(e) => setEntry({ gst: e.target.value })} placeholder="0"
                            className="w-14 h-7 text-right text-sm tabular-nums text-muted-foreground bg-transparent border border-transparent hover:border-input focus:border-input rounded px-1 outline-none" />
                        </td>
                        <td className="py-2 px-1 text-right">
                          <input type="date" value={entry.from} onChange={(e) => setEntry({ from: e.target.value })}
                            className="w-28 h-7 text-xs text-right bg-transparent border border-transparent hover:border-input focus:border-input rounded px-1 outline-none" />
                        </td>
                        <td className="py-2 pl-1 text-right">
                          <input type="date" value={entry.to} onChange={(e) => setEntry({ to: e.target.value })}
                            className="w-28 h-7 text-xs text-right bg-transparent border border-transparent hover:border-input focus:border-input rounded px-1 outline-none" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex-shrink-0 px-6 py-4 border-t border-border flex gap-3">
              <button onClick={() => setPayerRatesOpen(false)} className="flex-1 h-11 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted active:scale-[0.98]">Cancel</button>
              <button onClick={savePayerRates} disabled={payerRatesSaving}
                className="flex-[2] h-11 rounded-lg bg-[hsl(222,55%,23%)] text-white text-sm font-semibold hover:opacity-90 active:scale-[0.97] disabled:opacity-40">
                {payerRatesSaving ? "Saving..." : "Save Payer Rates"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* DRAWER */}
      {drawerOpen && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={closeDrawer} />
          <div className="fixed right-0 top-0 bottom-0 w-[380px] bg-card border-l border-border z-50 flex flex-col shadow-xl animate-in slide-in-from-right duration-200">
            <div className="flex-shrink-0 px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-bold text-foreground">{editingId ? "Edit Service" : "Add Service"}</h2>
              <button onClick={closeDrawer} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Service Name *</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="OPD Consultation" className="h-10" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Category</label>
                <select value={form.category} onChange={(e) => onCategoryChange(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {SERVICE_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                  {/* A legacy row may carry a category outside this list (e.g. the old
                      'service' default). Without an option to match it, the browser
                      would show the first entry and silently re-categorise the service
                      on save. Keep its own value selectable instead. */}
                  {form.category && !SERVICE_CATEGORIES.some((c) => c.value === form.category) && (
                    <option value={form.category}>{form.category} (existing)</option>
                  )}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Sets how the service is taxed and which tab it appears under.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Fee (₹) *</label>
                  <Input type="number" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} placeholder="500" className="h-10" />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Follow-up (₹)</label>
                  <Input type="number" value={form.follow_up_fee} onChange={(e) => setForm({ ...form, follow_up_fee: e.target.value })} placeholder="200" className="h-10" />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.gst_applicable} onChange={(e) => setForm({ ...form, gst_applicable: e.target.checked })}
                    className="h-4 w-4 rounded border-input" />
                  <span className="text-sm text-foreground">GST applicable</span>
                </label>
                {form.gst_applicable && (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number" min={0} max={100} step="0.01"
                      value={form.gst_percent}
                      onChange={(e) => setForm({ ...form, gst_percent: e.target.value })}
                      placeholder="e.g. 5"
                      className="h-9 w-24"
                    />
                    <span className="text-xs text-muted-foreground">% GST rate</span>
                  </div>
                )}
              </div>
              {/* Categories that carry a statutory rate bill at 0% when the toggle is
                  off. Surface that so leaving it unchecked is a deliberate choice
                  rather than a silent one. */}
              {!form.gst_applicable && getDefaultGSTRate(form.category) > 0 && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-2">
                  {SERVICE_CATEGORIES.find((c) => c.value === form.category)?.label ?? form.category} normally attracts{" "}
                  <span className="font-semibold">{getDefaultGSTRate(form.category)}% GST</span>. With this unchecked, bills will charge 0% on this service.
                </p>
              )}
            </div>
            <div className="flex-shrink-0 px-6 py-4 border-t border-border flex gap-3">
              <button onClick={closeDrawer} className="flex-1 h-11 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted active:scale-[0.98]">Cancel</button>
              <button onClick={() => saveService.mutate()} disabled={!form.name || !form.fee || saveService.isPending}
                className="flex-[2] h-11 rounded-lg bg-[hsl(222,55%,23%)] text-white text-sm font-semibold hover:opacity-90 active:scale-[0.97] disabled:opacity-40">
                {saveService.isPending ? "Saving..." : "Save Service"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default SettingsServicesPage;
