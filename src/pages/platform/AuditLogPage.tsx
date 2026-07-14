import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Search } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface AuditRow {
  id: string;
  admin_name: string | null;
  action: string;
  target_hospital_name: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

const ACTION_STYLE: Record<string, string> = {
  hospital_delete_requested: "bg-amber-500/15 text-amber-600",
  hospital_purged: "bg-red-500/15 text-red-600",
  hospital_restored: "bg-emerald-500/15 text-emerald-600",
  admin_added: "bg-blue-500/15 text-blue-600",
  admin_deactivated: "bg-amber-500/15 text-amber-600",
  erasure_request_approved: "bg-red-500/15 text-red-600",
  erasure_request_rejected: "bg-muted text-muted-foreground",
  impersonation_start: "bg-violet-500/15 text-violet-600",
  impersonation_end: "bg-violet-500/10 text-violet-500",
};

async function fetchAuditLog(): Promise<AuditRow[]> {
  const { data } = await (supabase as any)
    .from("admin_audit_log")
    .select("id, admin_name, action, target_hospital_name, details, created_at")
    .order("created_at", { ascending: false })
    .limit(300);
  return data || [];
}

export default function AuditLogPage() {
  const [search, setSearch] = useState("");
  const { data = [], isLoading } = useQuery({ queryKey: ["platform-audit-log"], queryFn: fetchAuditLog, staleTime: 30_000 });

  const filtered = search.trim()
    ? data.filter((r) =>
        [r.admin_name, r.action, r.target_hospital_name].filter(Boolean).some((v) => v!.toLowerCase().includes(search.toLowerCase()))
      )
    : data;

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 border-b border-border flex items-center justify-between px-6 shrink-0">
        <div>
          <h1 className="text-[15px] font-semibold text-foreground">Admin Audit Log</h1>
          <p className="text-[11px] text-muted-foreground">Fleet-wide — who did what, on which hospital, and when.</p>
        </div>
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by admin, action, hospital…"
            className="h-8 w-64 pl-7 pr-3 text-xs bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="text-[10px] uppercase font-bold text-muted-foreground border-b border-border">
              {["When", "Admin", "Action", "Hospital", "Details"].map((h) => (
                <th key={h} className="px-5 py-3 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-xs text-muted-foreground">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-xs text-muted-foreground">No matching audit entries</td></tr>
            ) : filtered.map((r) => (
              <tr key={r.id} className="border-t border-border hover:bg-muted/40 transition-colors">
                <td className="px-5 py-3 text-xs text-muted-foreground whitespace-nowrap">{format(new Date(r.created_at), "dd MMM yyyy, HH:mm:ss")}</td>
                <td className="px-5 py-3 text-xs text-foreground">{r.admin_name || "—"}</td>
                <td className="px-5 py-3">
                  <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full", ACTION_STYLE[r.action] || "bg-muted text-muted-foreground")}>
                    {r.action.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-5 py-3 text-xs text-muted-foreground">{r.target_hospital_name || "—"}</td>
                <td className="px-5 py-3 text-[11px] text-muted-foreground font-mono max-w-xs truncate">
                  {Object.keys(r.details || {}).length > 0 ? JSON.stringify(r.details) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
