import { useEffect, useState } from "react";
import { Joyride, EventData, STATUS, Step } from "react-joyride";
import { supabase } from "@/integrations/supabase/client";

interface TourStep { target: string; content: string; order: number }

// Drop this into any page that has data-tour targets mounted. Auto-fires
// once per user per tour_key on first real visit to that page (not a
// system-wide "first login" — Joyride can only highlight elements that are
// actually mounted, so the tour fires when the relevant page is, not before).
export default function OnboardingTour({ tourKey }: { tourKey: string }) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [run, setRun] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: tour } = await (supabase as any)
        .from("platform_onboarding_tours")
        .select("steps")
        .eq("tour_key", tourKey)
        .eq("is_active", true)
        .maybeSingle();
      if (!tour || cancelled) return;

      const { data: progress } = await (supabase as any)
        .from("user_tour_progress")
        .select("id")
        .eq("user_id", user.id)
        .eq("tour_key", tourKey)
        .maybeSingle();
      if (progress || cancelled) return; // already completed or dismissed

      const rawSteps = (tour.steps as TourStep[]).slice().sort((a, b) => a.order - b.order);
      // Only start the tour if every target actually exists on this page —
      // otherwise Joyride would silently skip a missing step, which is
      // confusing rather than a real walkthrough.
      const allTargetsPresent = rawSteps.every((s) => document.querySelector(s.target));
      if (!allTargetsPresent || cancelled) return;

      setSteps(rawSteps.map((s) => ({ target: s.target, content: s.content, disableBeacon: true })));
      setRun(true);
    })();
    return () => { cancelled = true; };
  }, [tourKey]);

  const handleEvent = async (data: EventData) => {
    const { status } = data;
    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      setRun(false);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const now = new Date().toISOString();
      await (supabase as any).from("user_tour_progress").upsert(
        {
          user_id: user.id,
          tour_key: tourKey,
          completed_at: status === STATUS.FINISHED ? now : null,
          dismissed_at: status === STATUS.SKIPPED ? now : null,
        },
        { onConflict: "user_id,tour_key" }
      );
    }
  };

  if (!run || steps.length === 0) return null;

  return (
    <Joyride
      steps={steps}
      run={run}
      continuous
      onEvent={handleEvent}
      options={{ buttons: ["back", "close", "skip", "primary"] }}
      styles={{ options: { primaryColor: "#1A2F5A", zIndex: 10000 } }}
    />
  );
}
