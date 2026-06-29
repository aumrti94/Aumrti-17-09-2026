import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  hospitalId: string | null;
}

interface ReadinessData {
  totalApplicable: number;
  compliant: number;
  coreTotal: number;
  coreCompliant: number;
}

const NABHReadinessCard: React.FC<Props> = ({ hospitalId }) => {
  const navigate = useNavigate();
  const [data, setData] = useState<ReadinessData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hospitalId) return;
    const load = async () => {
      setLoading(true);
      const { data: rows } = await (supabase as any)
        .from("nabh_hospital_compliance")
        .select("status, applicability, nabh_standards(level)")
        .eq("hospital_id", hospitalId);

      if (!rows) { setLoading(false); return; }

      const applicable = rows.filter((r: any) => r.applicability !== "Not Applicable");
      const compliant = applicable.filter((r: any) => r.status === "Compliant").length;
      const coreApplicable = applicable.filter((r: any) => r.nabh_standards?.level === "Core");
      const coreCompliant = coreApplicable.filter((r: any) => r.status === "Compliant").length;

      setData({
        totalApplicable: applicable.length,
        compliant,
        coreTotal: coreApplicable.length,
        coreCompliant,
      });
      setLoading(false);
    };
    load();
  }, [hospitalId]);

  const pct = data && data.totalApplicable > 0
    ? Math.round((data.compliant / data.totalApplicable) * 100) : 0;
  const corePct = data && data.coreTotal > 0
    ? Math.round((data.coreCompliant / data.coreTotal) * 100) : 0;

  const pctColor = pct >= 80 ? "text-[hsl(var(--success))]"
    : pct >= 60 ? "text-[hsl(38,92%,50%)]"
    : "text-destructive";
  const barColor = corePct >= 80 ? "bg-[hsl(var(--success))]"
    : corePct >= 60 ? "bg-[hsl(38,92%,50%)]"
    : "bg-destructive";

  return (
    <Card
      className="shadow-sm hover:shadow-md transition-shadow cursor-pointer group"
      onClick={() => navigate("/nabh/compliance")}
    >
      <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0 p-3">
        <CardTitle className="text-[11px] font-medium text-muted-foreground">NABH Readiness</CardTitle>
        <ShieldCheck size={16} className="text-muted-foreground group-hover:text-primary transition-colors" />
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-1">
        {loading ? (
          <Skeleton className="h-6 w-16" />
        ) : (
          <>
            <div className={cn("text-lg font-bold", pctColor)}>{pct}%</div>
            <p className="text-[10px] text-muted-foreground">
              {data?.compliant}/{data?.totalApplicable} applicable compliant
            </p>
            <div className="space-y-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-muted-foreground font-medium">Core OE</span>
                <span className="text-[9px] text-muted-foreground">
                  {data?.coreCompliant}/{data?.coreTotal}
                </span>
              </div>
              <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all duration-500", barColor)}
                  style={{ width: `${corePct}%` }}
                />
              </div>
            </div>
            <p className="text-[10px] text-primary font-medium group-hover:underline">
              View Matrix →
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default NABHReadinessCard;
