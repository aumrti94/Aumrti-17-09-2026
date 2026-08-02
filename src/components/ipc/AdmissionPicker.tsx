import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getErrorMessage } from "@/lib/errorMessage";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { FormError } from "@/components/ui/FormError";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";

export interface AdmissionOption {
  admissionId: string;
  patientId: string;
  wardId: string | null;
  label: string;
  sublabel: string;
}

const ACTIVE_ADMISSION_LIMIT = 200;

/**
 * Picks an active admission.
 *
 * ipc_device_usage.admission_id and .patient_id are both NOT NULL, so device
 * surveillance cannot be recorded from the IPC module without one — this is what
 * lets the module populate its own denominators instead of depending entirely on
 * the IPD bedside tabs.
 */
export const AdmissionPicker: React.FC<{
  hospitalId: string;
  value: AdmissionOption | null;
  onChange: (option: AdmissionOption) => void;
  disabled?: boolean;
}> = ({ hospitalId, value, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<AdmissionOption[]>([]);
  const [truncated, setTruncated] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await (supabase as any)
        .from("admissions")
        .select("id, patient_id, ward_id, admitted_at, admission_number, wards(name), bed:beds(bed_number), patients!admissions_patient_id_fkey(full_name, uhid)")
        .eq("hospital_id", hospitalId)
        .eq("status", "active")
        .order("admitted_at", { ascending: false })
        .limit(ACTIVE_ADMISSION_LIMIT);

      if (err) { setError(getErrorMessage(err)); return; }

      const rows = data ?? [];
      setTruncated(rows.length >= ACTIVE_ADMISSION_LIMIT);
      setOptions(rows.map((r: any) => ({
        admissionId: r.id,
        patientId: r.patient_id,
        wardId: r.ward_id ?? null,
        label: r.patients?.full_name ?? "Unnamed patient",
        sublabel: [r.patients?.uhid, r.wards?.name, r.bed?.bed_number && `Bed ${r.bed.bed_number}`, r.admission_number]
          .filter(Boolean).join(" · "),
      })));
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [hospitalId]);

  useEffect(() => { if (open && options.length === 0 && !error) load(); }, [open, options.length, error, load]);

  return (
    <div className="space-y-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between h-9 font-normal"
          >
            <span className={cn("truncate", !value && "text-muted-foreground")}>
              {value ? `${value.label}${value.sublabel ? ` — ${value.sublabel}` : ""}` : "Select an active admission…"}
            </span>
            <ChevronsUpDown className="h-4 w-4 opacity-50 flex-shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search by name, UHID, ward or bed…" />
            <CommandList>
              {loading ? (
                <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading admissions…
                </div>
              ) : (
                <>
                  <CommandEmpty>No active admission matches.</CommandEmpty>
                  <CommandGroup>
                    {options.map(o => (
                      <CommandItem
                        key={o.admissionId}
                        value={`${o.label} ${o.sublabel}`}
                        onSelect={() => { onChange(o); setOpen(false); }}
                      >
                        <Check className={cn("mr-2 h-4 w-4", value?.admissionId === o.admissionId ? "opacity-100" : "opacity-0")} />
                        <div className="min-w-0">
                          <p className="text-sm truncate">{o.label}</p>
                          {o.sublabel && <p className="text-xs text-muted-foreground truncate">{o.sublabel}</p>}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <FormError message={error} />
      {truncated && !error && (
        <p className="text-[11px] text-amber-600">
          Showing the {ACTIVE_ADMISSION_LIMIT} most recent active admissions — refine your search if the patient is missing.
        </p>
      )}
    </div>
  );
};

export default AdmissionPicker;
