import React, { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, Send } from "lucide-react";
import { useHospitalId } from "@/hooks/useHospitalId";
import RosterOptimizerPanel from "./RosterOptimizerPanel";
import EmptyState from "@/components/EmptyState";
import { format, addDays, startOfWeek, isSameDay, isToday } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface ShiftMaster {
  id: string;
  shift_name: string;
  shift_code: string;
  start_time: string;
  end_time: string;
  color_code: string;
}

interface StaffRow {
  id: string;
  full_name: string;
  role: string;
  department_name?: string;
  department_id?: string;
}

interface RosterEntry {
  id?: string;
  user_id: string;
  roster_date: string;
  shift_id: string | null;
  is_off: boolean;
  is_holiday: boolean;
}

const RosterTab: React.FC = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [shifts, setShifts] = useState<ShiftMaster[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [deptFilter, setDeptFilter] = useState("all");
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [openPopover, setOpenPopover] = useState<string | null>(null);
  const [dragData, setDragData] = useState<{ userId: string; fromDate: string; entry: RosterEntry } | null>(null);

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const loadData = useCallback(async () => {
    const dateFrom = format(weekDays[0], "yyyy-MM-dd");
    const dateTo = format(weekDays[6], "yyyy-MM-dd");

    const [shiftsRes, staffRes, rosterRes, deptRes] = await Promise.all([
      (supabase as any).from("shift_master").select("*").eq("is_active", true),
      supabase.from("users").select("id, full_name, role, department_id, departments(name)").eq("is_active", true).order("full_name"),
      (supabase as any).from("duty_roster").select("*").gte("roster_date", dateFrom).lte("roster_date", dateTo),
      supabase.from("departments").select("id, name").eq("is_active", true).order("name", { ascending: true }),
    ]);

    setShifts((shiftsRes.data || []) as ShiftMaster[]);
    setStaff(
      (staffRes.data || []).map((s: any) => ({
        id: s.id,
        full_name: s.full_name,
        role: s.role,
        department_id: s.department_id,
        department_name: s.departments?.name,
      }))
    );
    setRoster((rosterRes.data || []) as RosterEntry[]);
    setDepartments(deptRes.data || []);
  }, [weekStart]);

  useEffect(() => { loadData(); }, [loadData]);

  const filteredStaff = deptFilter === "all" ? staff : staff.filter((s) => s.department_id === deptFilter);

  const getEntry = (userId: string, date: Date) => {
    const dateStr = format(date, "yyyy-MM-dd");
    return roster.find((r) => r.user_id === userId && r.roster_date === dateStr);
  };

  const assignShift = async (userId: string, date: Date, shiftId: string | null, isOff = false) => {
    const dateStr = format(date, "yyyy-MM-dd");
    const { data: userData } = await supabase.from("users").select("hospital_id").eq("id", userId).maybeSingle();
    if (!userData) return;

    const { error } = await (supabase as any).from("duty_roster").upsert(
      {
        hospital_id: userData.hospital_id,
        user_id: userId,
        roster_date: dateStr,
        shift_id: shiftId,
        is_off: isOff,
        is_holiday: false,
      },
      { onConflict: "hospital_id,user_id,roster_date" }
    );

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setOpenPopover(null);
      loadData();
    }
  };

  const clearShift = async (userId: string, date: Date) => {
    const dateStr = format(date, "yyyy-MM-dd");
    const entry = getEntry(userId, date);
    if (entry?.id) {
      await (supabase as any).from("duty_roster").delete().eq("id", entry.id);
      loadData();
    }
    setOpenPopover(null);
  };

  const handleDragStart = (userId: string, date: Date, entry: RosterEntry) => {
    setDragData({ userId, fromDate: format(date, "yyyy-MM-dd"), entry });
  };

  const handleDrop = async (userId: string, toDate: Date) => {
    if (!dragData || dragData.userId !== userId) return;
    const toDateStr = format(toDate, "yyyy-MM-dd");
    if (dragData.fromDate === toDateStr) return;

    await assignShift(userId, toDate, dragData.entry.shift_id, dragData.entry.is_off);
    await clearShift(userId, new Date(dragData.fromDate));
    setDragData(null);
  };

  const roleColors: Record<string, string> = {
    doctor: "bg-primary/10 text-primary",
    nurse: "bg-success/10 text-success",
    pharmacist: "bg-accent/10 text-accent-foreground",
    lab_tech: "bg-secondary/10 text-secondary",
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Roster Header */}
      <div className="h-12 flex-shrink-0 bg-card border-b border-border flex items-center gap-3 px-5">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setWeekStart(addDays(weekStart, -7))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-semibold text-foreground min-w-[200px] text-center">
          Week of {format(weekDays[0], "dd")}–{format(weekDays[6], "dd MMM yyyy")}
        </span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setWeekStart(addDays(weekStart, 7))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" className="text-xs" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
          Today
        </Button>

        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="w-[180px] h-8 text-xs">
            <SelectValue placeholder="All Departments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto">
          <Button size="sm" className="bg-success text-success-foreground hover:bg-success/90 text-xs gap-1.5">
            <Send className="h-3 w-3" /> Publish Roster
          </Button>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              <th className="w-[200px] min-w-[200px] sticky left-0 bg-card z-20 text-left px-4 py-2 text-xs font-semibold text-muted-foreground border-b border-r border-border">
                Staff
              </th>
              {weekDays.map((day) => (
                <th
                  key={day.toISOString()}
                  className={cn(
                    "min-w-[110px] text-center px-2 py-2 text-xs font-medium border-b border-border",
                    isToday(day) ? "bg-primary/5 text-primary font-bold" : "text-muted-foreground"
                  )}
                >
                  <div>{format(day, "EEE")}</div>
                  <div className="text-[11px]">{format(day, "dd MMM")}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredStaff.map((s) => (
              <tr key={s.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="sticky left-0 bg-card z-10 px-4 py-2 border-r border-border">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                      {s.full_name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-foreground leading-tight">{s.full_name}</div>
                      <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full font-medium", roleColors[s.role] || "bg-muted text-muted-foreground")}>
                        {s.role}
                      </span>
                    </div>
                  </div>
                </td>
                {weekDays.map((day) => {
                  const entry = getEntry(s.id, day);
                  const shift = entry?.shift_id ? shifts.find((sh) => sh.id === entry.shift_id) : null;
                  const cellKey = `${s.id}-${format(day, "yyyy-MM-dd")}`;

                  return (
                    <td
                      key={cellKey}
                      className={cn(
                        "text-center px-1 py-1.5 border-border",
                        isToday(day) && "bg-primary/5"
                      )}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleDrop(s.id, day)}
                    >
                      <Popover open={openPopover === cellKey} onOpenChange={(o) => setOpenPopover(o ? cellKey : null)}>
                        <PopoverTrigger asChild>
                          <div className="min-h-[36px] flex items-center justify-center cursor-pointer rounded-md transition-colors hover:bg-muted/50">
                            {shift ? (
                              <div
                                draggable
                                onDragStart={() => handleDragStart(s.id, day, entry!)}
                                className="w-[92px] rounded-md px-2 py-1 text-left"
                                style={{
                                  backgroundColor: `${shift.color_code}20`,
                                  border: `1px solid ${shift.color_code}`,
                                }}
                              >
                                <div className="text-[11px] font-bold" style={{ color: shift.color_code }}>
                                  {shift.shift_code}
                                </div>
                                <div className="text-[9px] text-muted-foreground">
                                  {shift.start_time?.slice(0, 5)}–{shift.end_time?.slice(0, 5)}
                                </div>
                              </div>
                            ) : entry?.is_off ? (
                              <span className="text-[10px] px-3 py-1 rounded-full bg-muted text-muted-foreground font-medium">OFF</span>
                            ) : entry?.is_holiday ? (
                              <span className="text-[10px] px-2 py-1 rounded-full bg-accent/10 text-accent-foreground font-medium">🏖️</span>
                            ) : (
                              <span className="text-muted-foreground/30 text-lg">+</span>
                            )}
                          </div>
                        </PopoverTrigger>
                        <PopoverContent className="w-[200px] p-3" align="center">
                          <div className="text-xs font-semibold text-foreground mb-2">
                            {s.full_name} · {format(day, "EEE, dd MMM")}
                          </div>
                          <div className="flex flex-col gap-1.5">
                            {shifts.map((sh) => (
                              <button
                                key={sh.id}
                                onClick={() => assignShift(s.id, day, sh.id)}
                                className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors hover:opacity-80"
                                style={{
                                  backgroundColor: `${sh.color_code}15`,
                                  border: `1px solid ${sh.color_code}40`,
                                }}
                              >
                                <span className="font-bold" style={{ color: sh.color_code }}>{sh.shift_code}</span>
                                <span className="text-muted-foreground">{sh.shift_name}</span>
                              </button>
                            ))}
                            <button
                              onClick={() => assignShift(s.id, day, null, true)}
                              className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs bg-muted text-muted-foreground hover:bg-muted/80"
                            >
                              Day Off
                            </button>
                            {(shift || entry?.is_off) && (
                              <button
                                onClick={() => clearShift(s.id, day)}
                                className="text-[10px] text-destructive hover:underline mt-1 text-left"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </td>
                  );
                })}
              </tr>
            ))}
            {filteredStaff.length === 0 && (
              <tr>
                <td colSpan={8} className="h-48">
                  <EmptyState icon="👥" title="No roster for this week" description="Assign shifts by clicking empty cells in the grid" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Roster Optimizer — AI coverage gap analysis for next 7 days */}
      {hospitalId && (
        <div className="px-4 pb-4">
          <RosterOptimizerPanel hospitalId={hospitalId} />
        </div>
      )}
    </div>
  );
};

export default RosterTab;
