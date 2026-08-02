import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import {
  RefreshCw, Info, ArrowUp, ArrowDown, CheckCircle2, AlertTriangle, MinusCircle, Loader2,
} from "lucide-react";
import {
  attainment, isOnTarget, formatIndicatorValue, formatFraction, deltaVsPrevious,
  targetPrefix, type QualityIndicatorRow,
} from "@/lib/qualityIndicators";

interface Definition {
  indicator_code: string;
  display_name: string;
  nabh_chapter: string;
  nabh_standard_code: string | null;
  collection_mode: "auto" | "manual" | "hybrid";
  denominator_description: string | null;
  caveats: string | null;
  sort_order: number;
}

interface TrendPoint {
  indicator_code: string;
  period_start: string;
  value: number | null;
}

const categoryColors: Record<string, string> = {
  clinical: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  operational: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  patient_safety: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  infection_control: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  nabh: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  financial: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
};

const MONTHS_OF_TREND = 12;

const relativeTime = (iso: string | null): string => {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

const periodLabel = (iso: string): string =>
  new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", year: "numeric" });

/**
 * Status is conveyed by an icon AND a text label, never by colour alone —
 * a colourblind or monochrome reader must get the same information.
 */
const StatusChip: React.FC<{ row: QualityIndicatorRow }> = ({ row }) => {
  const onTarget = isOnTarget(row.value, row.target, row.direction);

  if (row.value === null) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
        <MinusCircle size={11} /> Not measured
      </span>
    );
  }
  if (onTarget === null) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
        <Info size={11} /> Informational
      </span>
    );
  }
  if (onTarget) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-600 dark:text-green-400">
        <CheckCircle2 size={11} /> On target
      </span>
    );
  }
  const att = attainment(row.value, row.target, row.direction);
  const severe = att !== null && att < 50;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-medium ${
        severe ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"
      }`}
    >
      <AlertTriangle size={11} /> Off target
    </span>
  );
};

const Sparkline: React.FC<{ points: TrendPoint[] }> = ({ points }) => {
  const data = useMemo(
    () => points.filter((p) => p.value !== null).map((p) => ({ v: Number(p.value) })),
    [points],
  );
  // A single point is not a trend; render nothing rather than a misleading dot.
  if (data.length < 2) return <div className="h-8" aria-hidden="true" />;
  return (
    <div className="h-8" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
          <Line
            type="monotone"
            dataKey="v"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

const QualityIndicatorsTab: React.FC = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();

  const [rows, setRows] = useState<QualityIndicatorRow[]>([]);
  const [defs, setDefs] = useState<Record<string, Definition>>({});
  const [chapterNames, setChapterNames] = useState<Record<string, { name: string; order: number }>>({});
  const [trends, setTrends] = useState<Record<string, TrendPoint[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const [editRow, setEditRow] = useState<QualityIndicatorRow | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);

    const trendFrom = new Date();
    trendFrom.setMonth(trendFrom.getMonth() - (MONTHS_OF_TREND - 1));
    trendFrom.setDate(1);
    const trendFromISO = trendFrom.toISOString().slice(0, 10);

    const [curRes, defRes, chapRes, trendRes] = await Promise.all([
      // Explicit hospital_id alongside RLS, matching every other query here.
      (supabase as any).from("quality_indicators_current").select("*").eq("hospital_id", hospitalId),
      (supabase as any).from("quality_indicator_definitions").select("*").eq("is_active", true),
      (supabase as any).from("nabh_chapter_names").select("*"),
      (supabase as any)
        .from("quality_indicators")
        .select("indicator_code, period_start, value")
        .eq("hospital_id", hospitalId)
        .eq("period", "monthly")
        .gte("period_start", trendFromISO)
        .order("period_start"),
    ]);

    const firstError = curRes.error || defRes.error || chapRes.error || trendRes.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    setRows((curRes.data as QualityIndicatorRow[]) || []);
    setDefs(
      Object.fromEntries(((defRes.data as Definition[]) || []).map((d) => [d.indicator_code, d])),
    );
    setChapterNames(
      Object.fromEntries(
        ((chapRes.data as any[]) || []).map((c) => [
          c.chapter_code,
          { name: c.chapter_name, order: c.sort_order },
        ]),
      ),
    );

    const byCode: Record<string, TrendPoint[]> = {};
    for (const p of ((trendRes.data as TrendPoint[]) || [])) {
      (byCode[p.indicator_code] ||= []).push(p);
    }
    setTrends(byCode);

    setError(null);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => {
    void load();
  }, [load]);

  const recalculate = async () => {
    if (!hospitalId) return;
    setRecalculating(true);
    const periodStart = new Date();
    periodStart.setDate(1);
    const { data, error: rpcError } = await (supabase as any).rpc(
      "run_quality_indicator_collection",
      { p_hospital_id: hospitalId, p_period_start: periodStart.toISOString().slice(0, 10) },
    );
    setRecalculating(false);

    if (rpcError) {
      toast({ title: "Recalculation failed", description: rpcError.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Indicators recalculated",
      description: `${data ?? 0} indicator${data === 1 ? "" : "s"} collected from source modules`,
    });
    void load();
  };

  const saveManualValue = async () => {
    if (!editRow || !hospitalId) return;
    const val = parseFloat(editValue);
    if (!Number.isFinite(val)) {
      toast({ title: "Enter a number", variant: "destructive" });
      return;
    }
    setSaving(true);
    // Upsert on the period key rather than updating by id, so the value is
    // scoped to its period and survives the next collector run.
    const { error: upsertError } = await (supabase as any)
      .from("quality_indicators")
      .upsert(
        {
          hospital_id: hospitalId,
          indicator_code: editRow.indicator_code,
          indicator_name: editRow.indicator_name,
          category: editRow.category,
          nabh_chapter: editRow.nabh_chapter,
          value: val,
          unit: editRow.unit,
          direction: editRow.direction,
          target: editRow.target,
          benchmark: editRow.benchmark,
          period: editRow.period,
          period_start: editRow.period_start,
          auto_calculated: false,
          computed_at: new Date().toISOString(),
        },
        { onConflict: "hospital_id,indicator_code,period,period_start" },
      );
    setSaving(false);

    if (upsertError) {
      toast({ title: "Could not save", description: upsertError.message, variant: "destructive" });
      return;
    }
    toast({ title: "Indicator updated" });
    setEditRow(null);
    void load();
  };

  const lastComputed = useMemo(() => {
    const stamps = rows.map((r) => r.computed_at).filter(Boolean) as string[];
    if (!stamps.length) return null;
    return stamps.reduce((a, b) => (a > b ? a : b));
  }, [rows]);

  const chapters = useMemo(() => {
    const grouped: Record<string, QualityIndicatorRow[]> = {};
    for (const r of rows) {
      const chapter = r.nabh_chapter || "Other";
      (grouped[chapter] ||= []).push(r);
    }
    for (const list of Object.values(grouped)) {
      list.sort(
        (a, b) =>
          (defs[a.indicator_code]?.sort_order ?? 999) - (defs[b.indicator_code]?.sort_order ?? 999),
      );
    }
    return Object.entries(grouped).sort(
      ([a], [b]) => (chapterNames[a]?.order ?? 999) - (chapterNames[b]?.order ?? 999),
    );
  }, [rows, defs, chapterNames]);

  const measuredCount = rows.filter((r) => r.value !== null).length;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Loading indicators…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
        <div className="text-destructive text-sm font-medium">Failed to load quality indicators</div>
        <p className="text-xs text-muted-foreground text-center max-w-sm">{error}</p>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-sm font-semibold text-foreground">NABH Quality Indicators</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {measuredCount} of {rows.length} measured · collected from source modules ·
            last computed {relativeTime(lastComputed)}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={recalculate} disabled={recalculating} className="gap-1.5 shrink-0">
          {recalculating ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {recalculating ? "Recalculating…" : "Recalculate"}
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 p-8">
          <div className="text-2xl">📊</div>
          <p className="text-sm font-medium text-foreground">No indicators collected yet</p>
          <p className="text-xs text-muted-foreground text-center max-w-sm">
            Press Recalculate to compute this month's indicators from OPD, IPD, OT, lab,
            radiology, pharmacy, infection control, HR and facility data.
          </p>
        </div>
      ) : (
        chapters.map(([chapter, list]) => (
          <div key={chapter} className="mb-6">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              {chapter} — {chapterNames[chapter]?.name || chapter}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {list.map((row) => {
                const def = defs[row.indicator_code];
                const delta = deltaVsPrevious(trends[row.indicator_code] || [], row.direction);
                const fraction = formatFraction(
                  row.numerator,
                  row.denominator,
                  def?.denominator_description,
                );
                const isManual = def?.collection_mode === "manual";

                return (
                  <Card key={row.indicator_code} className="border">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-foreground leading-tight">
                            {row.indicator_name}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <Badge
                              variant="secondary"
                              className={`text-[9px] ${categoryColors[row.category] || ""}`}
                            >
                              {row.category.replace(/_/g, " ")}
                            </Badge>
                            <Badge variant="outline" className="text-[9px]">
                              {isManual ? "Manual" : "Auto"}
                            </Badge>
                            {def?.nabh_standard_code && (
                              <span className="text-[9px] text-muted-foreground">
                                {def.nabh_standard_code}
                              </span>
                            )}
                          </div>
                        </div>
                        {def?.caveats && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="text-muted-foreground hover:text-foreground shrink-0"
                                aria-label={`How ${row.indicator_name} is measured`}
                              >
                                <Info size={13} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-[11px] leading-relaxed">
                              {def.caveats}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>

                      <div className="flex items-end gap-2">
                        {/* Value wears text ink; status is carried by the chip below,
                            so meaning never depends on the colour of the number. */}
                        <span className="text-2xl font-bold text-foreground tabular-nums">
                          {formatIndicatorValue(row.value, row.unit)}
                        </span>
                        {row.value !== null && (
                          <span className="text-sm text-muted-foreground mb-0.5">{row.unit}</span>
                        )}
                        {delta && (
                          <span
                            className={`inline-flex items-center gap-0.5 text-[11px] mb-1 ${
                              delta.improved === null
                                ? "text-muted-foreground"
                                : delta.improved
                                  ? "text-green-600 dark:text-green-400"
                                  : "text-red-600 dark:text-red-400"
                            }`}
                            title={`${delta.absolute > 0 ? "Up" : "Down"} ${Math.abs(delta.absolute)} vs previous period${
                              delta.improved === null ? "" : delta.improved ? " (improving)" : " (worsening)"
                            }`}
                          >
                            {delta.absolute > 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
                            {Math.abs(delta.absolute)}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2 mt-1">
                        <StatusChip row={row} />
                        {row.target !== null && (
                          <span className="text-[10px] text-muted-foreground">
                            Target {targetPrefix(row.direction)} {row.target}
                            {row.unit === "%" ? "%" : ""}
                          </span>
                        )}
                      </div>

                      {/* The arithmetic behind the number, or why there isn't one. */}
                      <p className="text-[10px] text-muted-foreground mt-1.5 min-h-[13px]">
                        {fraction || row.notes || ""}
                      </p>

                      <Sparkline points={trends[row.indicator_code] || []} />

                      <p className="text-[9px] text-muted-foreground">
                        {periodLabel(row.period_start)} · {row.period}
                      </p>

                      {isManual && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs mt-2 w-full"
                          onClick={() => {
                            setEditRow(row);
                            setEditValue(row.value === null ? "" : String(row.value));
                          }}
                        >
                          Update value
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        ))
      )}

      <Dialog open={!!editRow} onOpenChange={() => setEditRow(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Update: {editRow?.indicator_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {editRow && defs[editRow.indicator_code]?.caveats && (
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {defs[editRow.indicator_code].caveats}
              </p>
            )}
            <div>
              <Label className="text-xs">
                Value ({editRow?.unit}) for {editRow ? periodLabel(editRow.period_start) : ""}
              </Label>
              <Input
                type="number"
                step="any"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="mt-1"
              />
            </div>
            <Button onClick={saveManualValue} className="w-full" size="sm" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default QualityIndicatorsTab;
