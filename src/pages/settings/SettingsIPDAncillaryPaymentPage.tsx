/**
 * Settings → IPD Ancillary Payment.
 *
 * Lets a hospital choose, per service, whether an admitted patient's pharmacy / lab /
 * radiology orders accrue to the discharge bill (post_paid, the default and today's
 * behaviour) or must be paid at the counter before the service is performed (pre_paid).
 *
 * SECURITY NOTE: hospital_settings has no per-role RLS — any authenticated user of the
 * hospital can write any key via PostgREST. The route guard (RG path="/settings") is the only
 * thing keeping this page to settings-permitted staff; the toggle is not itself enforcement.
 * The actual gate lives client-side in lib/ipdAncillaryGate.ts and its block points.
 */

import React from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useHospitalId } from "@/hooks/useHospitalId";
import {
  DEFAULT_IPD_ANCILLARY_POLICY,
  IPD_ANCILLARY_POLICY_KEY,
  IpdAncillaryPolicy,
  IpdAncillaryService,
  fetchIpdAncillaryPolicy,
  serialiseIpdAncillaryPolicy,
} from "@/lib/ipdAncillaryGate";

const SERVICES: { key: IpdAncillaryService; label: string; note?: string }[] = [
  { key: "pharmacy", label: "Pharmacy", note: "Auto-bypass for urgent orders does not apply — a dispense has no priority." },
  { key: "lab", label: "Laboratory" },
  { key: "radiology", label: "Radiology" },
];

const SettingsIPDAncillaryPaymentPage: React.FC = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const queryClient = useQueryClient();

  const { data: policy = DEFAULT_IPD_ANCILLARY_POLICY } = useQuery({
    queryKey: ["ipd-ancillary-policy", hospitalId],
    queryFn: () => fetchIpdAncillaryPolicy(hospitalId!),
    enabled: !!hospitalId,
  });

  const save = useMutation({
    mutationFn: async (next: IpdAncillaryPolicy) => {
      const { error } = await (supabase as any).from("hospital_settings").upsert({
        hospital_id: hospitalId!,
        key: IPD_ANCILLARY_POLICY_KEY,
        value: serialiseIpdAncillaryPolicy(next),
        updated_at: new Date().toISOString(),
      }, { onConflict: "hospital_id,key" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ipd-ancillary-policy"] });
      toast({ title: "Saved" });
    },
    onError: (err: any) => toast({ title: "Failed to save", description: err.message, variant: "destructive" }),
  });

  const update = (mutate: (p: IpdAncillaryPolicy) => IpdAncillaryPolicy) => save.mutate(mutate(policy));

  const overrideRolesText = policy.override.roles.join(", ");
  const urgentText = policy.override.urgentPriorities.join(", ");

  return (
    <SettingsPageWrapper title="IPD Ancillary Payment" hideSave>
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Choose, for each service, when an admitted patient pays for pharmacy, lab and
          radiology orders. <strong>Accrue to bill</strong> keeps the charge on the IPD bill to
          settle at discharge — the default. <strong>Pay before service</strong> sends the
          attendant to the billing counter first, and the sample / scan / dispense is held until
          it is paid.
        </p>

        {/* ── Per-service mode + receipt ─────────────────────────────────────── */}
        <div className="border border-border rounded-lg divide-y divide-border">
          {SERVICES.map(({ key, label, note }) => {
            const svc = policy[key];
            const prePaid = svc.mode === "pre_paid";
            return (
              <div key={key} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold">{label}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {prePaid ? "Pay before service" : "Accrue to the IPD bill"}
                      {prePaid && note ? ` — ${note}` : ""}
                    </p>
                  </div>
                  <Switch
                    checked={prePaid}
                    onCheckedChange={(v) =>
                      update((p) => ({ ...p, [key]: { ...p[key], mode: v ? "pre_paid" : "post_paid" } }))
                    }
                  />
                </div>

                {prePaid && (
                  <div className="flex flex-wrap items-center gap-4 pt-1 pl-1">
                    <span className="text-xs text-muted-foreground">Receipt:</span>
                    {(["consolidated", "separate"] as const).map((shape) => (
                      <label key={shape} className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <input
                          type="radio"
                          name={`receipt-${key}`}
                          checked={svc.receipt === shape}
                          onChange={() => update((p) => ({ ...p, [key]: { ...p[key], receipt: shape } }))}
                        />
                        {shape === "consolidated" ? "On the IPD bill" : "Separate receipt (recommended)"}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground -mt-3">
          <strong>Separate receipt</strong> is recommended for pay-before-service: an IPD advance
          deposit already prepays the bill, so putting counter-collected charges on the same bill
          can leave them hard to see. A separate receipt keeps each paid order clean.
        </p>

        {/* ── Override policy ────────────────────────────────────────────────── */}
        <div className="border border-border rounded-lg p-4 space-y-4 bg-muted/20">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold">Emergency override</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Let an authorised user release a blocked order by recording a reason. The charge
                still stands — an override frees the service, it does not waive the bill.
              </p>
            </div>
            <Switch
              checked={policy.override.allow}
              onCheckedChange={(v) => update((p) => ({ ...p, override: { ...p.override, allow: v } }))}
            />
          </div>

          {policy.override.allow && (
            <div className="space-y-4 pt-1">
              <div className="space-y-1">
                <Label className="text-xs">Roles allowed to override (comma-separated)</Label>
                <Input
                  className="h-8"
                  defaultValue={overrideRolesText}
                  onBlur={(e) => {
                    const roles = e.target.value.split(",").map((r) => r.trim()).filter(Boolean);
                    if (roles.join(",") !== policy.override.roles.join(","))
                      update((p) => ({ ...p, override: { ...p.override, roles } }));
                  }}
                />
              </div>

              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Auto-bypass urgent orders</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    A STAT / urgent lab or radiology order proceeds without waiting for payment.
                    It is still billed and still appears at the counter. (Pharmacy has no priority,
                    so this never applies to it.)
                  </p>
                </div>
                <Switch
                  checked={policy.override.autoBypassUrgent}
                  onCheckedChange={(v) => update((p) => ({ ...p, override: { ...p.override, autoBypassUrgent: v } }))}
                />
              </div>

              {policy.override.autoBypassUrgent && (
                <div className="space-y-1">
                  <Label className="text-xs">Priorities treated as urgent (comma-separated)</Label>
                  <Input
                    className="h-8"
                    defaultValue={urgentText}
                    onBlur={(e) => {
                      const list = e.target.value.split(",").map((r) => r.trim().toLowerCase()).filter(Boolean);
                      if (list.join(",") !== policy.override.urgentPriorities.join(","))
                        update((p) => ({ ...p, override: { ...p.override, urgentPriorities: list } }));
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </SettingsPageWrapper>
  );
};

export default SettingsIPDAncillaryPaymentPage;
