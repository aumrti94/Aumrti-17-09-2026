import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { TrendingUp, TrendingDown, Users, Stethoscope, Clock, BedDouble, IndianRupee, Activity } from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  deptId: string | null;
  deptName: string;
}

const fmtCurrency = (n: number) => {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${n.toLocaleString("en-IN")}`;
};

async function getHospitalId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("users").select("hospital_id").eq("auth_user_id", user.id).maybeSingle();
  return data?.hospital_id || null;
}

function useDeptDrillDown(deptId: string | null) {
  return useQuery({
    queryKey: ["dept-drill-down", deptId],
    enabled: !!deptId,
    queryFn: async () => {
      const hospitalId = await getHospitalId();
      if (!hospitalId || !deptId) return null;

      const now = new Date();
      const thisMonthStart = format(startOfMonth(now), "yyyy-MM-dd");
      const thisMonthEnd = format(endOfMonth(now), "yyyy-MM-dd");
      const lastMonthStart = format(startOfMonth(subMonths(now, 1)), "yyyy-MM-dd");
      const lastMonthEnd = format(endOfMonth(subMonths(now, 1)), "yyyy-MM-dd");

      // Doctors in this dept
      const { data: doctors } = await supabase.from("users")
        .select("id, full_name")
        .eq("hospital_id", hospitalId)
        .eq("department_id", deptId)
        .eq("role", "doctor")
        .eq("is_active", true);
      const docIds = (doctors || []).map(d => d.id);
      if (docIds.length === 0) {
        return { thisOpd: 0, lastOpd: 0, thisRev: 0, lastRev: 0, topDx: [], topDocs: [], avgConsultMin: null, occupancy: null };
      }

      const [
        opdThisRes, opdLastRes,
        billsThisRes, billsLastRes,
        dxRes, tokensRes, admRes, bedsRes
      ] = await Promise.all([
        supabase.from("opd_encounters").select("id, doctor_id")
          .eq("hospital_id", hospitalId).in("doctor_id", docIds)
          .gte("created_at", thisMonthStart).lte("created_at", thisMonthEnd + "T23:59:59").limit(5000),
        supabase.from("opd_encounters").select("id")
          .eq("hospital_id", hospitalId).in("doctor_id", docIds)
          .gte("created_at", lastMonthStart).lte("created_at", lastMonthEnd + "T23:59:59").limit(5000),
        supabase.from("bills").select("paid_amount, encounter_id, admission_id")
          .eq("hospital_id", hospitalId)
          .gte("bill_date", thisMonthStart).lte("bill_date", thisMonthEnd).limit(5000),
        supabase.from("bills").select("paid_amount, encounter_id, admission_id")
          .eq("hospital_id", hospitalId)
          .gte("bill_date", lastMonthStart).lte("bill_date", lastMonthEnd).limit(5000),
        supabase.from("opd_encounters").select("diagnosis, doctor_id")
          .eq("hospital_id", hospitalId).in("doctor_id", docIds)
          .not("diagnosis", "is", null)
          .gte("created_at", thisMonthStart).lte("created_at", thisMonthEnd + "T23:59:59").limit(2000),
        supabase.from("opd_tokens").select("doctor_id, consultation_start_at, consultation_end_at")
          .eq("hospital_id", hospitalId).in("doctor_id", docIds)
          .not("consultation_start_at", "is", null).not("consultation_end_at", "is", null)
          .gte("visit_date", thisMonthStart).lte("visit_date", thisMonthEnd).limit(2000),
        supabase.from("admissions").select("id, admitting_doctor_id, ward_id, status")
          .eq("hospital_id", hospitalId).in("admitting_doctor_id", docIds).limit(2000),
        supabase.from("beds").select("id, status, ward_id").eq("hospital_id", hospitalId).eq("is_active", true).limit(2000),
      ]);

      const thisOpdEncs = opdThisRes.data || [];
      const thisOpd = thisOpdEncs.length;
      const lastOpd = (opdLastRes.data || []).length;

      const thisEncIds = new Set(thisOpdEncs.map(e => e.id));
      const lastEncIds = new Set((opdLastRes.data || []).map((e: any) => e.id));

      // Admission IDs by month
      const admissions = admRes.data || [];
      const sumPaid = (rows: any[], encIds: Set<string>, admDocs: Set<string>) => {
        return rows.reduce((s, b) => {
          const inEnc = b.encounter_id && encIds.has(b.encounter_id);
          const adm = admissions.find(a => a.id === b.admission_id);
          const inAdm = adm && admDocs.has(adm.admitting_doctor_id);
          return s + ((inEnc || inAdm) ? Number(b.paid_amount) || 0 : 0);
        }, 0);
      };
      const docSet = new Set(docIds);
      const thisRev = sumPaid(billsThisRes.data || [], thisEncIds, docSet);
      const lastRev = sumPaid(billsLastRes.data || [], lastEncIds, docSet);

      // Top diagnoses
      const dxMap: Record<string, number> = {};
      (dxRes.data || []).forEach(r => {
        const d = (r.diagnosis || "").trim();
        if (d) dxMap[d] = (dxMap[d] || 0) + 1;
      });
      const topDx = Object.entries(dxMap).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => ({ name, count }));

      // Top doctors by patient count this month
      const docCount: Record<string, number> = {};
      thisOpdEncs.forEach(e => { docCount[e.doctor_id] = (docCount[e.doctor_id] || 0) + 1; });
      const docMap: Record<string, string> = {};
      (doctors || []).forEach(d => { docMap[d.id] = d.full_name; });
      const topDocs = Object.entries(docCount).sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([id, count]) => ({ name: docMap[id] || "Unknown", count }));

      // Avg consultation duration
      const tokens = (tokensRes.data || []).filter((t: any) => t.consultation_start_at && t.consultation_end_at);
      let avgConsultMin: number | null = null;
      if (tokens.length > 0) {
        const totalMs = tokens.reduce((s: number, t: any) => {
          return s + (new Date(t.consultation_end_at).getTime() - new Date(t.consultation_start_at).getTime());
        }, 0);
        avgConsultMin = Math.round(totalMs / tokens.length / 60000);
      }

      // Bed occupancy — only meaningful if this dept has admissions
      let occupancy: { occupied: number; total: number; pct: number } | null = null;
      const wardIds = new Set(admissions.map(a => a.ward_id).filter(Boolean));
      if (wardIds.size > 0) {
        const beds = (bedsRes.data || []).filter(b => wardIds.has(b.ward_id));
        const occupied = beds.filter(b => b.status === "occupied").length;
        if (beds.length > 0) {
          occupancy = { occupied, total: beds.length, pct: Math.round((occupied / beds.length) * 100) };
        }
      }

      return { thisOpd, lastOpd, thisRev, lastRev, topDx, topDocs, avgConsultMin, occupancy };
    },
  });
}

const ChangeBadge: React.FC<{ current: number; previous: number }> = ({ current, previous }) => {
  if (previous === 0 && current === 0) return <span className="text-[11px] text-muted-foreground">—</span>;
  const pct = previous === 0 ? 100 : Math.round(((current - previous) / previous) * 100);
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${up ? "text-emerald-600" : "text-red-600"}`}>
      <Icon size={11} /> {up ? "+" : ""}{pct}%
    </span>
  );
};

const DepartmentDetailModal: React.FC<Props> = ({ open, onOpenChange, deptId, deptName }) => {
  const { data, isLoading } = useDeptDrillDown(deptId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[640px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Activity size={16} className="text-primary" /> {deptName} — Department Detail
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground">
            {format(new Date(), "MMMM yyyy")} · drill-down view
          </p>
        </DialogHeader>

        {isLoading || !data ? (
          <div className="space-y-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : (
          <div className="space-y-4">
            {/* KPI Row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="border border-border rounded-lg p-3 bg-card">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Users size={12} /> OPD This Month</div>
                  <ChangeBadge current={data.thisOpd} previous={data.lastOpd} />
                </div>
                <p className="text-xl font-bold text-foreground mt-1">{data.thisOpd}</p>
                <p className="text-[10px] text-muted-foreground">vs {data.lastOpd} last month</p>
              </div>
              <div className="border border-border rounded-lg p-3 bg-card">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><IndianRupee size={12} /> Revenue This Month</div>
                  <ChangeBadge current={data.thisRev} previous={data.lastRev} />
                </div>
                <p className="text-xl font-bold text-foreground mt-1">{fmtCurrency(data.thisRev)}</p>
                <p className="text-[10px] text-muted-foreground">vs {fmtCurrency(data.lastRev)} last month</p>
              </div>
              <div className="border border-border rounded-lg p-3 bg-card">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Clock size={12} /> Avg Consultation</div>
                <p className="text-xl font-bold text-foreground mt-1">
                  {data.avgConsultMin != null ? `${data.avgConsultMin} min` : "—"}
                </p>
              </div>
              <div className="border border-border rounded-lg p-3 bg-card">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><BedDouble size={12} /> Bed Occupancy</div>
                <p className="text-xl font-bold text-foreground mt-1">
                  {data.occupancy ? `${data.occupancy.pct}%` : "—"}
                </p>
                {data.occupancy && (
                  <p className="text-[10px] text-muted-foreground">{data.occupancy.occupied} of {data.occupancy.total} beds</p>
                )}
              </div>
            </div>

            {/* Top Diagnoses */}
            <div className="border border-border rounded-lg p-3 bg-card">
              <h4 className="text-[12px] font-semibold text-foreground mb-2 flex items-center gap-1.5">
                <Stethoscope size={13} /> Top Diagnoses (this month)
              </h4>
              {data.topDx.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No diagnoses recorded yet</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.topDx.map((d, i) => (
                    <li key={i} className="flex items-center justify-between text-[12px]">
                      <span className="text-foreground">{i + 1}. {d.name}</span>
                      <span className="text-muted-foreground font-mono">{d.count} cases</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Top Doctors */}
            <div className="border border-border rounded-lg p-3 bg-card">
              <h4 className="text-[12px] font-semibold text-foreground mb-2 flex items-center gap-1.5">
                <Users size={13} /> Top Doctors by Patient Count
              </h4>
              {data.topDocs.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No data</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.topDocs.map((d, i) => (
                    <li key={i} className="flex items-center justify-between text-[12px]">
                      <span className="text-foreground">{i + 1}. {d.name}</span>
                      <span className="text-muted-foreground font-mono">{d.count} patients</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default DepartmentDetailModal;
