import React, { useState, useEffect } from "react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, isSameMonth } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STATUS_CFG: Record<string, { bg: string; text: string; abbr: string }> = {
  present:  { bg: "bg-success",      text: "text-white",               abbr: "P"  },
  absent:   { bg: "bg-destructive",  text: "text-white",               abbr: "A"  },
  half_day: { bg: "bg-amber-400",    text: "text-white",               abbr: "HD" },
  late:     { bg: "bg-orange-400",   text: "text-white",               abbr: "L"  },
  on_leave: { bg: "bg-blue-400",     text: "text-white",               abbr: "OL" },
  holiday:  { bg: "bg-slate-400",    text: "text-white",               abbr: "Ho" },
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface Props { hospitalId: string; }

const AttendanceCalendarView: React.FC<Props> = ({ hospitalId }) => {
  const [staff, setStaff] = useState<{ id: string; full_name: string }[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [viewDate, setViewDate] = useState(new Date());
  const [attendanceMap, setAttendanceMap] = useState<Record<string, string>>({});

  useEffect(() => {
    supabase
      .from("users")
      .select("id, full_name")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .order("full_name")
      .then(({ data }) => {
        const list = data || [];
        setStaff(list);
        if (list.length > 0) setSelectedUserId(list[0].id);
      });
  }, [hospitalId]);

  useEffect(() => {
    if (!selectedUserId) return;
    const from = format(startOfMonth(viewDate), "yyyy-MM-dd");
    const to   = format(endOfMonth(viewDate),   "yyyy-MM-dd");
    (supabase as any)
      .from("staff_attendance")
      .select("attendance_date, status")
      .eq("user_id", selectedUserId)
      .gte("attendance_date", from)
      .lte("attendance_date", to)
      .then(({ data }: { data: any[] }) => {
        const map: Record<string, string> = {};
        (data || []).forEach((r) => { map[r.attendance_date] = r.status; });
        setAttendanceMap(map);
      });
  }, [selectedUserId, viewDate]);

  const calStart = startOfWeek(startOfMonth(viewDate), { weekStartsOn: 1 });
  const calEnd   = endOfWeek(endOfMonth(viewDate),     { weekStartsOn: 1 });
  const days     = eachDayOfInterval({ start: calStart, end: calEnd });

  const summary = Object.values(attendanceMap).reduce<Record<string, number>>((acc, s) => {
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-4 p-5 overflow-y-auto flex-1">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={selectedUserId} onValueChange={setSelectedUserId}>
          <SelectTrigger className="w-[220px] h-8 text-xs">
            <SelectValue placeholder="Select staff member" />
          </SelectTrigger>
          <SelectContent>
            {staff.map((s) => (
              <SelectItem key={s.id} value={s.id} className="text-xs">{s.full_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1 ml-auto">
          <Button variant="outline" size="icon" className="h-7 w-7"
            onClick={() => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="text-sm font-semibold px-2 min-w-[130px] text-center">
            {format(viewDate, "MMMM yyyy")}
          </span>
          <Button variant="outline" size="icon" className="h-7 w-7"
            onClick={() => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex gap-2 flex-wrap">
        {Object.entries(summary).map(([status, count]) => {
          const cfg = STATUS_CFG[status];
          if (!cfg) return null;
          return (
            <span key={status} className={cn("px-2.5 py-0.5 rounded-full text-xs font-medium", cfg.bg, cfg.text)}>
              {status.replace("_", " ")} × {count}
            </span>
          );
        })}
      </div>

      {/* Calendar */}
      <div className="border rounded-xl overflow-hidden bg-card max-w-xl">
        <div className="grid grid-cols-7 bg-muted/40">
          {DAY_LABELS.map((d) => (
            <div key={d} className="py-2 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px bg-border">
          {days.map((day) => {
            const dateStr = format(day, "yyyy-MM-dd");
            const status  = attendanceMap[dateStr];
            const cfg     = status ? STATUS_CFG[status] : null;
            return (
              <div key={dateStr}
                className={cn("min-h-[52px] p-1.5 bg-card flex flex-col items-center gap-0.5",
                  !isSameMonth(day, viewDate) && "opacity-30")}>
                <span className="text-[11px] text-muted-foreground">{format(day, "d")}</span>
                {cfg && (
                  <span className={cn("w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold", cfg.bg, cfg.text)}>
                    {cfg.abbr}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-3 flex-wrap text-[10px] text-muted-foreground">
        {Object.entries(STATUS_CFG).map(([s, cfg]) => (
          <span key={s} className="flex items-center gap-1">
            <span className={cn("h-3.5 w-3.5 rounded-full inline-block", cfg.bg)} />
            {s.replace("_", " ")}
          </span>
        ))}
      </div>
    </div>
  );
};

export default AttendanceCalendarView;
