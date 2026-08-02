import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, X, BedDouble, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Constants } from "@/integrations/supabase/types";
import { useCapacityCheck } from "@/hooks/useCapacityCheck";
import { getWardNursingRates, setWardNursingRate } from "@/lib/wardNursingRate";

const wardTypes = Constants.public.Enums.ward_type;

interface WardTemplate { label: string; icon: string; type: string; beds: number }
const TEMPLATES: WardTemplate[] = [
  { label: "General Ward", icon: "🏥", type: "general", beds: 20 },
  { label: "Private Rooms", icon: "🔒", type: "private", beds: 10 },
  { label: "ICU", icon: "❤️", type: "icu", beds: 6 },
  { label: "NICU", icon: "👶", type: "nicu", beds: 4 },
  { label: "Maternity Ward", icon: "🤰", type: "maternity", beds: 10 },
  { label: "Emergency", icon: "⚡", type: "emergency", beds: 8 },
];

const SettingsWardsPage: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { checkBedCapacity } = useCapacityCheck();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", type: "general", total_beds: "10", rate_per_day: "", nursing_rate_per_day: "", bed_prefix: "", bed_start: "1", gst_applicable: false, gst_percent: "0" });
  const [selectedTemplates, setSelectedTemplates] = useState<Set<number>>(new Set());
  const [templateBeds, setTemplateBeds] = useState<Record<number, string>>({});
  const [managingWard, setManagingWard] = useState<{ id: string; name: string } | null>(null);
  const [addCount, setAddCount] = useState("1");

  const { data: wards, isLoading } = useQuery({
    queryKey: ["settings-wards"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("wards").select("id, name, type, total_beds, is_active, rate_per_day, gst_applicable, gst_percent").order("name");
      if (error) throw error;
      return data;
    },
  });

  // Fetched separately, never folded into the ward select above: on a database that has
  // not had migration 20261011000091 applied, naming the column takes the WHOLE query
  // down (PostgREST 42703) and this page renders "no wards configured" over a full ward
  // list. See lib/wardNursingRate.ts.
  const { data: nursingRates } = useQuery({
    queryKey: ["settings-ward-nursing-rates"],
    queryFn: getWardNursingRates,
  });

  const { data: bedStats } = useQuery({
    queryKey: ["settings-bed-stats"],
    queryFn: async () => {
      const { data, error } = await supabase.from("beds").select("id, ward_id, status, is_active").eq("is_active", true);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: wardBeds } = useQuery({
    queryKey: ["settings-ward-beds", managingWard?.id],
    enabled: !!managingWard,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("beds")
        .select("id, bed_number, status, is_active, bed_category, oxygen_equipped, has_monitor, is_ac")
        .eq("ward_id", managingWard!.id).order("bed_number");
      if (error) throw error;
      return data;
    },
  });

  const totalBeds = bedStats?.length ?? 0;
  const availableBeds = bedStats?.filter((b) => b.status === "available").length ?? 0;
  const wardBedCounts = (wardId: string) => {
    const wb = bedStats?.filter((b) => b.ward_id === wardId) ?? [];
    return { total: wb.length, occupied: wb.filter((b) => b.status === "occupied").length };
  };

  const getHospitalId = async () => {
    const { data } = await supabase.from("users").select("hospital_id").limit(1).maybeSingle();
    if (!data) throw new Error("No hospital context");
    return data.hospital_id;
  };

  const createWardWithBeds = async (hid: string, name: string, type: string, bedCount: number, ratePerDay?: number, bedPrefix?: string, bedStart?: number, gstApplicable?: boolean, gstPercent?: number, nursingRatePerDay?: number) => {
    const wardPayload: any = { hospital_id: hid, name, type: type as any, total_beds: bedCount };
    if (ratePerDay && ratePerDay > 0) wardPayload.rate_per_day = ratePerDay;
    if (gstApplicable) { wardPayload.gst_applicable = true; wardPayload.gst_percent = gstPercent || 0; }
    const { data: ward, error } = await supabase.from("wards").insert(wardPayload).select("id").maybeSingle();
    if (error) throw error;
    // Separate write — a deployment without the nursing-rate column must still be able to
    // create wards. setWardNursingRate reports failure instead of throwing.
    if (nursingRatePerDay && nursingRatePerDay > 0) await setWardNursingRate(ward.id, nursingRatePerDay);
    const prefix = bedPrefix?.trim() || name.replace(/[^A-Za-z]/g, "").substring(0, 3).toUpperCase();
    const start = bedStart || 1;
    const padLen = String(start + bedCount - 1).length < 2 ? 2 : String(start + bedCount - 1).length;
    const bedRows = Array.from({ length: bedCount }, (_, i) => ({
      hospital_id: hid, ward_id: ward.id,
      bed_number: `${prefix}-${String(start + i).padStart(padLen, "0")}`,
      status: "available" as const,
    }));
    await supabase.from("beds").insert(bedRows);
    return ward;
  };

  const saveWard = useMutation({
    mutationFn: async () => {
      const hid = await getHospitalId();
      const beds = parseInt(form.total_beds);
      if (!beds || beds <= 0) throw new Error("Bed count must be at least 1.");
      const rate = parseFloat(form.rate_per_day) || 0;
      // Blank stays 0 — nursing is bundled into room rent unless the hospital opts in.
      const nursingRate = parseFloat(form.nursing_rate_per_day) || 0;
      // Check bed capacity before creating new ward with beds
      if (!editingId) {
        const capacity = await checkBedCapacity(beds);
        if (!capacity.allowed) {
          throw new Error(
            `Adding ${beds} beds would exceed your plan limit (${capacity.current}/${capacity.max} beds on ${capacity.plan_slug} plan). Upgrade at Settings → Plan & Billing to add more beds.`
          );
        }
      }
      const gstPercent = form.gst_applicable ? (parseFloat(form.gst_percent) || 0) : 0;
      if (editingId) {
        const updatePayload: any = {
          name: form.name, type: form.type as any, total_beds: beds, rate_per_day: rate,
          gst_applicable: form.gst_applicable, gst_percent: gstPercent,
        };
        const { error } = await supabase.from("wards").update(updatePayload).eq("id", editingId);
        if (error) throw error;
        // Separate, non-fatal write — see createWardWithBeds.
        await setWardNursingRate(editingId, nursingRate);
      } else {
        await createWardWithBeds(hid, form.name, form.type, beds, rate, form.bed_prefix, parseInt(form.bed_start) || 1, form.gst_applicable, gstPercent, nursingRate);
      }
    },
    onSuccess: () => {
      toast({ title: `Ward ${editingId ? "updated" : `added with ${form.total_beds} beds`}` });
      qc.invalidateQueries({ queryKey: ["settings-wards"] });
      qc.invalidateQueries({ queryKey: ["settings-bed-stats"] });
      qc.invalidateQueries({ queryKey: ["settings-ward-nursing-rates"] });
      closeDrawer();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const bulkTemplates = useMutation({
    mutationFn: async () => {
      const hid = await getHospitalId();
      const selectedIdx = Array.from(selectedTemplates);
      const bedsPerTemplate = selectedIdx.map((i) => {
        const n = parseInt(templateBeds[i] ?? "", 10);
        return !n || n < 1 ? TEMPLATES[i].beds : n;
      });
      const totalBedsToAdd = bedsPerTemplate.reduce((sum, n) => sum + n, 0);
      const capacity = await checkBedCapacity(totalBedsToAdd);
      if (!capacity.allowed) {
        throw new Error(
          `Creating these wards adds ${totalBedsToAdd} beds, exceeding your plan limit (${capacity.current}/${capacity.max} beds on ${capacity.plan_slug} plan). Upgrade at Settings → Plan & Billing to add more beds.`
        );
      }
      for (let j = 0; j < selectedIdx.length; j++) {
        const t = TEMPLATES[selectedIdx[j]];
        await createWardWithBeds(hid, t.label, t.type, bedsPerTemplate[j]);
      }
      return selectedIdx.length;
    },
    onSuccess: (count) => {
      toast({ title: `${count} wards created with beds` });
      qc.invalidateQueries({ queryKey: ["settings-wards"] });
      qc.invalidateQueries({ queryKey: ["settings-bed-stats"] });
      setSelectedTemplates(new Set());
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateBedStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("beds").update({ status: status as any }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings-ward-beds"] });
      qc.invalidateQueries({ queryKey: ["settings-bed-stats"] });
    },
  });

  const addMoreBeds = useMutation({
    mutationFn: async (count: number) => {
      if (!managingWard) return;
      const capacity = await checkBedCapacity(count);
      if (!capacity.allowed) {
        throw new Error(
          `Adding ${count} beds would exceed your plan limit (${capacity.current}/${capacity.max} beds on ${capacity.plan_slug} plan). Upgrade at Settings → Plan & Billing to add more beds.`
        );
      }
      const hid = await getHospitalId();
      const existing = wardBeds || [];
      // Detect existing pattern from last bed number
      let prefix = managingWard.name.replace(/[^A-Za-z]/g, "").substring(0, 3).toUpperCase();
      let nextNum = existing.length + 1;
      if (existing.length > 0) {
        const lastBed = existing[existing.length - 1].bed_number;
        const match = lastBed.match(/^(.+?)[-]?(\d+)$/);
        if (match) {
          prefix = match[1];
          nextNum = parseInt(match[2]) + 1;
        }
      }
      const padLen = String(nextNum + count - 1).length < 2 ? 2 : String(nextNum + count - 1).length;
      const rows = Array.from({ length: count }, (_, i) => ({
        hospital_id: hid, ward_id: managingWard.id,
        bed_number: `${prefix}-${String(nextNum + i).padStart(padLen, "0")}`,
        status: "available" as const,
      }));
      await supabase.from("beds").insert(rows);
      await supabase.from("wards").update({ total_beds: existing.length + count }).eq("id", managingWard.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings-ward-beds"] });
      qc.invalidateQueries({ queryKey: ["settings-wards"] });
      qc.invalidateQueries({ queryKey: ["settings-bed-stats"] });
      toast({ title: "Beds added" });
    },
  });

  const deleteBed = useMutation({
    mutationFn: async (bed: { id: string; status: string }) => {
      if (!managingWard) return;
      if (bed.status === "occupied") throw new Error("Cannot delete an occupied bed.");
      await (supabase as any).from("beds").delete().eq("id", bed.id);
      const remaining = Math.max((wardBeds?.length || 1) - 1, 0);
      await supabase.from("wards").update({ total_beds: remaining }).eq("id", managingWard.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings-ward-beds"] });
      qc.invalidateQueries({ queryKey: ["settings-wards"] });
      qc.invalidateQueries({ queryKey: ["settings-bed-stats"] });
      toast({ title: "Bed deleted" });
    },
    onError: (e: any) => toast({ title: e?.message || "Could not delete bed", variant: "destructive" }),
  });

  const openDrawer = (ward?: any) => {
    if (ward) {
      setEditingId(ward.id);
      setForm({
        name: ward.name, type: ward.type, total_beds: String(ward.total_beds),
        rate_per_day: ward.rate_per_day ? String(ward.rate_per_day) : "",
        nursing_rate_per_day: nursingRates?.[ward.id] ? String(nursingRates[ward.id]) : "",
        bed_prefix: "", bed_start: "1",
        gst_applicable: !!ward.gst_applicable, gst_percent: String(ward.gst_percent ?? "0"),
      });
    } else {
      setEditingId(null);
      setForm({ name: "", type: "general", total_beds: "10", rate_per_day: "", nursing_rate_per_day: "", bed_prefix: "", bed_start: "1", gst_applicable: false, gst_percent: "0" });
    }
    setDrawerOpen(true);
  };
  const closeDrawer = () => { setDrawerOpen(false); setEditingId(null); };

  const toggleTemplate = (i: number) => {
    setSelectedTemplates((prev) => { const s = new Set(prev); if (s.has(i)) s.delete(i); else s.add(i); return s; });
  };

  const typeColor = (t: string) => {
    if (t === "icu" || t === "hdu") return "bg-rose-50 text-rose-700";
    if (t === "private" || t === "semi_private") return "bg-violet-50 text-violet-700";
    if (t === "nicu" || t === "picu") return "bg-amber-50 text-amber-700";
    if (t === "emergency") return "bg-red-50 text-red-700";
    if (t === "maternity") return "bg-pink-50 text-pink-700";
    return "bg-blue-50 text-blue-700";
  };

  const showBanner = !isLoading && (wards?.length ?? 0) === 0;

  // Manage beds overlay
  if (managingWard) {
    return (
      <div className="h-[calc(100vh-56px)] flex flex-col overflow-hidden">
        <div className="flex-shrink-0 px-6 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setManagingWard(null)} className="text-muted-foreground hover:text-foreground active:scale-95"><ArrowLeft size={18} /></button>
            <div>
              <h1 className="text-lg font-bold text-foreground">{managingWard.name} — Beds</h1>
              <p className="text-xs text-muted-foreground">Settings › Wards › {managingWard.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={addCount}
              onChange={(e) => setAddCount(e.target.value)}
              className="h-9 w-20 rounded-lg border border-input bg-background px-2 text-sm"
              placeholder="Qty"
            />
            <button
              onClick={() => {
                const n = parseInt(addCount, 10);
                if (!n || n < 1) {
                  toast({ title: "Enter a valid number of beds", variant: "destructive" });
                  return;
                }
                addMoreBeds.mutate(n);
              }}
              disabled={addMoreBeds.isPending}
              className="flex items-center gap-1.5 bg-[hsl(222,55%,23%)] text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 active:scale-[0.97]">
              <Plus size={14} /> Add Beds
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-3 gap-3">
            {wardBeds?.map((bed: any) => {
              const statusColor = bed.status === "available" ? "border-emerald-200 bg-emerald-50"
                : bed.status === "occupied" ? "border-red-200 bg-red-50"
                : bed.status === "maintenance" ? "border-amber-200 bg-amber-50"
                : "border-border bg-muted/30";
              const updateBedField = async (field: string, value: any) => {
                await (supabase as any).from("beds").update({ [field]: value }).eq("id", bed.id);
                qc.invalidateQueries({ queryKey: ["settings-ward-beds"] });
              };
              return (
                <div key={bed.id} className={cn("rounded-lg border-[1.5px] p-3 space-y-2", statusColor)}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-foreground">{bed.bed_number}</p>
                    <button
                      onClick={() => {
                        if (bed.status === "occupied") {
                          toast({ title: "Cannot delete an occupied bed", variant: "destructive" });
                          return;
                        }
                        if (window.confirm(`Delete bed ${bed.bed_number}? This cannot be undone.`)) {
                          deleteBed.mutate({ id: bed.id, status: bed.status });
                        }
                      }}
                      disabled={deleteBed.isPending}
                      className="text-muted-foreground hover:text-red-600 active:scale-95"
                      title="Delete bed"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <select value={bed.status} onChange={(e) => updateBedStatus.mutate({ id: bed.id, status: e.target.value })}
                    className="h-7 w-full rounded border border-input bg-background px-2 text-xs">
                    <option value="available">Available</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="reserved">Reserved</option>
                    <option value="occupied" disabled>Occupied</option>
                  </select>
                  <select value={bed.bed_category || "general"} onChange={(e) => updateBedField("bed_category", e.target.value)}
                    className="h-7 w-full rounded border border-input bg-background px-2 text-xs">
                    <option value="general">General</option>
                    <option value="semi_private">Semi-Private</option>
                    <option value="private">Private</option>
                    <option value="icu">ICU</option>
                    <option value="nicu">NICU</option>
                    <option value="sicu">SICU</option>
                    <option value="picu">PICU</option>
                    <option value="hdu">HDU</option>
                    <option value="isolation">Isolation</option>
                  </select>
                  <div className="flex gap-3 text-[10px] text-muted-foreground">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input type="checkbox" checked={!!bed.oxygen_equipped} onChange={(e) => updateBedField("oxygen_equipped", e.target.checked)} className="rounded" />
                      O₂
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input type="checkbox" checked={!!bed.has_monitor} onChange={(e) => updateBedField("has_monitor", e.target.checked)} className="rounded" />
                      Monitor
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input type="checkbox" checked={!!bed.is_ac} onChange={(e) => updateBedField("is_ac", e.target.checked)} className="rounded" />
                      AC
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col overflow-hidden relative">
      {/* HEADER */}
      <div className="flex-shrink-0 px-6 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/settings")} className="text-muted-foreground hover:text-foreground active:scale-95"><ArrowLeft size={18} /></button>
          <div>
            <h1 className="text-lg font-bold text-foreground">Wards & Beds</h1>
            <p className="text-xs text-muted-foreground">Settings › Wards & Beds</p>
          </div>
        </div>
        <button onClick={() => openDrawer()} className="flex items-center gap-1.5 bg-[hsl(222,55%,23%)] text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 active:scale-[0.97]">
          <Plus size={14} /> Add Ward
        </button>
      </div>

      {/* STATS */}
      <div className="flex-shrink-0 px-6 pt-4 pb-2 grid grid-cols-3 gap-4">
        {[
          { label: "Total Wards", value: wards?.length ?? 0 },
          { label: "Total Beds", value: totalBeds },
          { label: "Available Beds", value: availableBeds },
        ].map((s) => (
          <div key={s.label} className="bg-card border border-border rounded-lg px-4 py-3">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="text-2xl font-bold text-foreground tabular-nums mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>

      {/* QUICK ADD BANNER */}
      {showBanner && (
        <div className="flex-shrink-0 mx-6 mt-2 bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-[13px] text-red-800 font-medium mb-3">No wards configured — IPD bed map will be empty</p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {TEMPLATES.map((t, i) => (
              <div key={i} onClick={() => toggleTemplate(i)}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2.5 rounded-lg border-[1.5px] text-left transition-colors active:scale-[0.98] cursor-pointer",
                  selectedTemplates.has(i) ? "border-[hsl(222,55%,23%)] bg-blue-50" : "border-border bg-card hover:border-muted-foreground/30"
                )}>
                <span className="text-lg">{t.icon}</span>
                <div className="flex-1">
                  <p className="text-[13px] font-medium text-foreground">{t.label}</p>
                  <div className="flex items-center gap-1 mt-0.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="number"
                      min={1}
                      value={templateBeds[i] ?? String(t.beds)}
                      onChange={(e) => setTemplateBeds((prev) => ({ ...prev, [i]: e.target.value }))}
                      className="h-6 w-14 rounded border border-input bg-background px-1.5 text-[11px]"
                    />
                    <span className="text-[11px] text-muted-foreground">beds</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => bulkTemplates.mutate()} disabled={selectedTemplates.size === 0 || bulkTemplates.isPending}
            className="bg-[hsl(222,55%,23%)] text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:opacity-90 active:scale-[0.97] disabled:opacity-40">
            {bulkTemplates.isPending ? "Creating..." : `Create Selected Wards (${selectedTemplates.size})`}
          </button>
        </div>
      )}

      {/* TABLE */}
      <div className="flex-1 overflow-y-auto">
        {!isLoading && (wards?.length ?? 0) === 0 && !showBanner ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center"><BedDouble size={24} className="text-muted-foreground" /></div>
            <p className="text-sm font-medium">No wards yet</p>
            <button onClick={() => openDrawer()} className="flex items-center gap-1.5 bg-[hsl(222,55%,23%)] text-white px-4 py-2 rounded-lg text-sm font-medium active:scale-[0.97]">
              <Plus size={14} /> Add First Ward
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/50 backdrop-blur-sm z-10">
              <tr className="text-left text-[11px] text-muted-foreground uppercase tracking-wider">
                <th className="px-6 py-2.5 font-medium">Ward Name</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Beds</th>
                <th className="px-4 py-2.5 font-medium">Occupancy</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">Loading...</td></tr>}
              {wards?.map((w) => {
                const bc = wardBedCounts(w.id);
                const pct = bc.total > 0 ? Math.round((bc.occupied / bc.total) * 100) : 0;
                const barColor = pct > 80 ? "bg-red-500" : pct > 50 ? "bg-amber-500" : "bg-emerald-500";
                return (
                  <tr key={w.id} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="px-6 py-3 font-medium text-foreground">{w.name}</td>
                    <td className="px-4 py-3">
                      <span className={cn("text-[11px] px-2 py-0.5 rounded-full font-medium capitalize", typeColor(w.type))}>{w.type.replace("_", " ")}</span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{bc.total}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className={cn("h-full rounded-full", barColor)} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[11px] text-muted-foreground tabular-nums">{bc.occupied}/{bc.total}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={cn("h-2 w-2 rounded-full", w.is_active ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                        <span className="text-[12px] text-muted-foreground">{w.is_active ? "Active" : "Inactive"}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openDrawer(w)} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted">Edit</button>
                        <button onClick={() => setManagingWard({ id: w.id, name: w.name })} className="text-xs text-primary px-2 py-1 rounded hover:bg-muted">Beds</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* DRAWER */}
      {drawerOpen && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={closeDrawer} />
          <div className="fixed right-0 top-0 bottom-0 w-[380px] bg-card border-l border-border z-50 flex flex-col shadow-xl animate-in slide-in-from-right duration-200">
            <div className="flex-shrink-0 px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-bold text-foreground">{editingId ? "Edit Ward" : "Add Ward"}</h2>
              <button onClick={closeDrawer} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Ward Name *</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="General Ward A" className="h-10" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Ward Type *</label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {wardTypes.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Rate Per Day (₹)</label>
                <Input type="number" min={0} value={form.rate_per_day} onChange={(e) => setForm({ ...form, rate_per_day: e.target.value })} placeholder="e.g. 1500" className="h-10" />
                <p className="text-[11px] text-muted-foreground mt-1">Per-day room charge for billing</p>
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Nursing Charge Per Day (₹)</label>
                <Input type="number" min={0} value={form.nursing_rate_per_day} onChange={(e) => setForm({ ...form, nursing_rate_per_day: e.target.value })} placeholder="Leave blank if included in room rate" className="h-10" />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Billed automatically for every day of stay in this ward. Leave blank for CGHS,
                  ESI, PM-JAY and TPA patients — those schemes require nursing to be included in
                  the room rent, and a separate line is deducted by the payer.
                </p>
              </div>
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.gst_applicable} onChange={(e) => setForm({ ...form, gst_applicable: e.target.checked })}
                    className="h-4 w-4 rounded border-input" />
                  <span className="text-sm text-foreground">Custom GST %</span>
                </label>
                {form.gst_applicable ? (
                  <>
                    <Input
                      type="number" min={0} max={100} step="0.01"
                      value={form.gst_percent}
                      onChange={(e) => setForm({ ...form, gst_percent: e.target.value })}
                      placeholder="e.g. 5"
                      className="h-10 mt-2"
                    />
                    <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-2 mt-1.5">
                      Overrides the automatic GST rule (ICU exempt; 5% above ₹5,000/day, else 0%) for this ward's room charges. Only turn this on if you have a specific reason to bill GST differently for this ward.
                    </p>
                  </>
                ) : (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    GST follows the automatic rule: ICU/NICU/PICU exempt; other wards 5% above ₹5,000/day, else 0%.
                  </p>
                )}
              </div>
              {!editingId && (
                <>
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Number of Beds *</label>
                    <Input type="number" min={1} max={200} value={form.total_beds} onChange={(e) => setForm({ ...form, total_beds: e.target.value })} className="h-10" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Bed Prefix</label>
                      <Input value={form.bed_prefix} onChange={(e) => setForm({ ...form, bed_prefix: e.target.value })} placeholder="e.g. G, 1, ICU" className="h-10" />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Start Number</label>
                      <Input type="number" min={1} value={form.bed_start} onChange={(e) => setForm({ ...form, bed_start: e.target.value })} className="h-10" />
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground -mt-2">
                    Preview: {(() => {
                      const prefix = form.bed_prefix?.trim() || form.name.replace(/[^A-Za-z]/g, "").substring(0, 3).toUpperCase() || "BED";
                      const start = parseInt(form.bed_start) || 1;
                      const count = parseInt(form.total_beds) || 1;
                      const padLen = String(start + count - 1).length < 2 ? 2 : String(start + count - 1).length;
                      return `${prefix}-${String(start).padStart(padLen, "0")}, ${prefix}-${String(start + 1).padStart(padLen, "0")} ... ${prefix}-${String(start + count - 1).padStart(padLen, "0")}`;
                    })()}
                  </p>
                </>
              )}
            </div>
            <div className="flex-shrink-0 px-6 py-4 border-t border-border flex gap-3">
              <button onClick={closeDrawer} className="flex-1 h-11 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted active:scale-[0.98]">Cancel</button>
              <button onClick={() => saveWard.mutate()} disabled={!form.name || saveWard.isPending}
                className="flex-[2] h-11 rounded-lg bg-[hsl(222,55%,23%)] text-white text-sm font-semibold hover:opacity-90 active:scale-[0.97] disabled:opacity-40">
                {saveWard.isPending ? "Saving..." : "Save Ward"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default SettingsWardsPage;
