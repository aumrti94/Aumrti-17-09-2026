import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Per-user reusable clinical note templates (table: clinical_note_templates).
// ward_round body = { s, o, a, p } · nursing body = { text }.
// Personal by default; is_shared = true makes it visible hospital-wide (read-only to others).

export type NoteTemplateType = "ward_round" | "nursing";

export interface NoteTemplate {
  id: string;
  name: string;
  note_type: NoteTemplateType;
  body: Record<string, any>;
  is_shared: boolean;
  created_by: string;
}

interface SaveArgs {
  name: string;
  body: Record<string, any>;
  isShared?: boolean;
}

interface UseNoteTemplatesResult {
  /** Templates created by the current user. */
  mine: NoteTemplate[];
  /** Shared templates from other users in the hospital (read-only). */
  shared: NoteTemplate[];
  isLoading: boolean;
  saveTemplate: (args: SaveArgs) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
}

export function useNoteTemplates(noteType: NoteTemplateType): UseNoteTemplatesResult {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
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
        setUserId(userData.id);
        setHospitalId(userData.hospital_id);
      } catch {
        // non-fatal — no templates will be shown
      } finally {
        if (alive) setIdentityLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const queryKey = ["note-templates", userId, noteType] as const;

  const { data: rows, isLoading: queryLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      // RLS returns my own rows + any shared rows in my hospital.
      const { data } = await (supabase as any)
        .from("clinical_note_templates")
        .select("id, name, note_type, body, is_shared, created_by")
        .eq("note_type", noteType)
        .eq("is_active", true)
        .order("name", { ascending: true });
      return (data ?? []) as NoteTemplate[];
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });

  const saveMutation = useMutation({
    mutationFn: async ({ name, body, isShared }: SaveArgs) => {
      if (!userId || !hospitalId) throw new Error("identity not resolved");
      await (supabase as any).from("clinical_note_templates").insert({
        hospital_id: hospitalId,
        created_by: userId,
        note_type: noteType,
        name,
        body,
        is_shared: !!isShared,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await (supabase as any).from("clinical_note_templates").delete().eq("id", id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const all = rows ?? [];
  const mine = all.filter((t) => t.created_by === userId);
  const shared = all.filter((t) => t.created_by !== userId && t.is_shared);

  return {
    mine,
    shared,
    isLoading: identityLoading || (!!userId && queryLoading),
    saveTemplate: (args: SaveArgs) => saveMutation.mutateAsync(args),
    deleteTemplate: (id: string) => deleteMutation.mutateAsync(id),
  };
}
