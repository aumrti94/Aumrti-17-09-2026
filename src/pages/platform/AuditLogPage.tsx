import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Search } from "lucide-react";
import { format } from "date-fns";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DataTable, DataTableRow } from "@/components/shared/DataTable";

interface AuditRow {
  id: string;
  admin_name: string | null;
  action: string;
  target_hospital_name: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

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
      <PageHeader
        title="Admin Audit Log"
        subtitle="Fleet-wide — who did what, on which hospital, and when."
        search={
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by admin, action, hospital…"
              className="h-8 w-64 pl-7 pr-3 text-xs bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
            />
          </div>
        }
      />

      <div className="flex-1 overflow-auto">
        <DataTable
          columns={[
            { key: "when", header: "When" },
            { key: "admin", header: "Admin" },
            { key: "action", header: "Action" },
            { key: "hospital", header: "Hospital" },
            { key: "details", header: "Details" },
          ]}
          loading={isLoading}
          empty={filtered.length === 0}
          emptyMessage="No matching audit entries"
        >
          {filtered.map((r) => (
            <DataTableRow key={r.id}>
              <td className="px-5 py-3 text-xs text-muted-foreground whitespace-nowrap">{format(new Date(r.created_at), "dd MMM yyyy, HH:mm:ss")}</td>
              <td className="px-5 py-3 text-xs text-foreground">{r.admin_name || "—"}</td>
              <td className="px-5 py-3">
                <StatusBadge status={r.action} />
              </td>
              <td className="px-5 py-3 text-xs text-muted-foreground">{r.target_hospital_name || "—"}</td>
              <td className="px-5 py-3 text-[11px] text-muted-foreground font-mono max-w-xs truncate">
                {Object.keys(r.details || {}).length > 0 ? JSON.stringify(r.details) : "—"}
              </td>
            </DataTableRow>
          ))}
        </DataTable>
      </div>
    </div>
  );
}
