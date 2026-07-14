import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Info } from "lucide-react";

interface MetricRegistryRow {
  display_name: string;
  numerator_description: string;
  denominator_description: string | null;
  period_description: string;
  methodology_notes: string;
  caveats: string | null;
}

async function fetchMetric(metricKey: string): Promise<MetricRegistryRow | null> {
  const { data } = await (supabase as any)
    .from("platform_metrics_registry")
    .select("display_name, numerator_description, denominator_description, period_description, methodology_notes, caveats")
    .eq("metric_key", metricKey)
    .eq("is_active", true)
    .maybeSingle();
  return data;
}

// Drop next to any metric on RevenueDashboardPage / ChurnRadarPage to explain
// exactly how it was computed, pulling live from platform_metrics_registry
// instead of a hardcoded tooltip string that can drift from the real formula.
export default function MetricInfoIcon({ metricKey }: { metricKey: string }) {
  const { data } = useQuery({
    queryKey: ["platform-metric-registry", metricKey],
    queryFn: () => fetchMetric(metricKey),
    staleTime: 5 * 60 * 1000,
  });

  if (!data) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="text-muted-foreground/60 hover:text-muted-foreground transition-colors align-middle ml-1" onClick={(e) => e.stopPropagation()}>
          <Info size={11} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-xs space-y-2" onClick={(e) => e.stopPropagation()}>
        <p className="font-semibold text-foreground">{data.display_name}</p>
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Formula: </span>
          {data.numerator_description}
          {data.denominator_description ? ` ÷ ${data.denominator_description}` : ""}
        </p>
        <p className="text-muted-foreground"><span className="font-medium text-foreground">Period: </span>{data.period_description}</p>
        <p className="text-muted-foreground">{data.methodology_notes}</p>
        {data.caveats && <p className="text-amber-700 dark:text-amber-500">⚠ {data.caveats}</p>}
      </PopoverContent>
    </Popover>
  );
}
