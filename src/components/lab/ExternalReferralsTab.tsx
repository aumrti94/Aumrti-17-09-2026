import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Plus, CheckCircle2, Clock, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import ExternalLabReferralModal from "./ExternalLabReferralModal";

interface Props {
  hospitalId: string;
}

const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  pending:        { label: "Pending", cls: "bg-slate-100 text-slate-700" },
  sample_sent:    { label: "Sample Sent", cls: "bg-blue-100 text-blue-700" },
  report_awaited: { label: "Report Awaited", cls: "bg-amber-100 text-amber-700" },
  completed:      { label: "Completed", cls: "bg-green-100 text-green-700" },
  cancelled:      { label: "Cancelled", cls: "bg-red-100 text-red-700" },
};

const NEXT_STATUS: Record<string, string> = {
  pending: "sample_sent",
  sample_sent: "report_awaited",
  report_awaited: "completed",
};

const ExternalReferralsTab: React.FC<Props> = ({ hospitalId }) => {
  const { toast } = useToast();
  const [referrals, setReferrals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("external_lab_referrals")
      .select("*, patients(full_name, uhid)")
      .eq("hospital_id", hospitalId)
      .order("referred_at", { ascending: false })
      .limit(100);
    setReferrals(data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const advanceStatus = async (ref: any) => {
    const next = NEXT_STATUS[ref.status];
    if (!next) return;
    await (supabase as any).from("external_lab_referrals").update({
      status: next,
      ...(next === "completed" ? { report_received_at: new Date().toISOString() } : {}),
    }).eq("id", ref.id);
    toast({ title: `Status updated to ${STATUS_STYLES[next]?.label}` });
    load();
  };

  const filtered = statusFilter === "all" ? referrals : referrals.filter(r => r.status === statusFilter);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
        <div className="flex gap-1">
          {["all", "pending", "sample_sent", "report_awaited", "completed"].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={cn("px-3 py-1 rounded-full text-[11px] font-semibold transition-colors",
                statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
              {s === "all" ? "All" : STATUS_STYLES[s]?.label}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => setShowModal(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> New Referral
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="text-xs text-muted-foreground text-center py-8">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-muted-foreground">No external lab referrals</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => setShowModal(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Create First Referral
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map(ref => {
              const st = STATUS_STYLES[ref.status] || STATUS_STYLES.pending;
              const next = NEXT_STATUS[ref.status];
              return (
                <div key={ref.id} className="px-4 py-3 hover:bg-muted/30 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold">{ref.lab_name}</span>
                        <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-semibold", st.cls)}>{st.label}</span>
                      </div>
                      {ref.patients && (
                        <p className="text-xs text-muted-foreground">
                          {ref.patients.full_name} · {ref.patients.uhid}
                        </p>
                      )}
                      {ref.tests_ordered?.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          Tests: {ref.tests_ordered.join(", ")}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Referred {new Date(ref.referred_at).toLocaleDateString("en-IN")}
                        </span>
                        {ref.report_expected_at && (
                          <span className={cn("text-[10px]",
                            new Date(ref.report_expected_at) < new Date() && ref.status !== "completed"
                              ? "text-red-500 font-semibold"
                              : "text-muted-foreground")}>
                            Expected: {new Date(ref.report_expected_at).toLocaleDateString("en-IN")}
                          </span>
                        )}
                        {ref.report_received_at && (
                          <span className="text-[10px] text-green-600 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Report received
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {next && (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => advanceStatus(ref)}>
                          → {STATUS_STYLES[next]?.label}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showModal && (
        <ExternalLabReferralModal
          open={showModal}
          onClose={() => setShowModal(false)}
          hospitalId={hospitalId}
          onCreated={load}
        />
      )}
    </div>
  );
};

export default ExternalReferralsTab;
