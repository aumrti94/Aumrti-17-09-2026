import React, { useState, useEffect, useCallback } from "react";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import { supabase } from "@/integrations/supabase/client";
import { autoChargeService, MODULE_DIETETICS } from "@/lib/serviceBilling";
import { callAI } from "@/lib/aiProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { toast } from "sonner";
import { format, differenceInHours } from "date-fns";
import { AlertTriangle, Plus, Utensils, Stethoscope, Bot, BarChart3, Loader2, Star, Printer, ClipboardCheck } from "lucide-react";

const DIET_TYPES = [
  { value: "normal", label: "Normal" },
  { value: "soft", label: "Soft" },
  { value: "semi_liquid", label: "Semi-Liquid" },
  { value: "liquid", label: "Liquid" },
  { value: "ngt_feed", label: "NGT Feed" },
  { value: "npo", label: "NPO (Nil by Mouth)" },
  { value: "diabetic", label: "Diabetic" },
  { value: "renal", label: "Renal" },
  { value: "cardiac", label: "Cardiac" },
  { value: "low_sodium", label: "Low Sodium" },
  { value: "high_protein", label: "High Protein" },
  { value: "other", label: "Other" },
];

const TEXTURES = [
  { value: "normal", label: "Normal" },
  { value: "minced", label: "Minced" },
  { value: "pureed", label: "Pureed" },
  { value: "liquid", label: "Liquid" },
];

const NRS_NUTRITIONAL = [
  { score: 0, label: "Normal nutritional status" },
  { score: 1, label: "Wt loss >5% in 3 months / intake 50-75%" },
  { score: 2, label: "Wt loss >5% in 2 months / BMI 18.5-20.5 / intake 25-50%" },
  { score: 3, label: "Wt loss >5% in 1 month / BMI <18.5 / intake <25%" },
];

const NRS_DISEASE = [
  { score: 0, label: "Normal requirements" },
  { score: 1, label: "Hip fracture / COPD / DM / Cirrhosis / HD" },
  { score: 2, label: "Major surgery / Stroke / Severe pneumonia" },
  { score: 3, label: "Head injury / ICU (APACHE >10) / BMT" },
];

const DietPage: React.FC = () => {
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [tab, setTab] = useState("screening");
  const [overduePatients, setOverduePatients] = useState<any[]>([]);
  const [kpis, setKpis] = useState({ screenedToday: 0, highRisk: 0, activeOrders: 0, overdue: 0 });

  // Screening state
  const [unscreenedPatients, setUnscreenedPatients] = useState<any[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<any | null>(null);
  const [nrsNutritional, setNrsNutritional] = useState(0);
  const [nrsDisease, setNrsDisease] = useState(0);
  const [weightKg, setWeightKg] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [screeningNotes, setScreeningNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Diet orders state
  const [dietOrders, setDietOrders] = useState<any[]>([]);
  const [orderPatientSearch, setOrderPatientSearch] = useState("");
  const [admittedPatients, setAdmittedPatients] = useState<any[]>([]);
  const [orderPatient, setOrderPatient] = useState<any | null>(null);
  const [dietType, setDietType] = useState("normal");
  const [texture, setTexture] = useState("normal");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [fluidRestriction, setFluidRestriction] = useState("");
  const [dietInstructions, setDietInstructions] = useState("");
  const [showKitchenDispatch, setShowKitchenDispatch] = useState(false);

  // Meal tracking state
  const [mealTrackingPatient, setMealTrackingPatient] = useState<any | null>(null);
  const [mealDeliveries, setMealDeliveries] = useState<Record<string, { consumed_percent: number; waste_reason: string }>>({});
  const [savingMeal, setSavingMeal] = useState(false);

  // Meal plans state
  const [mealPlanPatient, setMealPlanPatient] = useState<any | null>(null);
  const [planContent, setPlanContent] = useState("");
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [existingPlans, setExistingPlans] = useState<any[]>([]);

  const loadData = useCallback(async (hid: string) => {
    const today = new Date().toISOString().split("T")[0];

    // Load unscreened admitted patients
    const { data: admitted } = await supabase
      .from("admissions")
      .select("id, patient_id, ward_id, bed_id, admitted_at, admitting_diagnosis, patients(id, full_name, uhid, date_of_birth, gender, allergies), wards(ward_name), beds(bed_number)")
      .eq("hospital_id", hid)
      .eq("status", "admitted")
      .order("admitted_at", { ascending: true });

    const allAdmitted = admitted || [];
    setAdmittedPatients(allAdmitted);

    // Get screened admission IDs
    const { data: screenedIds } = await supabase
      .from("nutritional_screenings")
      .select("admission_id")
      .eq("hospital_id", hid);
    const screenedSet = new Set((screenedIds || []).map((s: any) => s.admission_id));

    const unscreened = allAdmitted.filter((a: any) => !screenedSet.has(a.id));
    setUnscreenedPatients(unscreened);

    // Overdue (>24hrs)
    const now = new Date();
    const overdue = unscreened.filter((a: any) => differenceInHours(now, new Date(a.admitted_at)) >= 24);
    setOverduePatients(overdue);

    // KPIs
    const { count: screenedToday } = await supabase
      .from("nutritional_screenings")
      .select("id", { count: "exact", head: true })
      .eq("hospital_id", hid)
      .gte("screened_at", today);

    const { count: highRisk } = await supabase
      .from("nutritional_screenings")
      .select("id", { count: "exact", head: true })
      .eq("hospital_id", hid)
      .in("risk_level", ["high", "very_high"]);

    const { count: activeOrders } = await supabase
      .from("diet_orders")
      .select("id", { count: "exact", head: true })
      .eq("hospital_id", hid)
      .eq("status", "active");

    setKpis({
      screenedToday: screenedToday || 0,
      highRisk: highRisk || 0,
      activeOrders: activeOrders || 0,
      overdue: overdue.length,
    });

    // Diet orders
    const { data: orders } = await supabase
      .from("diet_orders")
      .select("*, patients(full_name, uhid, allergies), wards:admissions(ward_id, wards(ward_name))")
      .eq("hospital_id", hid)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(50);
    setDietOrders(orders || []);
  }, []);

  useEffect(() => {
    const init = async () => {
      const { data: u } = await supabase.from("users").select("id, hospital_id").limit(1).maybeSingle();
      if (!u?.hospital_id) return;
      setHospitalId(u.hospital_id);
      setUserId(u.id);
      await loadData(u.hospital_id);
    };
    init();
  }, [loadData]);

  // ── BMI Calculation ──
  const bmi = weightKg && heightCm ? parseFloat((parseFloat(weightKg) / Math.pow(parseFloat(heightCm) / 100, 2)).toFixed(1)) : null;
  const bmiCategory = bmi ? (bmi < 18.5 ? "Underweight" : bmi < 25 ? "Normal" : bmi < 30 ? "Overweight" : "Obese") : null;

  // ── NRS Score ──
  const patientAge = selectedPatient?.patients?.date_of_birth
    ? Math.floor((Date.now() - new Date(selectedPatient.patients.date_of_birth).getTime()) / 31557600000)
    : 0;
  const ageAdj = patientAge >= 70 ? 1 : 0;
  const nrsTotal = nrsNutritional + nrsDisease + ageAdj;
  const riskLevel = nrsTotal >= 5 ? "very_high" : nrsTotal >= 3 ? "high" : nrsTotal >= 1 ? "moderate" : "low";
  const riskColor = riskLevel === "very_high" || riskLevel === "high" ? "text-destructive" : riskLevel === "moderate" ? "text-amber-600" : "text-emerald-600";

  // ── Save Screening ──
  const saveScreening = async () => {
    if (!hospitalId || !userId || !selectedPatient) return;
    setSaving(true);
    const needsReferral = riskLevel === "high" || riskLevel === "very_high";

    const { error } = await supabase.from("nutritional_screenings").insert({
      hospital_id: hospitalId,
      patient_id: selectedPatient.patient_id,
      admission_id: selectedPatient.id,
      screening_tool: "nrs_2002",
      screened_by: userId,
      nrs_nutritional_status: nrsNutritional,
      nrs_disease_severity: nrsDisease,
      nrs_age_adjustment: ageAdj,
      nrs_total_score: nrsTotal,
      bmi: bmi || null,
      weight_kg: weightKg ? parseFloat(weightKg) : null,
      height_cm: heightCm ? parseFloat(heightCm) : null,
      risk_level: riskLevel,
      dietitian_referral: needsReferral,
      referral_at: needsReferral ? new Date().toISOString() : null,
      notes: screeningNotes || null,
    } as any);

    if (error) { toast.error(error.message); setSaving(false); return; }

    logNABHEvidence(hospitalId, "NFS.1",
      `Nutritional screening completed: ${selectedPatient.patient_name || "Patient"}, Tool: NRS-2002, Risk: ${riskLevel}, NRS: ${nrsTotal}`);

    if (needsReferral) {
      await supabase.from("clinical_alerts").insert({
        hospital_id: hospitalId,
        patient_id: selectedPatient.patient_id,
        admission_id: selectedPatient.id,
        alert_type: "high_nutritional_risk",
        message: `High nutritional risk (NRS ${nrsTotal}) — ${selectedPatient.patients?.full_name}`,
        severity: "medium",
      } as any);
    }

    // Auto-bill dietitian screening consultation
    autoChargeService({
      hospitalId,
      patientId:     selectedPatient.patient_id,
      admissionId:   selectedPatient.id,   // nutritional screenings are always for admitted patients
      serviceName:   `Dietitian Assessment — NRS-2002 (Risk: ${riskLevel.replace("_"," ")})`,
      serviceModule: MODULE_DIETETICS,
      serviceDate:   new Date().toISOString().split("T")[0],
    }).catch(() => {});

    toast.success(`Screening saved — ${riskLevel.replace("_", " ")} risk`);
    setSelectedPatient(null);
    resetScreeningForm();
    await loadData(hospitalId);
    setSaving(false);
  };

  const resetScreeningForm = () => {
    setNrsNutritional(0);
    setNrsDisease(0);
    setWeightKg("");
    setHeightCm("");
    setScreeningNotes("");
  };

  // ── Save Diet Order ──
  const saveDietOrder = async () => {
    if (!hospitalId || !userId || !orderPatient) { toast.error("Select a patient"); return; }
    setSaving(true);
    const allergies = orderPatient.patients?.allergies;

    const { error } = await supabase.from("diet_orders").insert({
      hospital_id: hospitalId,
      patient_id: orderPatient.patient_id,
      admission_id: orderPatient.id,
      ordered_by: userId,
      diet_type: dietType,
      texture,
      calories_target: calories ? parseInt(calories) : null,
      protein_target: protein ? parseFloat(protein) : null,
      fluid_restriction_ml: fluidRestriction ? parseInt(fluidRestriction) : null,
      food_allergies: allergies ? (Array.isArray(allergies) ? allergies : [allergies]) : [],
      specific_instructions: dietInstructions || null,
    } as any);

    if (error) { toast.error(error.message); setSaving(false); return; }
    toast.success("Diet order saved — kitchen notified");
    setOrderPatient(null);
    setDietType("normal");
    setTexture("normal");
    setCalories("");
    setProtein("");
    setFluidRestriction("");
    setDietInstructions("");
    await loadData(hospitalId);
    setSaving(false);
  };

  // ── AI Meal Plan ──
  const generateMealPlan = async () => {
    if (!hospitalId || !userId || !mealPlanPatient) return;
    setGeneratingPlan(true);

    try {
      // Find active diet order for patient
      const { data: orderData } = await supabase
        .from("diet_orders")
        .select("*")
        .eq("hospital_id", hospitalId)
        .eq("admission_id", mealPlanPatient.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();

      const dietOrder: any = orderData || {};

      const response = await callAI({
        featureKey: "meal_plan_ai",
        hospitalId,
        prompt: `You are a clinical dietitian at an Indian hospital.
Generate a practical 7-day therapeutic meal plan.

Patient Details:
- Diagnosis: ${mealPlanPatient.admitting_diagnosis || "General"}
- Diet type: ${dietOrder.diet_type || "normal"}
- Calories target: ${dietOrder.calories_target || 1800} kcal/day
- Protein target: ${dietOrder.protein_target || 60} g/day
- Fluid restriction: ${dietOrder.fluid_restriction_ml || "None"} mL
- Food allergies: ${dietOrder.food_allergies?.join(", ") || "None"}
- BMI: ${mealPlanPatient.bmi || "Not recorded"}

Create a 7-day meal plan using common Indian hospital foods.
Include: Breakfast, Mid-morning snack, Lunch, Evening snack, Dinner.

Format as:
DAY 1:
Breakfast: ...
Mid-morning: ...
Lunch: ...
Evening: ...
Dinner: ...
Calories: ~{N} kcal | Protein: ~{N}g

Keep it practical for a hospital kitchen.
Use Indian foods: idli, dal, rice, roti, khichdi etc.
Note any special preparations for the diet type.`,
        maxTokens: 800,
      });

      if (response.error || !response.text) {
        toast.error(response.error || "AI returned an empty meal plan. Check API configuration.");
        return;
      }

      await supabase.from("diet_plans").insert({
        hospital_id: hospitalId,
        patient_id: mealPlanPatient.patient_id,
        admission_id: mealPlanPatient.id,
        created_by: userId,
        diagnosis: mealPlanPatient.admitting_diagnosis || null,
        plan_for_days: 7,
        plan_content: response.text,
        ai_generated: true,
      } as any);

      setPlanContent(response.text);
      toast.success("7-day meal plan generated");
    } catch (err: any) {
      toast.error("AI generation failed: " + (err?.message || "Unknown error"));
    } finally {
      setGeneratingPlan(false);
    }
  };

  const loadMealDeliveries = async (admissionId: string) => {
    if (!hospitalId) return;
    const today = new Date().toISOString().split("T")[0];
    const { data } = await (supabase as any).from("meal_deliveries")
      .select("*")
      .eq("hospital_id", hospitalId)
      .eq("admission_id", admissionId)
      .eq("meal_date", today);
    const map: Record<string, { consumed_percent: number; waste_reason: string }> = {};
    (data || []).forEach((d: any) => {
      map[d.meal_type] = { consumed_percent: d.consumed_percent || 0, waste_reason: d.waste_reason || "" };
    });
    setMealDeliveries(map);
  };

  const saveMealEntry = async (mealType: string) => {
    if (!hospitalId || !userId || !mealTrackingPatient) return;
    setSavingMeal(true);
    const today = new Date().toISOString().split("T")[0];
    const entry = mealDeliveries[mealType] || { consumed_percent: 0, waste_reason: "" };
    const dietOrder = dietOrders.find((o: any) => o.admission_id === mealTrackingPatient.admission_id);
    const { data: existing } = await (supabase as any).from("meal_deliveries")
      .select("id")
      .eq("hospital_id", hospitalId)
      .eq("admission_id", mealTrackingPatient.admission_id)
      .eq("meal_date", today)
      .eq("meal_type", mealType)
      .maybeSingle();
    if (existing) {
      await (supabase as any).from("meal_deliveries")
        .update({ consumed_percent: entry.consumed_percent, waste_reason: entry.waste_reason || null })
        .eq("id", existing.id);
    } else {
      await (supabase as any).from("meal_deliveries").insert({
        hospital_id: hospitalId,
        diet_order_id: dietOrder?.id || null,
        patient_id: mealTrackingPatient.patient_id,
        admission_id: mealTrackingPatient.admission_id,
        meal_date: today,
        meal_type: mealType,
        delivered_at: new Date().toISOString(),
        consumed_percent: entry.consumed_percent,
        waste_reason: entry.waste_reason || null,
        delivered_by: userId,
      });
    }
    toast.success(`${mealType.replace("_", " ")} recorded`);
    setSavingMeal(false);
  };

  const kpiCards = [
    { label: "Screened Today", value: kpis.screenedToday, color: "text-primary", bg: "bg-primary/5" },
    { label: "High Risk", value: kpis.highRisk, color: "text-destructive", bg: "bg-destructive/5" },
    { label: "Active Diet Orders", value: kpis.activeOrders, color: "text-emerald-600", bg: "bg-emerald-50" },
    { label: "Overdue Screenings", value: kpis.overdue, color: "text-amber-600", bg: "bg-amber-50" },
  ];

  const filteredAdmittedForOrder = orderPatientSearch.length >= 2
    ? admittedPatients.filter((a: any) =>
        a.patients?.full_name?.toLowerCase().includes(orderPatientSearch.toLowerCase()) ||
        a.patients?.uhid?.toLowerCase().includes(orderPatientSearch.toLowerCase())
      )
    : [];

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      {/* NABH Alert Banner */}
      {overduePatients.length > 0 && (
        <div className="bg-destructive/5 border-b-2 border-destructive px-4 py-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span className="text-xs font-bold text-destructive">
              NABH COP.21 BREACH: {overduePatients.length} patient{overduePatients.length > 1 ? "s" : ""} admitted &gt;24hrs without nutritional screening
            </span>
          </div>
          <div className="flex gap-3 mt-1 overflow-x-auto">
            {overduePatients.slice(0, 5).map((p: any) => (
              <button key={p.id} onClick={() => { setSelectedPatient(p); setTab("screening"); }}
                className="text-[10px] bg-destructive/10 rounded px-2 py-1 flex-shrink-0 hover:bg-destructive/20">
                {p.patients?.full_name} · {p.wards?.ward_name || "—"} · {differenceInHours(new Date(), new Date(p.admitted_at))}hrs ago
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card" style={{ height: 52 }}>
        <h1 className="text-base font-bold text-foreground">🥗 Dietetics & Nutrition</h1>
        <div className="flex gap-2">
          <Button size="sm" className="h-8 text-xs" onClick={() => { setTab("orders"); setOrderPatient(null); }}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New Diet Order
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setTab("screening"); setSelectedPatient(null); }}>
            <Stethoscope className="h-3.5 w-3.5 mr-1" /> Screening
          </Button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-3 px-4 py-2" style={{ height: 72 }}>
        {kpiCards.map(k => (
          <div key={k.label} className={`${k.bg} rounded-lg p-3 flex flex-col justify-center`}>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">{k.label}</p>
            <p className={`text-xl font-bold ${k.color} font-mono`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-4 mt-1 w-fit">
          <TabsTrigger value="screening" className="text-xs gap-1"><Stethoscope className="h-3 w-3" /> Screening</TabsTrigger>
          <TabsTrigger value="orders" className="text-xs gap-1"><Utensils className="h-3 w-3" /> Diet Orders</TabsTrigger>
          <TabsTrigger value="tracking" className="text-xs gap-1"><ClipboardCheck className="h-3 w-3" /> Meal Tracking</TabsTrigger>
          <TabsTrigger value="plans" className="text-xs gap-1"><Bot className="h-3 w-3" /> Meal Plans</TabsTrigger>
          <TabsTrigger value="reports" className="text-xs gap-1"><BarChart3 className="h-3 w-3" /> Reports</TabsTrigger>
        </TabsList>

        {/* ═══ TAB 1: SCREENING ═══ */}
        <TabsContent value="screening" className="flex-1 overflow-hidden m-0 px-4 py-2">
          <div className="flex gap-4 h-full">
            {/* Left: Patients needing screening */}
            <div className="w-[300px] flex-shrink-0 overflow-y-auto space-y-2">
              <p className="text-xs font-bold text-foreground mb-1">Patients Needing Screening ({unscreenedPatients.length})</p>
              {unscreenedPatients.map((a: any) => {
                const hrs = differenceInHours(new Date(), new Date(a.admitted_at));
                const urgent = hrs >= 24;
                return (
                  <button key={a.id} onClick={() => { setSelectedPatient(a); resetScreeningForm(); }}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${selectedPatient?.id === a.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}>
                    <p className="text-xs font-bold text-foreground">{a.patients?.full_name}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{a.patients?.uhid}</p>
                    <p className="text-[10px] text-muted-foreground">{a.wards?.ward_name} · Bed {a.beds?.bed_number}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge className={`text-[9px] ${urgent ? "bg-destructive/10 text-destructive" : "bg-amber-100 text-amber-800"}`}>
                        {hrs}hrs ago
                      </Badge>
                      {urgent && <span className="text-[9px] text-destructive font-bold">OVERDUE</span>}
                    </div>
                  </button>
                );
              })}
              {unscreenedPatients.length === 0 && (
                <div className="text-center text-xs text-muted-foreground py-8">✅ All patients screened</div>
              )}
            </div>

            {/* Right: NRS-2002 Form */}
            <div className="flex-1 overflow-y-auto">
              {selectedPatient ? (
                <Card className="p-4 border-border space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-foreground">NRS-2002 Screening</h3>
                      <p className="text-[10px] text-muted-foreground">{selectedPatient.patients?.full_name} · {selectedPatient.patients?.uhid} · {selectedPatient.admitting_diagnosis || "—"}</p>
                    </div>
                    {patientAge >= 70 && <Badge className="bg-amber-100 text-amber-800 text-[9px]">Age ≥70 (+1)</Badge>}
                  </div>

                  {/* Nutritional Status Score */}
                  <div>
                    <p className="text-xs font-semibold text-foreground mb-1">Nutritional Status Score (0-3)</p>
                    <div className="space-y-1">
                      {NRS_NUTRITIONAL.map(n => (
                        <label key={n.score} className={`flex items-center gap-2 p-2 rounded cursor-pointer text-xs transition-colors ${nrsNutritional === n.score ? "bg-primary/10 border border-primary" : "hover:bg-muted/30"}`}>
                          <input type="radio" name="nrsNut" checked={nrsNutritional === n.score} onChange={() => setNrsNutritional(n.score)} className="accent-primary" />
                          <span className="font-mono font-bold w-4">{n.score}</span> {n.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Disease Severity Score */}
                  <div>
                    <p className="text-xs font-semibold text-foreground mb-1">Disease Severity Score (0-3)</p>
                    <div className="space-y-1">
                      {NRS_DISEASE.map(n => (
                        <label key={n.score} className={`flex items-center gap-2 p-2 rounded cursor-pointer text-xs transition-colors ${nrsDisease === n.score ? "bg-primary/10 border border-primary" : "hover:bg-muted/30"}`}>
                          <input type="radio" name="nrsDis" checked={nrsDisease === n.score} onChange={() => setNrsDisease(n.score)} className="accent-primary" />
                          <span className="font-mono font-bold w-4">{n.score}</span> {n.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Total Score */}
                  <div className="bg-muted/30 rounded-lg p-4 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">NRS-2002 Total Score</p>
                    <p className={`text-4xl font-bold font-mono ${riskColor}`}>{nrsTotal}</p>
                    <Badge className={`mt-1 text-xs ${riskLevel === "very_high" || riskLevel === "high" ? "bg-destructive/10 text-destructive" : riskLevel === "moderate" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                      {riskLevel.replace("_", " ").toUpperCase()} RISK
                    </Badge>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {nrsTotal >= 5 ? "Immediate dietitian referral + diet plan" :
                       nrsTotal >= 3 ? "Dietitian assessment needed" :
                       "No intervention, re-screen weekly"}
                    </p>
                  </div>

                  {/* BMI */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] text-muted-foreground">Weight (kg)</label>
                      <Input type="number" value={weightKg} onChange={e => setWeightKg(e.target.value)} className="h-8 text-xs" placeholder="65" />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Height (cm)</label>
                      <Input type="number" value={heightCm} onChange={e => setHeightCm(e.target.value)} className="h-8 text-xs" placeholder="170" />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">BMI</label>
                      <div className="h-8 flex items-center text-xs font-mono font-bold">
                        {bmi ? `${bmi} (${bmiCategory})` : "—"}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] text-muted-foreground">Notes</label>
                    <Textarea value={screeningNotes} onChange={e => setScreeningNotes(e.target.value)} className="text-xs h-16" placeholder="Additional observations..." />
                  </div>

                  <Button onClick={saveScreening} disabled={saving} className="w-full">
                    {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                    Save Screening
                  </Button>
                </Card>
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  ← Select a patient to begin screening
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ═══ TAB 2: DIET ORDERS ═══ */}
        <TabsContent value="orders" className="flex-1 overflow-hidden m-0 px-4 py-2">
          <div className="flex gap-4 h-full">
            {/* Left: Active orders */}
            <div className="w-[340px] flex-shrink-0 overflow-y-auto">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-foreground">Active Diet Orders ({dietOrders.length})</p>
                <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setShowKitchenDispatch(true)}>
                  <Printer className="h-3 w-3 mr-1" /> Kitchen Dispatch
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px]">Patient</TableHead>
                    <TableHead className="text-[10px]">Diet</TableHead>
                    <TableHead className="text-[10px]">Since</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dietOrders.map((o: any) => (
                    <TableRow key={o.id} className="cursor-pointer hover:bg-muted/30">
                      <TableCell className="text-[10px] font-medium">{o.patients?.full_name}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[9px]">{o.diet_type}</Badge></TableCell>
                      <TableCell className="text-[10px] font-mono">{format(new Date(o.valid_from), "dd/MM")}</TableCell>
                    </TableRow>
                  ))}
                  {dietOrders.length === 0 && (
                    <TableRow><TableCell colSpan={3} className="text-center text-xs text-muted-foreground py-6">No active orders</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Right: New diet order form */}
            <div className="flex-1 overflow-y-auto">
              <Card className="p-4 border-border space-y-4">
                <h3 className="text-sm font-bold text-foreground">New Diet Order</h3>

                {/* Patient search */}
                <div>
                  <label className="text-[10px] text-muted-foreground">Patient (search admitted)</label>
                  <Input value={orderPatientSearch} onChange={e => setOrderPatientSearch(e.target.value)} className="h-8 text-xs" placeholder="Search by name or UHID..." />
                  {filteredAdmittedForOrder.length > 0 && !orderPatient && (
                    <div className="border border-border rounded mt-1 max-h-32 overflow-y-auto">
                      {filteredAdmittedForOrder.map((a: any) => (
                        <button key={a.id} className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted/30 border-b border-border last:border-0"
                          onClick={() => { setOrderPatient(a); setOrderPatientSearch(a.patients?.full_name || ""); }}>
                          {a.patients?.full_name} · {a.patients?.uhid} · {a.wards?.ward_name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {orderPatient && (
                  <>
                    {/* Allergy banner */}
                    {orderPatient.patients?.allergies && (
                      <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-2">
                        <p className="text-xs text-destructive font-bold">⚠️ Food Allergies: {Array.isArray(orderPatient.patients.allergies) ? orderPatient.patients.allergies.join(", ") : orderPatient.patients.allergies}</p>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-muted-foreground">Diet Type</label>
                        <Select value={dietType} onValueChange={setDietType}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{DIET_TYPES.map(d => <SelectItem key={d.value} value={d.value} className="text-xs">{d.label}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">Texture</label>
                        <Select value={texture} onValueChange={setTexture}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{TEXTURES.map(t => <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-[10px] text-muted-foreground">Calories (kcal/day)</label>
                        <Input type="number" value={calories} onChange={e => setCalories(e.target.value)} className="h-8 text-xs" placeholder="1800" />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">Protein (g/day)</label>
                        <Input type="number" value={protein} onChange={e => setProtein(e.target.value)} className="h-8 text-xs" placeholder="60" />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">Fluid (mL/day)</label>
                        <Input type="number" value={fluidRestriction} onChange={e => setFluidRestriction(e.target.value)} className="h-8 text-xs" placeholder="Optional" />
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] text-muted-foreground">Specific Instructions</label>
                      <Textarea value={dietInstructions} onChange={e => setDietInstructions(e.target.value)} className="text-xs h-16" placeholder="e.g. Low salt, no fried foods..." />
                    </div>

                    <Button onClick={saveDietOrder} disabled={saving} className="w-full">
                      {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                      Save Diet Order
                    </Button>
                  </>
                )}
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ═══ TAB: MEAL TRACKING ═══ */}
        <TabsContent value="tracking" className="flex-1 overflow-hidden m-0 px-4 py-2">
          <div className="flex gap-4 h-full">
            <div className="w-[260px] flex-shrink-0 overflow-y-auto space-y-2">
              <p className="text-xs font-bold text-foreground mb-1">Patients with Active Diet Orders ({dietOrders.length})</p>
              {dietOrders.map((o: any) => (
                <button key={o.id}
                  onClick={() => { setMealTrackingPatient(o); loadMealDeliveries(o.admission_id); }}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${mealTrackingPatient?.id === o.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}>
                  <p className="text-xs font-bold text-foreground">{o.patients?.full_name}</p>
                  <Badge variant="outline" className="text-[9px] mt-0.5 capitalize">{o.diet_type?.replace("_", " ")}</Badge>
                </button>
              ))}
              {dietOrders.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-8">No active diet orders</p>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              {mealTrackingPatient ? (
                <Card className="p-4 border-border space-y-3">
                  <div>
                    <h3 className="text-sm font-bold">{mealTrackingPatient.patients?.full_name}</h3>
                    <p className="text-[10px] text-muted-foreground capitalize">{mealTrackingPatient.diet_type?.replace("_", " ")} diet · {new Date().toLocaleDateString("en-IN")}</p>
                  </div>
                  {["breakfast", "mid_morning", "lunch", "evening", "dinner"].map(mealType => {
                    const entry = mealDeliveries[mealType] || { consumed_percent: 0, waste_reason: "" };
                    return (
                      <div key={mealType} className="border border-border rounded-lg p-3 space-y-2">
                        <p className="text-xs font-semibold capitalize">{mealType.replace("_", " ")}</p>
                        <div className="flex gap-1.5">
                          {[0, 25, 50, 75, 100].map(v => (
                            <button key={v}
                              onClick={() => setMealDeliveries(prev => ({ ...prev, [mealType]: { ...entry, consumed_percent: v } }))}
                              className={`flex-1 py-1.5 rounded text-[11px] font-medium border transition-colors ${entry.consumed_percent === v ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted/30 text-foreground"}`}>
                              {v}%
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-2 items-center">
                          <Input
                            placeholder="Waste reason (optional)"
                            value={entry.waste_reason}
                            onChange={e => setMealDeliveries(prev => ({ ...prev, [mealType]: { ...entry, waste_reason: e.target.value } }))}
                            className="h-7 text-xs flex-1"
                          />
                          <Button size="sm" className="h-7 text-xs px-3" disabled={savingMeal} onClick={() => saveMealEntry(mealType)}>
                            Save
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </Card>
              ) : (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                  Select a patient to record meal consumption
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ═══ TAB 3: AI MEAL PLANS ═══ */}
        <TabsContent value="plans" className="flex-1 overflow-hidden m-0 px-4 py-2">
          <div className="flex gap-4 h-full">
            <div className="w-[300px] flex-shrink-0 overflow-y-auto space-y-2">
              <p className="text-xs font-bold text-foreground mb-1">Patients with Diet Orders</p>
              {dietOrders.map((o: any) => (
                <button key={o.id} onClick={() => { setMealPlanPatient({ ...o, patient_id: o.patient_id, admitting_diagnosis: o.specific_instructions }); setPlanContent(""); }}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${mealPlanPatient?.id === o.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}>
                  <p className="text-xs font-bold text-foreground">{o.patients?.full_name}</p>
                  <Badge variant="outline" className="text-[9px] mt-1">{o.diet_type}</Badge>
                </button>
              ))}
              {dietOrders.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-8">No active diet orders</div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {mealPlanPatient ? (
                <div className="space-y-3">
                  <Card className="p-3 border-border">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-foreground">{mealPlanPatient.patients?.full_name}</p>
                        <p className="text-[10px] text-muted-foreground">Diet: {mealPlanPatient.diet_type} · Cal: {mealPlanPatient.calories_target || "—"} kcal · Prot: {mealPlanPatient.protein_target || "—"}g</p>
                      </div>
                      <Button size="sm" className="h-8 text-xs" onClick={generateMealPlan} disabled={generatingPlan}>
                        {generatingPlan ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Bot className="h-3.5 w-3.5 mr-1" />}
                        Generate 7-Day Plan
                      </Button>
                    </div>
                  </Card>

                  {planContent && (
                    <Card className="p-4 border-border">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-bold text-foreground">🤖 AI Therapeutic Meal Plan</h3>
                        <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => {
                          const { printDocument } = require("@/lib/printUtils");
                          printDocument("AI Therapeutic Meal Plan", `<h2 style="color:#1A2F5A">AI Therapeutic Meal Plan</h2><pre>${planContent}</pre>`);
                        }}>
                          <Printer className="h-3 w-3 mr-1" /> Print
                        </Button>
                      </div>
                      <pre className="text-xs whitespace-pre-wrap text-foreground leading-relaxed font-sans">{planContent}</pre>
                    </Card>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  ← Select a patient to generate a meal plan
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ═══ TAB 4: REPORTS ═══ */}
        <TabsContent value="reports" className="flex-1 overflow-hidden m-0 px-4 py-2">
          <ReportsTab hospitalId={hospitalId} />
        </TabsContent>
      </Tabs>

      {/* Kitchen Dispatch Modal */}
      {showKitchenDispatch && (
        <Dialog open onOpenChange={() => setShowKitchenDispatch(false)}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle className="text-sm">📋 Today's Kitchen Dispatch</DialogTitle></DialogHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px]">Patient</TableHead>
                  <TableHead className="text-[10px]">Ward / Bed</TableHead>
                  <TableHead className="text-[10px]">Diet Type</TableHead>
                  <TableHead className="text-[10px]">Texture</TableHead>
                  <TableHead className="text-[10px]">Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dietOrders.map((o: any) => (
                  <TableRow key={o.id}>
                    <TableCell className="text-[10px] font-medium">{o.patients?.full_name}</TableCell>
                    <TableCell className="text-[10px]">—</TableCell>
                    <TableCell><Badge variant="outline" className="text-[9px]">{o.diet_type}</Badge></TableCell>
                    <TableCell className="text-[10px]">{o.texture}</TableCell>
                    <TableCell className="text-[10px] max-w-[120px] truncate">{o.specific_instructions || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DialogFooter>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => {
                const { printDocument } = require("@/lib/printUtils");
                const rows = dietOrders.map((o: any) => `<tr><td>${o.patients?.full_name}</td><td>${o.diet_type}</td><td>${o.texture}</td><td>${o.specific_instructions || "—"}</td></tr>`).join("");
                printDocument("Kitchen Dispatch", `<h2 style="color:#1A2F5A">Today's Kitchen Dispatch</h2><table><tr><th>Patient</th><th>Diet Type</th><th>Texture</th><th>Notes</th></tr>${rows}</table>`);
              }}>
                <Printer className="h-3 w-3 mr-1" /> Print
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

// ── Reports Sub-Tab ──
const ReportsTab: React.FC<{ hospitalId: string | null }> = ({ hospitalId }) => {
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    if (!hospitalId) return;
    const load = async () => {
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

      const [totalAdm, screenedRes, highRiskRes] = await Promise.all([
        supabase.from("admissions").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).gte("admitted_at", monthStart).eq("status", "admitted"),
        supabase.from("nutritional_screenings").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).gte("screened_at", monthStart),
        supabase.from("nutritional_screenings").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).gte("screened_at", monthStart).in("risk_level", ["high", "very_high"]),
      ]);

      const total = totalAdm.count || 0;
      const screened = screenedRes.count || 0;
      const highRisk = highRiskRes.count || 0;

      setStats({
        totalAdmissions: total,
        screened,
        screeningRate: total > 0 ? ((screened / total) * 100).toFixed(1) : 0,
        highRisk,
      });
    };
    load();
  }, [hospitalId]);

  if (!stats) return <div className="text-xs text-muted-foreground text-center py-8">Loading...</div>;

  return (
    <div className="space-y-4 overflow-y-auto h-full">
      <Card className="p-4 border-border">
        <h3 className="text-sm font-bold text-foreground mb-3">NABH NFS Compliance — This Month</h3>
        <div className="grid grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold font-mono text-primary">{stats.screeningRate}%</p>
            <p className="text-[10px] text-muted-foreground">Screening Rate</p>
            <p className="text-[9px] text-muted-foreground">(Target: 100%)</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold font-mono text-foreground">{stats.totalAdmissions}</p>
            <p className="text-[10px] text-muted-foreground">Admissions</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold font-mono text-emerald-600">{stats.screened}</p>
            <p className="text-[10px] text-muted-foreground">Screened</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold font-mono text-destructive">{stats.highRisk}</p>
            <p className="text-[10px] text-muted-foreground">High Risk</p>
          </div>
        </div>
      </Card>

      <Card className="p-4 border-border">
        <h3 className="text-sm font-bold text-foreground mb-2">Compliance Summary</h3>
        <div className="bg-muted/30 rounded-lg p-3">
          <p className="text-xs text-foreground">
            {parseFloat(stats.screeningRate) >= 95
              ? "✅ Excellent — NABH COP.21 compliance maintained"
              : parseFloat(stats.screeningRate) >= 80
              ? "⚠️ Needs improvement — target 100% screening within 24hrs"
              : "🔴 Critical gap — immediate action required for NABH compliance"}
          </p>
        </div>
      </Card>
    </div>
  );
};

export default DietPage;
