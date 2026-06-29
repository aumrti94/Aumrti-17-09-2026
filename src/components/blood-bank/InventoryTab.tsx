import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle } from "lucide-react";
import { formatBloodGroup, componentLabel } from "@/lib/bloodCompatibility";
import { format, differenceInHours, formatDistanceToNow } from "date-fns";

interface Props { onRefresh: () => void }

const InventoryTab: React.FC<Props> = ({ onRefresh }) => {
  const [units, setUnits] = useState<any[]>([]);
  const [componentFilter, setComponentFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("available");

  const fetchUnits = async () => {
    let q = supabase.from("blood_units").select("*").order("expiry_at", { ascending: true });
    if (componentFilter !== "all") q = q.eq("component", componentFilter);
    if (groupFilter !== "all") {
      const [g, r] = groupFilter.split("_");
      q = q.eq("blood_group", g).eq("rh_factor", r);
    }
    if (statusFilter !== "all") q = q.eq("status", statusFilter);
    const { data } = await q;
    if (data) setUnits(data);
  };

  useEffect(() => { fetchUnits(); }, [componentFilter, groupFilter, statusFilter]);

  const expiringUnits = units.filter(u => {
    const hrs = differenceInHours(new Date(u.expiry_at), new Date());
    return hrs > 0 && hrs <= 48 && u.status === "available";
  });

  // Platelets expiring within 24 hours get special treatment
  const plateletAlerts = units.filter(u => {
    if (u.component !== "platelets" || u.status !== "available") return false;
    const hrs = differenceInHours(new Date(u.expiry_at), new Date());
    return hrs > 0 && hrs <= 120; // PLT shelf life is 5 days, show timer for all
  });

  const getRowClass = (u: any) => {
    const hrs = differenceInHours(new Date(u.expiry_at), new Date());
    if (hrs < 0) return "bg-muted/50 opacity-60";
    if (u.component === "platelets" && hrs < 24) return "bg-red-100";
    if (u.component === "platelets" && hrs < 72) return "bg-amber-100";
    if (hrs < 24) return "bg-red-50";
    if (hrs < 72) return "bg-amber-50";
    if (u.status === "reserved") return "bg-blue-50";
    return "";
  };

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      available: "bg-green-100 text-green-700",
      reserved: "bg-blue-100 text-blue-700",
      quarantine: "bg-red-100 text-red-700",
      issued: "bg-purple-100 text-purple-700",
      expired: "bg-muted text-muted-foreground",
      discarded: "bg-muted text-muted-foreground",
      returned: "bg-amber-100 text-amber-700",
    };
    return <Badge className={`${map[s] || ""} text-[11px]`}>{s.charAt(0).toUpperCase() + s.slice(1)}</Badge>;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Filters */}
      <div className="flex gap-3 px-4 py-2 border-b border-border shrink-0">
        <Select value={componentFilter} onValueChange={setComponentFilter}>
          <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Components</SelectItem>
            <SelectItem value="rbc">RBC</SelectItem>
            <SelectItem value="ffp">FFP</SelectItem>
            <SelectItem value="platelets">Platelets</SelectItem>
            <SelectItem value="whole_blood">Whole Blood</SelectItem>
            <SelectItem value="cryoprecipitate">Cryo</SelectItem>
          </SelectContent>
        </Select>
        <Select value={groupFilter} onValueChange={setGroupFilter}>
          <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Groups</SelectItem>
            {['A','B','AB','O'].flatMap(g => ['positive','negative'].map(r => (
              <SelectItem key={g+r} value={`${g}_${r}`}>{formatBloodGroup(g,r)}</SelectItem>
            )))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="reserved">Reserved</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground self-center">{units.length} units</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2">
        {/* Expiry alerts */}
        {expiringUnits.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
            <p className="text-sm font-semibold text-red-700 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" /> {expiringUnits.length} units expiring within 48 hours
            </p>
            <div className="mt-1.5 space-y-0.5">
              {expiringUnits.slice(0, 5).map(u => (
                <p key={u.id} className="text-xs text-red-600">
                  {u.unit_number} · {componentLabel(u.component)} · {formatBloodGroup(u.blood_group, u.rh_factor)} · expires {formatDistanceToNow(new Date(u.expiry_at), { addSuffix: true })}
                </p>
              ))}
            </div>
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Unit #</TableHead>
              <TableHead className="text-xs">Component</TableHead>
              <TableHead className="text-xs">Group</TableHead>
              <TableHead className="text-xs">Vol</TableHead>
              <TableHead className="text-xs">Collected</TableHead>
              <TableHead className="text-xs">Expires</TableHead>
              <TableHead className="text-xs">Location</TableHead>
              <TableHead className="text-xs">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {units.map(u => {
              const hrs = differenceInHours(new Date(u.expiry_at), new Date());
              const showTimer = u.status === "available" && hrs > 0;
              return (
                <TableRow key={u.id} className={getRowClass(u)}>
                  <TableCell className="text-xs font-mono">{u.unit_number}</TableCell>
                  <TableCell className="text-xs">{componentLabel(u.component)}</TableCell>
                  <TableCell className="text-xs font-semibold">{formatBloodGroup(u.blood_group, u.rh_factor)}</TableCell>
                  <TableCell className="text-xs">{u.volume_ml} ml</TableCell>
                  <TableCell className="text-xs">{format(new Date(u.collected_at), "dd/MM/yyyy")}</TableCell>
                  <TableCell className="text-xs">
                    {format(new Date(u.expiry_at), "dd/MM/yyyy")}
                    {showTimer && (u.component === "platelets" || hrs <= 72) && (
                      <span className={`ml-1 ${hrs < 24 ? "text-red-600 font-semibold" : "text-amber-600"}`}>
                        ({formatDistanceToNow(new Date(u.expiry_at))})
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{u.storage_location}</TableCell>
                  <TableCell>{statusBadge(u.status)}</TableCell>
                </TableRow>
              );
            })}
            {units.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">No units found</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default InventoryTab;
