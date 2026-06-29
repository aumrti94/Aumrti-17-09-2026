import React, { useState, useMemo } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useDoctorScores, type DoctorScore } from "@/hooks/useDoctorDeptData";
import type { DateRange } from "@/hooks/useAnalyticsData";
import DoctorDetailModal from "./DoctorDetailModal";

const fmt = (n: number) => {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toLocaleString("en-IN")}`;
};

type SortKey = "revenue" | "opdCount" | "ipdCount" | "otCases";

const DoctorsTab: React.FC<{ range: DateRange }> = ({ range }) => {
  const { data: doctors, isLoading } = useDoctorScores(range);
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [sortBy, setSortBy] = useState<SortKey>("revenue");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [selectedDoc, setSelectedDoc] = useState<DoctorScore | null>(null);

  const departments = useMemo(() => {
    const set = new Set((doctors || []).map(d => d.department_name));
    return Array.from(set).sort();
  }, [doctors]);

  const filtered = useMemo(() => {
    let list = doctors || [];
    if (search) list = list.filter(d => d.full_name.toLowerCase().includes(search.toLowerCase()));
    if (deptFilter !== "all") list = list.filter(d => d.department_name === deptFilter);
    return [...list].sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0));
  }, [doctors, search, deptFilter, sortBy]);

  const maxRevenue = useMemo(() => Math.max(1, ...filtered.map(d => d.revenue)), [filtered]);

  if (isLoading) return <div className="p-5 space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-36 w-full" />)}</div>;

  return (
    <div className="flex flex-col h-full">
      {/* Header Controls */}
      <div className="flex-shrink-0 h-12 px-5 flex items-center gap-3 border-b border-border bg-card">
        <div className="relative w-[200px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search doctors..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <SelectValue placeholder="All Departments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {departments.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1 ml-2">
          {(["revenue", "opdCount", "ipdCount", "otCases"] as SortKey[]).map(key => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              className={cn(
                "px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors",
                sortBy === key ? "bg-sidebar text-white" : "text-muted-foreground hover:bg-muted"
              )}
            >
              {key === "revenue" ? "Revenue" : key === "opdCount" ? "OPD" : key === "ipdCount" ? "IPD" : "OT"}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {(["cards", "table"] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={cn(
                "px-2.5 py-1 rounded text-[10px] font-medium transition-colors",
                viewMode === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              )}
            >
              {mode === "cards" ? "Cards" : "Table"}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">No doctors found</div>
        ) : viewMode === "cards" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {filtered.map(doc => (
              <DoctorCard key={doc.id} doc={doc} maxRevenue={maxRevenue} onClick={() => setSelectedDoc(doc)} />
            ))}
          </div>
        ) : (
          <DoctorTable doctors={filtered} onRowClick={setSelectedDoc} />
        )}
      </div>
      <DoctorDetailModal doc={selectedDoc} open={!!selectedDoc} onOpenChange={o => { if (!o) setSelectedDoc(null); }} />
    </div>
  );
};

const DoctorCard: React.FC<{ doc: DoctorScore; maxRevenue: number; onClick: () => void }> = ({ doc, maxRevenue, onClick }) => {
  const initials = doc.full_name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const revPct = Math.round((doc.revenue / maxRevenue) * 100);

  return (
    <div className="bg-card border border-border rounded-xl p-4 hover:shadow-md transition-shadow cursor-pointer" onClick={onClick}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <Avatar className="h-10 w-10">
          <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">{initials}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{doc.full_name}</p>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{doc.department_name}</span>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-3 gap-y-2.5 gap-x-3 text-center mb-3">
        <KPIMini label="OPD Visits" value={String(doc.opdCount)} />
        <KPIMini label="Revenue" value={fmt(doc.revenue)} color="text-emerald-600" />
        <KPIMini label="IPD Admits" value={String(doc.ipdCount)} />
        <KPIMini label="OT Cases" value={String(doc.otCases)} />
        <KPIMini label="Avg LOS" value={doc.avgLOS ? `${doc.avgLOS}d` : "—"} />
        <KPIMini label="Score" value="—" />
      </div>

      {/* Revenue Bar */}
      <div>
        <div className="flex items-center justify-between text-[10px] mb-1">
          <span className="text-muted-foreground">Revenue</span>
          <span className="font-semibold text-foreground">{fmt(doc.revenue)}</span>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${revPct}%` }} />
        </div>
      </div>
    </div>
  );
};

const KPIMini: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
  <div>
    <p className={cn("text-sm font-bold", color || "text-foreground")}>{value}</p>
    <p className="text-[9px] text-muted-foreground">{label}</p>
  </div>
);

const DoctorTable: React.FC<{ doctors: DoctorScore[]; onRowClick: (doc: DoctorScore) => void }> = ({ doctors, onRowClick }) => (
  <div className="bg-card border border-border rounded-xl overflow-hidden">
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-border bg-muted/50">
          <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Doctor</th>
          <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">Department</th>
          <th className="text-right px-3 py-2.5 font-medium text-muted-foreground">OPD</th>
          <th className="text-right px-3 py-2.5 font-medium text-muted-foreground">IPD</th>
          <th className="text-right px-3 py-2.5 font-medium text-muted-foreground">OT</th>
          <th className="text-right px-3 py-2.5 font-medium text-muted-foreground">Avg LOS</th>
          <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Revenue</th>
        </tr>
      </thead>
      <tbody>
        {doctors.map(doc => (
          <tr key={doc.id} className="border-b border-border/50 hover:bg-muted/30 cursor-pointer" onClick={() => onRowClick(doc)}>
            <td className="px-4 py-2.5 font-medium text-foreground">{doc.full_name}</td>
            <td className="px-3 py-2.5 text-muted-foreground">{doc.department_name}</td>
            <td className="px-3 py-2.5 text-right">{doc.opdCount}</td>
            <td className="px-3 py-2.5 text-right">{doc.ipdCount}</td>
            <td className="px-3 py-2.5 text-right">{doc.otCases}</td>
            <td className="px-3 py-2.5 text-right">{doc.avgLOS ? `${doc.avgLOS}d` : "—"}</td>
            <td className="px-4 py-2.5 text-right font-semibold text-emerald-600">{fmt(doc.revenue)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default DoctorsTab;
