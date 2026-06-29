import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { QUICK_PICK_DEFAULTS } from "@/lib/quickPickDefaults";

export type QuickPickCategory =
  | "complaints"
  | "exam_findings"
  | "diagnoses"
  | "rx_templates"
  | "lab_templates"
  | "radiology_templates";

interface UseDoctorQuickPicksResult<T> {
  items: T[];
  isCustomized: boolean;
  isLoading: boolean;
  save: (items: T[]) => Promise<void>;
  reset: () => Promise<void>;
}

export function useDoctorQuickPicks<T = string>(
  category: QuickPickCategory
): UseDoctorQuickPicksResult<T> {
  const queryClient = useQueryClient();
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [identityLoading, setIdentityLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !alive) return;
        const { data: userData } = await supabase
          .from("users")
          .select("id, hospital_id")
          .eq("auth_user_id", user.id)
          .maybeSingle();
        if (!userData || !alive) return;
        setDoctorId(userData.id);
        setHospitalId(userData.hospital_id);
      } catch {
        // non-fatal — system defaults will be used
      } finally {
        if (alive) setIdentityLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const queryKey = ["doctor-quick-picks", doctorId, category] as const;

  const { data: dbItems, isLoading: queryLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("doctor_quick_picks")
        .select("items")
        .eq("doctor_id", doctorId!)
        .eq("category", category)
        .maybeSingle();
      // null = no row (use defaults); [] or [...] = doctor has customised
      return (data?.items ?? null) as T[] | null;
    },
    enabled: !!doctorId,
    staleTime: 10 * 60 * 1000,
  });

  const saveMutation = useMutation({
    mutationFn: async (newItems: T[]) => {
      if (!doctorId || !hospitalId) throw new Error("identity not resolved");
      await (supabase as any)
        .from("doctor_quick_picks")
        .upsert(
          {
            doctor_id: doctorId,
            hospital_id: hospitalId,
            category,
            items: newItems,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "doctor_id,category" }
        );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      if (!doctorId) throw new Error("identity not resolved");
      await (supabase as any)
        .from("doctor_quick_picks")
        .delete()
        .eq("doctor_id", doctorId)
        .eq("category", category);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const defaults = (QUICK_PICK_DEFAULTS[category] as T[]) ?? [];
  // dbItems === undefined → query not yet run; null → no row; array → customised
  const isCustomized = dbItems !== null && dbItems !== undefined;
  const items = isCustomized ? (dbItems as T[]) : defaults;
  const isLoading = identityLoading || (!!doctorId && queryLoading);

  return {
    items,
    isCustomized,
    isLoading,
    save: (newItems: T[]) => saveMutation.mutateAsync(newItems),
    reset: () => resetMutation.mutateAsync(),
  };
}
