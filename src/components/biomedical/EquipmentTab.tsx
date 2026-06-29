import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { format, differenceInDays } from "date-fns";
import { useHospitalId } from '@/hooks/useHospitalId';

const STATUS_STYLES: Record<string, string> = {
  operational: "bg-emerald-50 text-emerald-700 border-emerald-200",
  under_maintenance: "bg-amber-50 text-amber-700 border-amber-200",
  breakdown: "bg-red-50 text-red-700 border-red-200 animate-pulse",
  calibration: "bg-blue-50 text-blue-700 border-blue-200",
  condemned: "bg-muted text-muted-foreground",
  disposed: "bg-muted text-muted-foreground",
};

interface Props { onRefresh: () => void; }

const EquipmentTab: React.FC<Props> = ({ onRefresh }) => {
  const { hospitalId } = useHospitalId();
  const [equipment, setEquipment] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");
  const [selected, setSelected] = useState<any>(null);
  const [pmHistory, setPmHistory] = useState<any[]>([]);
  const [breakdownHistory, setBreakdownHistory] = useState<any[]>([]);
  const [calibrationHistory, setCalibrationHistory] = useState<any[]>([]);

  useEffect(() => {
    if (!hospitalId) return;
    const load = async () => {
      const [eqRes, deptRes] = await Promise.all([
        supabase.from("equipment_master").select("*").eq("hospital_id", hospitalId).eq("is_active", true).order("equipment_code"),
        supabase.from("departments").select("id, name").eq("hospital_id", hospitalId).order("name", { ascending: true }),
      ]);
      setEquipment(eqRes.data || []);
      setDepartments(deptRes.data || []);
    };
    load();
  }, [hospitalId]);

  const filtered = equipment.filter((e) => {
    if (search && !e.equipment_name.toLowerCase().includes(search.toLowerCase()) && !e.equipment_code.toLowerCase().includes(search.toLowerCase())) return false;
    if (catFilter !== "all" && e.category !== catFilter) return false;
    if (statusFilter !== "all" && e.status !== statusFilter) return false;
    if (deptFilter !== "all" && e.department_id !== deptFilter) return false;
    return true;
  });

  const openDetail = async (eq: any) => {
    setSelected(eq);
    const [pm, bd, cal] = await Promise.all([
      supabase.from("pm_schedules").select("*").eq("equipment_id", eq.id).order("next_due_at", { ascending: false }).limit(20),
      supabase.from("breakdown_logs").select("*").eq("equipment_id", eq.id).order("reported_at", { ascending: false }).limit(20),
      supabase.from("calibration_records").select("*").eq("equipment_id", eq.id).order("calibrated_at", { ascending: false }).limit(20),
    ]);
    setPmHistory(pm.data || []);
    setBreakdownHistory(bd.data || []);
    setCalibrationHistory(cal.data || []);
  };

  const getDeptName = (id: string) => departments.find((d) => d.id === id)?.name || "—";

  const amcColor = (date: string | null) => {
    if (!date) return "text-muted-foreground";
    const days = differenceInDays(new Date(date), new Date());
    if (days < 30) return "text-red-600 font-bold";
    if (days < 60) return "text-amber-600";
    return "text-muted-foreground";
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Filters */}
      <div className="flex gap-2 pb-3 shrink-0 flex-wrap">
        <Input placeholder="Search name/code..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-[200px]" />
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {["diagnostic","therapeutic","monitoring","laboratory","surgical","ot_equipment","radiation","other"].map((c) => (
              <SelectItem key={c} value={c}>{c.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {["operational","under_maintenance","breakdown","calibration","condemned"].map((s) => (
              <SelectItem key={s} value={s}>{s.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Department" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-lg border border-border">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/50 sticky top-0 z-10">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Dept</th>
              <th className="px-3 py-2 font-medium">Make / Model</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">AMC Expiry</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((eq) => (
              <tr key={eq.id} onClick={() => openDetail(eq)} className="border-t border-border hover:bg-muted/30 cursor-pointer">
                <td className="px-3 py-2 font-mono text-xs">{eq.equipment_code}</td>
                <td className="px-3 py-2 font-medium">{eq.equipment_name}</td>
                <td className="px-3 py-2">{eq.category.replace(/_/g, " ")}</td>
                <td className="px-3 py-2">{eq.department_id ? getDeptName(eq.department_id) : "—"}</td>
                <td className="px-3 py-2">{eq.make} / {eq.model}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] border ${STATUS_STYLES[eq.status] || ""}`}>
                    {eq.status.replace(/_/g, " ")}
                  </span>
                </td>
                <td className={`px-3 py-2 ${amcColor(eq.amc_expiry)}`}>
                  {eq.amc_expiry ? format(new Date(eq.amc_expiry), "dd/MM/yyyy") : "—"}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No equipment found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Detail Drawer */}
      <Sheet open={!!selected} onOpenChange={() => setSelected(null)}>
        <SheetContent className="w-[600px] sm:max-w-[600px] overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.equipment_name} ({selected.equipment_code})</SheetTitle>
              </SheetHeader>
              <Tabs defaultValue="details" className="mt-4">
                <TabsList>
                  <TabsTrigger value="details">Details</TabsTrigger>
                  <TabsTrigger value="pm">PM History</TabsTrigger>
                  <TabsTrigger value="breakdowns">Breakdowns</TabsTrigger>
                  <TabsTrigger value="calibration">Calibration</TabsTrigger>
                </TabsList>
                <TabsContent value="details" className="space-y-3 mt-3">
                  <div className="grid grid-cols-2 gap-3 text-[13px]">
                    {[
                      ["Category", selected.category],
                      ["Make", selected.make],
                      ["Model", selected.model],
                      ["Serial No", selected.serial_number],
                      ["Location", selected.location],
                      ["Status", selected.status],
                      ["Purchase Date", selected.purchase_date ? format(new Date(selected.purchase_date), "dd/MM/yyyy") : "—"],
                      ["Purchase Cost", selected.purchase_cost ? `₹${Number(selected.purchase_cost).toLocaleString("en-IN")}` : "—"],
                      ["Warranty Expiry", selected.warranty_expiry ? format(new Date(selected.warranty_expiry), "dd/MM/yyyy") : "—"],
                      ["AMC Vendor", selected.amc_vendor || "—"],
                      ["AMC Expiry", selected.amc_expiry ? format(new Date(selected.amc_expiry), "dd/MM/yyyy") : "—"],
                      ["AMC Cost", selected.amc_cost ? `₹${Number(selected.amc_cost).toLocaleString("en-IN")}` : "—"],
                    ].map(([l, v]) => (
                      <div key={l}><span className="text-muted-foreground">{l}:</span> <span className="font-medium">{v || "—"}</span></div>
                    ))}
                  </div>
                  {selected.category === "radiation" && (
                    <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-[13px]">
                      <p className="font-semibold text-amber-800">AERB License</p>
                      <p>License No: {selected.aerb_license_no || "Not set"}</p>
                      <p>Expiry: {selected.aerb_expiry ? format(new Date(selected.aerb_expiry), "dd/MM/yyyy") : "Not set"}</p>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="pm" className="mt-3">
                  {pmHistory.length === 0 ? <p className="text-muted-foreground text-sm py-4">No PM history</p> : pmHistory.map((p) => (
                    <div key={p.id} className="border-b border-border py-2 text-[13px]">
                      <div className="flex justify-between"><span className="font-medium">{p.frequency}</span><Badge variant={p.status === "done" ? "default" : "destructive"} className="text-[10px]">{p.status}</Badge></div>
                      <p className="text-muted-foreground">Due: {format(new Date(p.next_due_at), "dd/MM/yyyy")}{p.done_at && ` | Done: ${format(new Date(p.done_at), "dd/MM/yyyy")}`}</p>
                    </div>
                  ))}
                </TabsContent>
                <TabsContent value="breakdowns" className="mt-3">
                  {breakdownHistory.length === 0 ? <p className="text-muted-foreground text-sm py-4">No breakdowns</p> : breakdownHistory.map((b) => (
                    <div key={b.id} className="border-b border-border py-2 text-[13px]">
                      <div className="flex justify-between"><span className="font-medium">{b.description.slice(0, 60)}</span><Badge variant={b.severity === "critical" ? "destructive" : "secondary"} className="text-[10px]">{b.severity}</Badge></div>
                      <p className="text-muted-foreground">Reported: {format(new Date(b.reported_at), "dd/MM/yyyy HH:mm")} | Status: {b.status}{b.downtime_hrs ? ` | Downtime: ${b.downtime_hrs}h` : ""}</p>
                    </div>
                  ))}
                </TabsContent>
                <TabsContent value="calibration" className="mt-3">
                  {calibrationHistory.length === 0 ? <p className="text-muted-foreground text-sm py-4">No calibration records</p> : calibrationHistory.map((c) => (
                    <div key={c.id} className="border-b border-border py-2 text-[13px]">
                      <div className="flex justify-between"><span className="font-medium">{c.calibrated_by}</span><Badge variant={c.result === "pass" ? "default" : "destructive"} className="text-[10px]">{c.result}</Badge></div>
                      <p className="text-muted-foreground">Date: {format(new Date(c.calibrated_at), "dd/MM/yyyy")} | Next: {format(new Date(c.next_due), "dd/MM/yyyy")}{c.certificate_no ? ` | Cert: ${c.certificate_no}` : ""}</p>
                    </div>
                  ))}
                </TabsContent>
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default EquipmentTab;
