import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

interface HospitalCompliance {
  id: string;
  name: string;
  nabhTotal: number;
  nabhCompliant: number;
  dpdpConsentCaptured: boolean;
  erasureRequestsOpen: number;
  failOpenEvents30d: number;
  adminAuditEntries: number;
}

async function fetchComplianceData(): Promise<HospitalCompliance[]> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  const [hRes, nabhRes, consentRes, erasureRes, failOpenRes, auditRes] = await Promise.all([
    (supabase as any).from("hospitals").select("id, name").eq("is_active", true).is("deleted_at", null),
    (supabase as any).from("nabh_hospital_compliance").select("hospital_id, status, applicability"),
    (supabase as any).from("hospital_signup_consents").select("hospital_id, dpdp_consent"),
    (supabase as any).from("data_erasure_requests").select("hospital_id, status").in("status", ["pending", "in_review"]),
    (supabase as any).from("entitlement_fail_open_events").select("hospital_id").gte("occurred_at", thirtyDaysAgo),
    (supabase as any).from("admin_audit_log").select("target_hospital_id"),
  ]);

  const hospitals: any[] = hRes.data || [];

  const nabhByHospital = new Map<string, { total: number; compliant: number }>();
  for (const r of (nabhRes.data || [])) {
    if (r.applicability !== "Applicable") continue;
    const cur = nabhByHospital.get(r.hospital_id) || { total: 0, compliant: 0 };
    cur.total++;
    if (r.status === "Compliant") cur.compliant++;
    nabhByHospital.set(r.hospital_id, cur);
  }

  const consentByHospital = new Set((consentRes.data || []).filter((r: any) => r.dpdp_consent).map((r: any) => r.hospital_id));

  const erasureCountByHospital = new Map<string, number>();
  for (const r of (erasureRes.data || [])) {
    erasureCountByHospital.set(r.hospital_id, (erasureCountByHospital.get(r.hospital_id) || 0) + 1);
  }

  const failOpenCountByHospital = new Map<string, number>();
  for (const r of (failOpenRes.data || [])) {
    failOpenCountByHospital.set(r.hospital_id, (failOpenCountByHospital.get(r.hospital_id) || 0) + 1);
  }

  const auditCountByHospital = new Map<string, number>();
  for (const r of (auditRes.data || [])) {
    if (!r.target_hospital_id) continue;
    auditCountByHospital.set(r.target_hospital_id, (auditCountByHospital.get(r.target_hospital_id) || 0) + 1);
  }

  return hospitals.map((h) => {
    const nabh = nabhByHospital.get(h.id) || { total: 0, compliant: 0 };
    return {
      id: h.id, name: h.name,
      nabhTotal: nabh.total, nabhCompliant: nabh.compliant,
      dpdpConsentCaptured: consentByHospital.has(h.id),
      erasureRequestsOpen: erasureCountByHospital.get(h.id) || 0,
      failOpenEvents30d: failOpenCountByHospital.get(h.id) || 0,
      adminAuditEntries: auditCountByHospital.get(h.id) || 0,
    };
  });
}

export default function ComplianceCenterPage() {
  const { data = [], isLoading } = useQuery({ queryKey: ["platform-compliance"], queryFn: fetchComplianceData, staleTime: 60_000 });

  const fleetDpdpRate = data.length > 0 ? Math.round((data.filter((h) => h.dpdpConsentCaptured).length / data.length) * 100) : 0;
  const fleetNabhAvg = (() => {
    const withNabh = data.filter((h) => h.nabhTotal > 0);
    if (withNabh.length === 0) return null;
    return Math.round(withNabh.reduce((s, h) => s + (h.nabhCompliant / h.nabhTotal) * 100, 0) / withNabh.length);
  })();
  const totalOpenErasure = data.reduce((s, h) => s + h.erasureRequestsOpen, 0);

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 border-b border-border flex items-center justify-between px-6 shrink-0">
        <div>
          <h1 className="text-[15px] font-semibold text-foreground">Compliance Evidence Center</h1>
          <p className="text-[11px] text-muted-foreground">Aggregates evidence already logged per hospital — not a substitute for a real audit.</p>
        </div>
      </div>

      <div className="p-6 space-y-6 overflow-auto flex-1">
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground">DPDP Signup Consent Captured</p>
            <p className="text-2xl font-bold text-foreground mt-1">{fleetDpdpRate}%</p>
            <p className="text-[10px] text-muted-foreground mt-1">of active hospitals</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground">Avg. NABH Compliance</p>
            <p className="text-2xl font-bold text-foreground mt-1">{fleetNabhAvg !== null ? `${fleetNabhAvg}%` : "—"}</p>
            <p className="text-[10px] text-muted-foreground mt-1">across hospitals tracking NABH standards</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground">Open Erasure Requests</p>
            <p className={cn("text-2xl font-bold mt-1", totalOpenErasure > 0 ? "text-amber-600" : "text-foreground")}>{totalOpenErasure}</p>
            <p className="text-[10px] text-muted-foreground mt-1">pending DPDP review</p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-[10px] uppercase font-bold text-muted-foreground">
                {["Hospital", "NABH Compliance", "DPDP Consent", "Open Erasure Requests", "Fail-Open Events (30d)", "Admin Actions Logged"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-xs text-muted-foreground">Loading…</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-xs text-muted-foreground">No hospitals</td></tr>
              ) : data.map((h) => (
                <tr key={h.id} className="border-t border-border hover:bg-muted/40 transition-colors">
                  <td className="px-5 py-3 text-xs font-medium text-foreground">{h.name}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">
                    {h.nabhTotal > 0 ? `${h.nabhCompliant}/${h.nabhTotal} (${Math.round((h.nabhCompliant / h.nabhTotal) * 100)}%)` : "Not tracked"}
                  </td>
                  <td className="px-5 py-3">
                    {h.dpdpConsentCaptured ? (
                      <span className="flex items-center gap-1 text-[11px] text-emerald-600"><ShieldCheck size={12} /> Captured</span>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] text-red-600"><ShieldAlert size={12} /> Missing</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">
                    {h.erasureRequestsOpen > 0 ? <span className="text-amber-600 font-semibold">{h.erasureRequestsOpen}</span> : "0"}
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">
                    {h.failOpenEvents30d > 0 ? <span className="text-amber-600 font-semibold">{h.failOpenEvents30d}</span> : "0"}
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{h.adminAuditEntries}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
