import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { useHospitalId } from "@/hooks/useHospitalId";
import { formatINRExact } from "@/lib/currency";
import ComponentPicker, { type PickerOption } from "./ComponentPicker";
import {
  DEFAULT_MINS,
  componentsTotal,
  packageDiscountPercent,
  type PackageComponent,
  type PackageComponentType,
  type PackageComponentSource,
} from "@/lib/packageComponents";

interface Props { open: boolean; onClose: () => void; }

/** The three masters a package is composed from. Order matches the UI. */
const SOURCES: {
  key: PackageComponentType;
  source: PackageComponentSource;
  label: string;
  placeholder: string;
  emptyHint: string;
}[] = [
  {
    key: "lab_test", source: "lab_test_master",
    label: "Lab tests", placeholder: "Select lab tests…",
    emptyHint: "No lab tests configured. Add them in Settings → Lab Test Master.",
  },
  {
    key: "radiology", source: "radiology_study_master",
    label: "Radiology studies", placeholder: "Select radiology studies…",
    emptyHint: "No studies configured. Add them in Settings → Radiology Modalities.",
  },
  {
    key: "consultation", source: "service_master",
    label: "OPD consultation", placeholder: "Select consultations…",
    emptyHint: "No consultation fees configured. Add them in Settings → Services.",
  },
];

export default function CreatePackageModal({ open, onClose }: Props) {
  const { hospitalId } = useHospitalId();
  const [form, setForm] = useState({
    package_name: "", package_code: "", package_type: "basic",
    description: "", target_gender: "both", min_age: "",
    max_age: "", price: "", estimated_hours: "",
  });
  const [saving, setSaving] = useState(false);
  const [loadingMasters, setLoadingMasters] = useState(false);

  // Options per picker, and the ids chosen in each. Ids are kept in selection order so the
  // checkup runs in the sequence the person building the package intended.
  const [options, setOptions] = useState<Record<PackageComponentType, PickerOption[]>>({
    lab_test: [], radiology: [], consultation: [], service: [],
  });
  const [picked, setPicked] = useState<Record<PackageComponentType, string[]>>({
    lab_test: [], radiology: [], consultation: [], service: [],
  });

  useEffect(() => {
    if (!open || !hospitalId) return;
    let cancelled = false;
    setLoadingMasters(true);
    (async () => {
      const [labRes, radRes, consultRes] = await Promise.all([
        (supabase as any).from("lab_test_master")
          .select("id, test_name, test_code, fee")
          .eq("hospital_id", hospitalId).eq("is_active", true).order("test_name"),
        (supabase as any).from("radiology_study_master")
          .select("id, study_name, modality_type, fee")
          .eq("hospital_id", hospitalId).eq("is_active", true).order("sort_order"),
        // OPD consultation fees live on service_master, not on departments or users — see
        // the doctor→department→global ladder in WalkInModal.
        (supabase as any).from("service_master")
          .select("id, name, fee, department_id, doctor_id")
          .eq("hospital_id", hospitalId).eq("item_type", "consultation")
          .eq("is_active", true).order("name"),
      ]);
      if (cancelled) return;
      setOptions({
        lab_test: ((labRes.data as any[]) || []).map((t) => ({
          id: t.id, name: t.test_name, fee: Number(t.fee) || 0, detail: t.test_code,
        })),
        radiology: ((radRes.data as any[]) || []).map((s) => ({
          id: s.id, name: s.study_name, fee: Number(s.fee) || 0, detail: s.modality_type,
        })),
        // A doctor-specific consultation row is a personal override, not a package building
        // block — a package promises "a physician consultation", not one named doctor.
        consultation: ((consultRes.data as any[]) || [])
          .filter((c) => !c.doctor_id)
          .map((c) => ({ id: c.id, name: c.name, fee: Number(c.fee) || 0, detail: null })),
        service: [],
      });
      setLoadingMasters(false);
    })();
    return () => { cancelled = true; };
  }, [open, hospitalId]);

  const toggle = (type: PackageComponentType, o: PickerOption) => {
    setPicked((prev) => {
      const has = prev[type].includes(o.id);
      return { ...prev, [type]: has ? prev[type].filter((id) => id !== o.id) : [...prev[type], o.id] };
    });
  };
  const remove = (type: PackageComponentType, id: string) => {
    setPicked((prev) => ({ ...prev, [type]: prev[type].filter((x) => x !== id) }));
  };

  /** The jsonb payload, assembled in picker order: lab → radiology → consultation. */
  const components: PackageComponent[] = useMemo(() => {
    const out: PackageComponent[] = [];
    for (const s of SOURCES) {
      for (const id of picked[s.key]) {
        const o = options[s.key].find((x) => x.id === id);
        if (!o) continue;
        out.push({
          name: o.name,
          type: s.key,
          estimated_mins: DEFAULT_MINS[s.key],
          sequence: out.length + 1,
          source_id: o.id,
          source_table: s.source,
          fee: Number(o.fee) || 0,
        });
      }
    }
    return out;
  }, [picked, options]);

  const worth = componentsTotal(components);
  const priceNum = form.price === "" ? null : Number(form.price);
  const discount = priceNum !== null ? packageDiscountPercent(worth, priceNum) : null;
  const overpriced = priceNum !== null && worth > 0 && priceNum > worth;

  const canSave = !!form.package_name.trim() && !!form.package_code.trim()
    && form.price !== "" && components.length > 0;

  const save = async () => {
    if (!form.package_name.trim() || !form.package_code.trim() || form.price === "") {
      toast.error("Name, code, and price are required");
      return;
    }
    if (components.length === 0) {
      toast.error("Add at least one component from lab, radiology or consultation");
      return;
    }
    setSaving(true);
    const totalMins = components.reduce((s, c) => s + (c.estimated_mins || 0), 0);
    const { error } = await supabase.from("health_packages").insert([{
      hospital_id: hospitalId,
      package_name: form.package_name.trim(),
      package_code: form.package_code.trim(),
      package_type: form.package_type,
      description: form.description || null,
      target_gender: form.target_gender,
      min_age: form.min_age ? +form.min_age : null,
      max_age: form.max_age ? +form.max_age : null,
      price: +form.price,
      estimated_hours: form.estimated_hours
        ? +form.estimated_hours
        : totalMins > 0 ? +(totalMins / 60).toFixed(1) : null,
      components: components as any,
      total_components: components.length,
    }] as never);
    setSaving(false);
    if (error) { toast.error("Failed: " + error.message); return; }
    toast.success("Package created");
    setPicked({ lab_test: [], radiology: [], consultation: [], service: [] });
    onClose();
  };

  const types = ["basic", "essential", "comprehensive", "executive", "senior_citizen", "pre_marital", "corporate", "custom"];

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Create Health Package</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Package Name *</Label><Input value={form.package_name} onChange={(e) => setForm({ ...form, package_name: e.target.value })} /></div>
            <div><Label>Code *</Label><Input value={form.package_code} onChange={(e) => setForm({ ...form, package_code: e.target.value })} placeholder="PKG-CUSTOM" /></div>
            <div>
              <Label>Type</Label>
              <Select value={form.package_type} onValueChange={(v) => setForm({ ...form, package_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{types.map((t) => <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Gender</Label>
              <Select value={form.target_gender} onValueChange={(v) => setForm({ ...form, target_gender: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Both</SelectItem>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Price (₹) *</Label><Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
            <div><Label>Estimated Hours</Label><Input type="number" step="0.5" value={form.estimated_hours} onChange={(e) => setForm({ ...form, estimated_hours: e.target.value })} placeholder={components.length ? `auto: ${(components.reduce((s, c) => s + c.estimated_mins, 0) / 60).toFixed(1)}` : ""} /></div>
            <div><Label>Min Age</Label><Input type="number" value={form.min_age} onChange={(e) => setForm({ ...form, min_age: e.target.value })} /></div>
            <div><Label>Max Age</Label><Input type="number" value={form.max_age} onChange={(e) => setForm({ ...form, max_age: e.target.value })} /></div>
          </div>
          <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} /></div>

          {/* Components — picked from the masters, never typed. A component that doesn't
              resolve to a master row can never become a real order at booking. */}
          <div className="border rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="font-semibold">Components ({components.length}) *</Label>
              {form.target_gender !== "both" && (
                <span className="text-[11px] text-muted-foreground">
                  {form.target_gender === "male" ? "Male" : "Female"} package
                  {form.min_age || form.max_age ? ` · age ${form.min_age || "0"}–${form.max_age || "∞"}` : ""}
                </span>
              )}
            </div>

            {SOURCES.map((s) => (
              <ComponentPicker
                key={s.key}
                label={s.label}
                placeholder={s.placeholder}
                options={options[s.key]}
                selectedIds={picked[s.key]}
                onToggle={(o) => toggle(s.key, o)}
                onRemove={(id) => remove(s.key, id)}
                loading={loadingMasters}
                emptyHint={s.emptyHint}
              />
            ))}

            {components.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Pick at least one item from lab, radiology or consultation.
              </p>
            ) : (
              <div className="text-xs border-t pt-2 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Components worth</span>
                  <span className="font-mono font-medium">{formatINRExact(worth)}</span>
                </div>
                {priceNum !== null && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Package price</span>
                    <span className="font-mono font-medium">{formatINRExact(priceNum)}</span>
                  </div>
                )}
                {discount !== null && (
                  <p className="text-emerald-700 font-medium">
                    {discount}% off — patient saves {formatINRExact(worth - (priceNum || 0))}
                  </p>
                )}
                {/* A package that costs more than its own contents is almost always a typo. */}
                {overpriced && (
                  <p className="flex items-start gap-1 text-amber-700">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                    Package price is above the components total — a package is normally sold at a
                    discount to its parts.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={saving || !canSave}>
              {saving ? "Creating..." : "Create Package"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
