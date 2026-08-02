import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertTriangle, CheckCircle2, Plus, Loader2, TrendingDown, Camera, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface Props {
  admissionId: string;
  patientId: string;
  hospitalId: string;
  userId: string;
}

const WOUND_TYPES = [
  { value: "pressure_injury", label: "Pressure Injury" },
  { value: "surgical", label: "Surgical Wound" },
  { value: "diabetic_foot", label: "Diabetic Foot Ulcer" },
  { value: "venous", label: "Venous Ulcer" },
  { value: "arterial", label: "Arterial Ulcer" },
  { value: "traumatic", label: "Traumatic Wound" },
  { value: "burn", label: "Burn" },
  { value: "other", label: "Other" },
];

const PI_STAGES = ["Stage I","Stage II","Stage III","Stage IV","Unstageable","Deep Tissue Pressure Injury (DTPI)"];
const WAGNER_GRADES = ["Grade 0 (intact skin)","Grade 1 (superficial ulcer)","Grade 2 (deep, no bone)","Grade 3 (deep + bone/tendon)","Grade 4 (partial foot gangrene)","Grade 5 (whole foot gangrene)"];

const BRADEN_SUBSCALES = [
  {
    id: "sensory_perception", label: "Sensory Perception", max: 4,
    options: [
      { v: "1", l: "1 — Completely limited" }, { v: "2", l: "2 — Very limited" },
      { v: "3", l: "3 — Slightly limited" }, { v: "4", l: "4 — No impairment" },
    ],
  },
  {
    id: "moisture", label: "Moisture", max: 4,
    options: [
      { v: "1", l: "1 — Constantly moist" }, { v: "2", l: "2 — Moist" },
      { v: "3", l: "3 — Occasionally moist" }, { v: "4", l: "4 — Rarely moist" },
    ],
  },
  {
    id: "activity", label: "Activity", max: 4,
    options: [
      { v: "1", l: "1 — Bedfast" }, { v: "2", l: "2 — Chairfast" },
      { v: "3", l: "3 — Walks occasionally" }, { v: "4", l: "4 — Walks frequently" },
    ],
  },
  {
    id: "mobility", label: "Mobility", max: 4,
    options: [
      { v: "1", l: "1 — Completely immobile" }, { v: "2", l: "2 — Very limited" },
      { v: "3", l: "3 — Slightly limited" }, { v: "4", l: "4 — No limitation" },
    ],
  },
  {
    id: "nutrition_score", label: "Nutrition", max: 4,
    options: [
      { v: "1", l: "1 — Very poor" }, { v: "2", l: "2 — Probably inadequate" },
      { v: "3", l: "3 — Adequate" }, { v: "4", l: "4 — Excellent" },
    ],
  },
  {
    id: "friction_shear", label: "Friction & Shear", max: 3,
    options: [
      { v: "1", l: "1 — Problem" }, { v: "2", l: "2 — Potential problem" }, { v: "3", l: "3 — No apparent problem" },
    ],
  },
];

export default function WoundCareTab({ admissionId, patientId, hospitalId, userId }: Props) {
  const { toast } = useToast();
  const [assessments, setAssessments] = useState<any[]>([]);
  const [bradenList, setBradenList]   = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [showAssessForm, setShowAssessForm] = useState(false);
  const [showBradenForm, setShowBradenForm] = useState(false);

  // Wound photo upload — wound-photos is a private Storage bucket, resolved to a short-lived
  // signed URL for display (nursing module completion plan, Phase 4).
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    wound_type: "pressure_injury", location: "", stage: "", length_cm: "", width_cm: "", depth_cm: "",
    tissue_type: "granulation", exudate_amount: "minimal", exudate_type: "serous",
    periwound: "", odour: "false", pain_score: "0",
    cleansing_agent: "", dressing_type: "", dressing_frequency: "", next_review_date: "", notes: "",
  });

  const [bradenForm, setBradenForm] = useState({
    sensory_perception: "4", moisture: "4", activity: "4",
    mobility: "4", nutrition_score: "4", friction_shear: "3",
  });

  const fetch = useCallback(async () => {
    setLoading(true);
    const [assessRes, bradenRes] = await Promise.all([
      (supabase as any).from("wound_assessments").select("*")
        .eq("admission_id", admissionId).eq("hospital_id", hospitalId)
        .order("assessed_at", { ascending: false }),
      (supabase as any).from("braden_scale_assessments").select("*")
        .eq("admission_id", admissionId).eq("hospital_id", hospitalId)
        .order("assessed_at", { ascending: false }),
    ]);
    setAssessments(assessRes.data || []);
    setBradenList(bradenRes.data || []);
    setLoading(false);
  }, [admissionId, hospitalId]);

  useEffect(() => { fetch(); }, [fetch]);

  // Resolve signed URLs for any assessment photos not yet resolved in this session.
  useEffect(() => {
    const toResolve = assessments.filter((a) => a.wound_photo_url && !photoUrls[a.id]);
    if (toResolve.length === 0) return;
    (async () => {
      const entries = await Promise.all(
        toResolve.map(async (a) => {
          const { data } = await supabase.storage.from("wound-photos").createSignedUrl(a.wound_photo_url, 3600);
          return [a.id, data?.signedUrl] as const;
        })
      );
      setPhotoUrls((prev) => {
        const next = { ...prev };
        for (const [id, url] of entries) if (url) next[id] = url;
        return next;
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessments]);

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "Photo too large", description: "Maximum 10MB allowed", variant: "destructive" });
      return;
    }
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const clearPhoto = () => {
    setPhotoFile(null);
    setPhotoPreview(null);
    if (photoInputRef.current) photoInputRef.current.value = "";
  };

  const bradenTotal = Object.values(bradenForm).reduce((s, v) => s + parseInt(v || "0"), 0);
  const bradenRisk = bradenTotal <= 9 ? "Very High Risk (≤9)" : bradenTotal <= 12 ? "High Risk (10–12)" : bradenTotal <= 14 ? "Moderate Risk (13–14)" : bradenTotal <= 18 ? "Mild Risk (15–18)" : "No Risk (19–23)";
  const bradenColor = bradenTotal <= 9 ? "text-red-700" : bradenTotal <= 12 ? "text-red-600" : bradenTotal <= 14 ? "text-amber-600" : "text-green-600";

  const saveAssessment = async () => {
    if (!form.location) return;
    setSaving(true);

    let woundPhotoPath: string | null = null;
    if (photoFile) {
      setUploadingPhoto(true);
      const path = `${hospitalId}/${admissionId}/${Date.now()}_${photoFile.name}`;
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from("wound-photos")
        .upload(path, photoFile);
      setUploadingPhoto(false);
      if (uploadErr) {
        setSaving(false);
        toast({ title: "Photo upload failed", description: uploadErr.message, variant: "destructive" });
        return;
      }
      woundPhotoPath = uploadData.path;
    }

    await (supabase as any).from("wound_assessments").insert({
      hospital_id: hospitalId, admission_id: admissionId, patient_id: patientId,
      assessed_by: userId,
      wound_type: form.wound_type, location: form.location, stage: form.stage || null,
      length_cm: form.length_cm ? parseFloat(form.length_cm) : null,
      width_cm: form.width_cm ? parseFloat(form.width_cm) : null,
      depth_cm: form.depth_cm ? parseFloat(form.depth_cm) : null,
      tissue_type: form.tissue_type, exudate_amount: form.exudate_amount,
      exudate_type: form.exudate_type, periwound: form.periwound || null,
      odour: form.odour === "true", pain_score: parseInt(form.pain_score),
      cleansing_agent: form.cleansing_agent || null,
      dressing_type: form.dressing_type || null,
      dressing_frequency: form.dressing_frequency || null,
      next_review_date: form.next_review_date || null,
      notes: form.notes || null,
      wound_photo_url: woundPhotoPath,
    });

    // NABH evidence for pressure injuries Stage III/IV
    if (form.wound_type === "pressure_injury" && ["Stage III","Stage IV","Unstageable"].includes(form.stage)) {
      await logNABHEvidence(hospitalId, "COP.4",
        `Pressure injury documented: ${form.stage} at ${form.location}. Wound assessment recorded with care plan.`,
        "partially_compliant");
    }

    setSaving(false);
    setShowAssessForm(false);
    clearPhoto();
    fetch();
    toast({ title: "Wound assessment saved" });
  };

  const saveBraden = async () => {
    setSaving(true);
    await (supabase as any).from("braden_scale_assessments").insert({
      hospital_id: hospitalId, admission_id: admissionId, assessed_by: userId,
      sensory_perception: parseInt(bradenForm.sensory_perception),
      moisture: parseInt(bradenForm.moisture),
      activity: parseInt(bradenForm.activity),
      mobility: parseInt(bradenForm.mobility),
      nutrition_score: parseInt(bradenForm.nutrition_score),
      friction_shear: parseInt(bradenForm.friction_shear),
    });
    setSaving(false);
    setShowBradenForm(false);
    fetch();
    toast({ title: `Braden Scale saved — Score ${bradenTotal}: ${bradenRisk}` });
  };

  // Healing trajectory chart (wound area over time)
  const healingData = assessments
    .filter(a => a.area_cm2)
    .map(a => ({ date: format(new Date(a.assessed_at), "dd/MM"), area: parseFloat(a.area_cm2) }))
    .reverse();

  const latestBraden = bradenList[0];

  return (
    <div className="h-full overflow-auto p-4">
      {loading ? (
        <div className="flex items-center justify-center h-32"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
      ) : (
        <Tabs defaultValue="assessments">
          <TabsList className="h-9 mb-4">
            <TabsTrigger value="assessments" className="text-[12px]">Wound Assessments ({assessments.length})</TabsTrigger>
            <TabsTrigger value="braden" className="text-[12px]">
              Braden Scale
              {latestBraden && <span className={cn("ml-1.5 text-[10px] font-bold", bradenColor.replace("text-", "text-"))}>{latestBraden.total_score}</span>}
            </TabsTrigger>
            {healingData.length > 1 && <TabsTrigger value="trajectory" className="text-[12px]">Healing Trend</TabsTrigger>}
          </TabsList>

          {/* ── Wound Assessments ── */}
          <TabsContent value="assessments" className="space-y-3">
            <div className="flex justify-between items-center">
              <p className="text-[12px] text-muted-foreground">{assessments.length} assessment(s) recorded</p>
              <Button size="sm" variant="outline" onClick={() => setShowAssessForm(!showAssessForm)} className="h-8 gap-1.5">
                <Plus size={12} /> New Assessment
              </Button>
            </div>

            {showAssessForm && (
              <div className="border border-border rounded-xl p-4 bg-muted/30 space-y-3">
                <p className="text-[12px] font-semibold text-foreground">Wound Assessment</p>

                {/* Wound photo — NABH requires photo documentation for pressure injuries */}
                <div>
                  <label className="text-[11px] text-muted-foreground">Wound Photo</label>
                  <input ref={photoInputRef} type="file" accept="image/*" capture="environment"
                    className="hidden" onChange={handlePhotoSelect} />
                  {photoPreview ? (
                    <div className="mt-1 flex items-center gap-3 bg-card border border-border rounded-lg p-2">
                      <img src={photoPreview} alt="Wound photo preview" className="w-16 h-16 rounded object-cover" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-foreground truncate">{photoFile?.name}</p>
                        <p className="text-[10px] text-muted-foreground">{photoFile ? (photoFile.size / 1024).toFixed(0) : 0} KB</p>
                      </div>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={clearPhoto}>
                        <X size={14} />
                      </Button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => photoInputRef.current?.click()}
                      className="mt-1 w-full h-12 rounded-lg border-2 border-dashed border-border hover:border-primary/50 transition-colors flex items-center justify-center gap-2 text-[12px] text-muted-foreground">
                      <Camera size={16} /> Tap to add a wound photo
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-muted-foreground">Wound Type *</label>
                    <Select value={form.wound_type} onValueChange={v => setForm(p => ({ ...p, wound_type: v, stage: "" }))}>
                      <SelectTrigger className="h-9 mt-1 text-[12px]"><SelectValue /></SelectTrigger>
                      <SelectContent>{WOUND_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Location *</label>
                    <Input value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} className="h-9 mt-1 text-[12px]" placeholder="e.g. Sacrum, L heel" />
                  </div>

                  {/* Staging */}
                  {(form.wound_type === "pressure_injury" || form.wound_type === "diabetic_foot") && (
                    <div className="col-span-2">
                      <label className="text-[11px] text-muted-foreground">
                        {form.wound_type === "diabetic_foot" ? "Wagner Grade" : "Pressure Injury Stage"}
                      </label>
                      <Select value={form.stage} onValueChange={v => setForm(p => ({ ...p, stage: v }))}>
                        <SelectTrigger className="h-9 mt-1 text-[12px]"><SelectValue placeholder="Select stage…" /></SelectTrigger>
                        <SelectContent>
                          {(form.wound_type === "diabetic_foot" ? WAGNER_GRADES : PI_STAGES).map(s => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Dimensions */}
                  {["length_cm","width_cm","depth_cm"].map(d => (
                    <div key={d}>
                      <label className="text-[11px] text-muted-foreground">{d.replace("_cm", "").charAt(0).toUpperCase() + d.replace("_cm", "").slice(1)} (cm)</label>
                      <Input type="number" step="0.1" value={(form as any)[d]} onChange={e => setForm(p => ({ ...p, [d]: e.target.value }))} className="h-9 mt-1 text-[12px]" />
                    </div>
                  ))}

                  <div>
                    <label className="text-[11px] text-muted-foreground">Tissue Type</label>
                    <Select value={form.tissue_type} onValueChange={v => setForm(p => ({ ...p, tissue_type: v }))}>
                      <SelectTrigger className="h-9 mt-1 text-[12px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["epithelial","granulation","slough","eschar","necrotic","mixed"].map(t => (
                          <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="text-[11px] text-muted-foreground">Exudate Amount</label>
                    <Select value={form.exudate_amount} onValueChange={v => setForm(p => ({ ...p, exudate_amount: v }))}>
                      <SelectTrigger className="h-9 mt-1 text-[12px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["none","minimal","moderate","heavy"].map(e => (
                          <SelectItem key={e} value={e} className="capitalize">{e}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="text-[11px] text-muted-foreground">Pain Score (0–10)</label>
                    <Input type="number" min={0} max={10} value={form.pain_score} onChange={e => setForm(p => ({ ...p, pain_score: e.target.value }))} className="h-9 mt-1 text-[12px]" />
                  </div>

                  <div>
                    <label className="text-[11px] text-muted-foreground">Odour</label>
                    <Select value={form.odour} onValueChange={v => setForm(p => ({ ...p, odour: v }))}>
                      <SelectTrigger className="h-9 mt-1 text-[12px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="false">No</SelectItem>
                        <SelectItem value="true">Yes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="col-span-2">
                    <label className="text-[11px] text-muted-foreground">Periwound Condition</label>
                    <Input value={form.periwound} onChange={e => setForm(p => ({ ...p, periwound: e.target.value }))} className="h-9 mt-1 text-[12px]" placeholder="e.g. Macerated, erythematous" />
                  </div>

                  <div>
                    <label className="text-[11px] text-muted-foreground">Cleansing Agent</label>
                    <Input value={form.cleansing_agent} onChange={e => setForm(p => ({ ...p, cleansing_agent: e.target.value }))} className="h-9 mt-1 text-[12px]" placeholder="Normal saline" />
                  </div>

                  <div>
                    <label className="text-[11px] text-muted-foreground">Dressing Type</label>
                    <Input value={form.dressing_type} onChange={e => setForm(p => ({ ...p, dressing_type: e.target.value }))} className="h-9 mt-1 text-[12px]" placeholder="Hydrocolloid, foam, etc." />
                  </div>

                  <div>
                    <label className="text-[11px] text-muted-foreground">Dressing Frequency</label>
                    <Input value={form.dressing_frequency} onChange={e => setForm(p => ({ ...p, dressing_frequency: e.target.value }))} className="h-9 mt-1 text-[12px]" placeholder="Every 3 days" />
                  </div>

                  <div>
                    <label className="text-[11px] text-muted-foreground">Next Review Date</label>
                    <Input type="date" value={form.next_review_date} onChange={e => setForm(p => ({ ...p, next_review_date: e.target.value }))} className="h-9 mt-1 text-[12px]" />
                  </div>

                  <div className="col-span-2">
                    <label className="text-[11px] text-muted-foreground">Notes</label>
                    <Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} className="mt-1 text-[12px]" />
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setShowAssessForm(false); clearPhoto(); }} className="h-8">Cancel</Button>
                  <Button size="sm" onClick={saveAssessment} disabled={saving || !form.location} className="h-8 gap-1.5">
                    {saving ? <Loader2 size={12} className="animate-spin" /> : null}
                    {uploadingPhoto ? "Uploading photo…" : "Save Assessment"}
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {assessments.map(a => (
                <div key={a.id} className={cn("border rounded-xl p-3", a.wound_type === "pressure_injury" && ["Stage III","Stage IV","Unstageable"].includes(a.stage) ? "border-red-200 bg-red-50/30" : "border-border")}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[13px] font-semibold">{WOUND_TYPES.find(t => t.value === a.wound_type)?.label || a.wound_type}</p>
                        {a.stage && <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium", ["Stage III","Stage IV","Unstageable"].includes(a.stage) ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200")}>{a.stage}</span>}
                      </div>
                      <p className="text-[12px] text-muted-foreground">📍 {a.location}</p>
                      {a.length_cm && a.width_cm && (
                        <p className="text-[11px] text-muted-foreground">{a.length_cm}×{a.width_cm}cm{a.depth_cm ? `×${a.depth_cm}cm` : ""} · Area: {a.area_cm2?.toFixed(1)} cm²</p>
                      )}
                      <div className="flex gap-3 mt-1 text-[11px] text-muted-foreground flex-wrap">
                        {a.tissue_type && <span>Tissue: {a.tissue_type}</span>}
                        {a.exudate_amount && <span>Exudate: {a.exudate_amount}</span>}
                        {a.pain_score > 0 && <span>Pain: {a.pain_score}/10</span>}
                      </div>
                      {a.dressing_type && <p className="text-[11px] text-muted-foreground">Dressing: {a.dressing_type} · {a.dressing_frequency}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <p className="text-[10px] text-muted-foreground">{format(new Date(a.assessed_at), "dd/MM HH:mm")}</p>
                      {a.wound_photo_url && (
                        photoUrls[a.id] ? (
                          <img src={photoUrls[a.id]} alt="Wound photo" title="Click to view full size"
                            className="w-14 h-14 rounded-lg object-cover border border-border cursor-pointer"
                            onClick={() => window.open(photoUrls[a.id], "_blank", "noopener,noreferrer")} />
                        ) : (
                          <div className="w-14 h-14 rounded-lg bg-muted animate-pulse" />
                        )
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {assessments.length === 0 && (
                <p className="text-[13px] text-muted-foreground text-center py-6">No wound assessments recorded.</p>
              )}
            </div>
          </TabsContent>

          {/* ── Braden Scale ── */}
          <TabsContent value="braden" className="space-y-4">
            {latestBraden && (
              <div className={cn("border rounded-xl p-4", latestBraden.total_score <= 12 ? "bg-red-50 border-red-200" : latestBraden.total_score <= 14 ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200")}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-semibold">Latest Braden Score: {latestBraden.total_score} / 23</p>
                    <p className={cn("text-[12px]", latestBraden.total_score <= 12 ? "text-red-700" : latestBraden.total_score <= 14 ? "text-amber-700" : "text-green-700")}>
                      {latestBraden.total_score <= 9 ? "⚠ Very High Risk — reposition every 2 hrs"
                        : latestBraden.total_score <= 12 ? "⚠ High Risk — reposition every 2 hrs"
                        : latestBraden.total_score <= 14 ? "Moderate Risk — reposition every 4 hrs"
                        : "Mild/No Risk — monitor weekly"}
                    </p>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{format(new Date(latestBraden.assessed_at), "dd/MM/yyyy")}</p>
                </div>
              </div>
            )}

            <div className="flex justify-between items-center">
              <p className="text-[12px] text-muted-foreground">{bradenList.length} assessment(s)</p>
              <Button size="sm" variant="outline" onClick={() => setShowBradenForm(!showBradenForm)} className="h-8 gap-1.5">
                <Plus size={12} /> Assess Now
              </Button>
            </div>

            {showBradenForm && (
              <div className="border border-border rounded-xl p-4 bg-muted/30 space-y-3">
                {BRADEN_SUBSCALES.map(s => (
                  <div key={s.id}>
                    <label className="text-[12px] font-medium text-foreground block mb-1.5">{s.label} (max {s.max})</label>
                    <Select value={(bradenForm as any)[s.id]} onValueChange={v => setBradenForm(p => ({ ...p, [s.id]: v }))}>
                      <SelectTrigger className="h-9 text-[12px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {s.options.map(o => <SelectItem key={o.v} value={o.v} className="text-[12px]">{o.l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}

                <div className={cn("border rounded-xl p-3 text-center", bradenTotal <= 12 ? "bg-red-50 border-red-200" : bradenTotal <= 14 ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200")}>
                  <p className="text-[24px] font-bold">{bradenTotal} / 23</p>
                  <p className={cn("text-[12px] font-semibold", bradenColor)}>{bradenRisk}</p>
                </div>

                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => setShowBradenForm(false)} className="h-8">Cancel</Button>
                  <Button size="sm" onClick={saveBraden} disabled={saving} className="h-8">Save Braden Scale</Button>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── Healing Trajectory ── */}
          {healingData.length > 1 && (
            <TabsContent value="trajectory" className="space-y-3">
              <p className="text-[12px] text-muted-foreground">Wound surface area trend (cm²) — decreasing area = healing</p>
              <div className="bg-card border border-border rounded-xl p-4">
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={healingData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} unit=" cm²" />
                    <Tooltip formatter={(v: number) => [`${v} cm²`, "Area"]} />
                    <Line type="monotone" dataKey="area" stroke="#ef4444" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {healingData.length >= 2 && (() => {
                const first = healingData[0].area;
                const last = healingData[healingData.length - 1].area;
                const pct = ((first - last) / first * 100).toFixed(1);
                const healing = last < first;
                return (
                  <div className={cn("flex items-center gap-2 p-3 rounded-xl border text-[13px] font-medium", healing ? "bg-green-50 border-green-200 text-green-700" : "bg-red-50 border-red-200 text-red-700")}>
                    {healing ? <TrendingDown size={16} /> : <AlertTriangle size={16} />}
                    {healing ? `Wound reduced by ${pct}% since first assessment` : `Wound area has increased by ${Math.abs(parseFloat(pct))}% — review plan`}
                  </div>
                );
              })()}
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
