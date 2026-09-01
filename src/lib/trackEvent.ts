import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

let cachedContext: { hospitalId: string; userId: string } | null = null;

async function resolveContext(): Promise<{ hospitalId: string; userId: string } | null> {
  if (cachedContext) return cachedContext;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("users")
    .select("id, hospital_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!data?.hospital_id) return null;
  cachedContext = { hospitalId: data.hospital_id, userId: data.id };
  return cachedContext;
}

// Fire-and-forget product-analytics event. Never throws, never blocks the UI —
// a tracking failure must not be visible to the user or break the feature it's
// instrumenting.
export function trackEvent(eventName: string, context?: Record<string, unknown>): void {
  resolveContext()
    .then(ctx => {
      if (!ctx) return;
      return supabase.from("product_analytics_events").insert({
        hospital_id: ctx.hospitalId,
        user_id: ctx.userId,
        event_name: eventName,
        // Record<string, unknown> is not structurally assignable to Json (Json requires every
        // value to be Json too). Callers pass JSON-serialisable analytics payloads, so the cast
        // states that contract rather than loosening the column type.
        event_context: (context ?? null) as Json,
      });
    })
    .catch(err => {
      console.warn("trackEvent failed:", eventName, err);
    });
}
