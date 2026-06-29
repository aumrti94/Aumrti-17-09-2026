import React, { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Plus, Calendar as CalendarIcon, LayoutGrid, CalendarDays } from "lucide-react";
import { useHospitalContext } from "@/contexts/HospitalContext";
import { hasActionAccess } from "@/lib/tabPermissions";
import { format, startOfWeek, endOfWeek, addDays, startOfMonth, endOfMonth, isSameDay, isToday, addMonths, subMonths } from "date-fns";
import { Progress } from "@/components/ui/progress";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import type { OTRoom, OTSchedule } from "@/pages/ot/OTPage";
import { formatDateForQuery } from "@/pages/ot/OTPage";

interface Props {
  rooms: OTRoom[];
  selectedRoomId: string;
  onSelectRoom: (id: string) => void;
  selectedDate: Date;
  onSetSelectedDate: (d: Date) => void;
  onDateChange: (dir: number) => void;
  onSetToday: () => void;
  schedules: OTSchedule[];
  selectedScheduleId: string | null;
  onSelectSchedule: (id: string) => void;
  onBookSlot: (time?: string) => void;
  loading: boolean;
  viewMode: "day" | "week" | "month";
  onSetViewMode: (m: "day" | "week" | "month") => void;
  hospitalId: string | null;
}

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  scheduled: { bg: "bg-blue-50", border: "border-l-blue-500", text: "text-blue-700" },
  confirmed: { bg: "bg-emerald-50", border: "border-l-emerald-500", text: "text-emerald-700" },
  in_progress: { bg: "bg-orange-50", border: "border-l-orange-500", text: "text-orange-700" },
  completed: { bg: "bg-slate-50", border: "border-l-slate-400", text: "text-slate-500" },
  cancelled: { bg: "bg-rose-50", border: "border-l-rose-500", text: "text-rose-500" },
  postponed: { bg: "bg-amber-50", border: "border-l-amber-500", text: "text-amber-600" },
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  confirmed: "Confirmed ✓",
  in_progress: "🔴 LIVE",
  completed: "Done",
  cancelled: "Cancelled",
  postponed: "Postponed",
};

const HOURS = Array.from({ length: 15 }, (_, i) => i + 7);

const OTSchedulePanel: React.FC<Props> = ({
  rooms, selectedRoomId, onSelectRoom, selectedDate, onSetSelectedDate, onDateChange, onSetToday,
  schedules, selectedScheduleId, onSelectSchedule, onBookSlot, loading,
  viewMode, onSetViewMode, hospitalId,
}) => {
  const { permissions, role } = useHospitalContext();
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [weekSchedules, setWeekSchedules] = useState<OTSchedule[]>([]);
  const [monthSchedules, setMonthSchedules] = useState<OTSchedule[]>([]);

  // Fetch week/month data
  useEffect(() => {
    if (!hospitalId || viewMode === "day") return;
    const fetchRange = async () => {
      let startDate: Date, endDate: Date;
      if (viewMode === "week") {
        startDate = startOfWeek(selectedDate, { weekStartsOn: 1 });
        endDate = endOfWeek(selectedDate, { weekStartsOn: 1 });
      } else {
        startDate = startOfMonth(selectedDate);
        endDate = endOfMonth(selectedDate);
      }
      let query = supabase
        .from("ot_schedules")
        .select("*, patient:patients(full_name, uhid), surgeon:users!ot_schedules_surgeon_id_fkey(full_name), ot_room:ot_rooms(name, type)")
        .gte("scheduled_date", formatDateForQuery(startDate))
        .lte("scheduled_date", formatDateForQuery(endDate))
        .order("scheduled_date")
        .order("scheduled_start_time");

      if (selectedRoomId !== "all") {
        query = query.eq("ot_room_id", selectedRoomId);
      }

      const { data } = await query;
      if (viewMode === "week") setWeekSchedules((data as any) || []);
      else setMonthSchedules((data as any) || []);
    };
    fetchRange();
  }, [hospitalId, viewMode, selectedDate, selectedRoomId]);

  const counts = {
    scheduled: schedules.filter((s) => s.status === "scheduled" || s.status === "confirmed").length,
    in_progress: schedules.filter((s) => s.status === "in_progress").length,
    completed: schedules.filter((s) => s.status === "completed").length,
    cancelled: schedules.filter((s) => s.status === "cancelled").length,
  };

  const totalAvailMin = 14 * 60;
  const totalUsedMin = schedules
    .filter((s) => ["completed", "in_progress"].includes(s.status))
    .reduce((sum, s) => sum + s.estimated_duration_minutes, 0);
  const utilization = totalAvailMin > 0 ? Math.round((totalUsedMin / totalAvailMin) * 100) : 0;

  const timeToMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };

  const slotHeight = 36;
  const baseMin = 7 * 60;
  const pxPerMin = slotHeight / 30;

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId);

  const dateLabel = (() => {
    const formatted = format(selectedDate, "EEEE, dd MMMM yyyy");
    if (isToday(selectedDate)) return `${formatted} (Today)`;
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    if (isSameDay(selectedDate, yesterday)) return `${formatted} (Yesterday)`;
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    if (isSameDay(selectedDate, tomorrow)) return `${formatted} (Tomorrow)`;
    return formatted;
  })();

  return (
    <div className="w-full bg-card border-r border-border flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-border flex-shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-foreground">OT Schedule</span>
          <div className="flex items-center gap-1.5">
            {/* View toggle */}
            <div className="flex rounded-md border border-border overflow-hidden">
              {(["day", "week", "month"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => onSetViewMode(m)}
                  className={cn(
                    "text-[10px] px-2 py-1 font-medium transition-colors capitalize",
                    viewMode === m
                      ? "bg-[hsl(var(--sidebar-accent))] text-white"
                      : "bg-muted text-muted-foreground hover:bg-accent"
                  )}
                >
                  {m === "day" ? "📅" : m === "week" ? "📆" : "📊"} {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
            {hasActionAccess("ot", "book_case", permissions, role) && (
              <button
                onClick={() => onBookSlot()}
                className="flex items-center gap-1 bg-[hsl(var(--sidebar-accent))] text-white text-[11px] font-semibold px-3 py-1.5 rounded-md hover:opacity-90 active:scale-95 transition-all"
              >
                <Plus size={14} /> Book OT
              </button>
            )}
          </div>
        </div>

        {/* Date navigation */}
        <div className="flex items-center gap-2 mt-2">
          <button onClick={() => {
            if (viewMode === "month") onSetSelectedDate(subMonths(selectedDate, 1));
            else if (viewMode === "week") onSetSelectedDate(addDays(selectedDate, -7));
            else onDateChange(-1);
          }} className="h-7 w-7 rounded-full bg-muted flex items-center justify-center hover:bg-accent transition-colors active:scale-95">
            <ChevronLeft size={14} />
          </button>

          <Popover open={showDatePicker} onOpenChange={setShowDatePicker}>
            <PopoverTrigger asChild>
              <button className="text-[13px] font-medium text-foreground flex-1 text-center hover:text-primary transition-colors cursor-pointer flex items-center justify-center gap-1.5">
                <CalendarIcon size={13} className="text-muted-foreground" />
                {viewMode === "month"
                  ? format(selectedDate, "MMMM yyyy")
                  : viewMode === "week"
                    ? `${format(startOfWeek(selectedDate, { weekStartsOn: 1 }), "dd MMM")} — ${format(endOfWeek(selectedDate, { weekStartsOn: 1 }), "dd MMM yyyy")}`
                    : dateLabel}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="center">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(d) => { if (d) { onSetSelectedDate(d); setShowDatePicker(false); } }}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
              <div className="flex gap-2 px-3 pb-3">
                {[
                  { label: "Yesterday", offset: -1 },
                  { label: "Today", offset: 0 },
                  { label: "Tomorrow", offset: 1 },
                ].map((q) => (
                  <button
                    key={q.label}
                    onClick={() => {
                      const d = new Date();
                      d.setDate(d.getDate() + q.offset);
                      onSetSelectedDate(d);
                      setShowDatePicker(false);
                    }}
                    className="flex-1 text-xs bg-muted text-muted-foreground px-2 py-1.5 rounded-md hover:bg-accent transition-colors"
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <button onClick={() => {
            if (viewMode === "month") onSetSelectedDate(addMonths(selectedDate, 1));
            else if (viewMode === "week") onSetSelectedDate(addDays(selectedDate, 7));
            else onDateChange(1);
          }} className="h-7 w-7 rounded-full bg-muted flex items-center justify-center hover:bg-accent transition-colors active:scale-95">
            <ChevronRight size={14} />
          </button>
          <button onClick={onSetToday} className="text-[11px] text-primary font-medium hover:underline">Today</button>
        </div>
      </div>

      {/* Room dropdown */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-shrink-0">
        <span className="text-[11px] text-muted-foreground font-medium">OT ROOM</span>
        <select
          value={selectedRoomId}
          onChange={(e) => onSelectRoom(e.target.value)}
          className="flex-1 px-2.5 py-1.5 border border-border rounded-lg text-[13px] text-foreground font-medium bg-background cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="all">📋 All Rooms</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.type === "major" ? "🏥" : r.type === "minor" ? "🔧" : r.type === "emergency" ? "🚨" : "📋"} {r.name}
            </option>
          ))}
        </select>
        {selectedRoomId !== "all" && selectedRoom && (
          <span className={cn(
            "text-[10px] px-2 py-0.5 rounded-full font-medium uppercase",
            selectedRoom.type === "major" ? "bg-blue-50 text-blue-700" :
            selectedRoom.type === "emergency" ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-700"
          )}>
            {selectedRoom.type}
          </span>
        )}
      </div>

      {/* Day stats */}
      {viewMode === "day" && (
        <div className="flex gap-3 px-3 py-1.5 border-b border-border bg-muted/30 flex-shrink-0 text-[11px] text-muted-foreground">
          <span>🔵 {counts.scheduled} Scheduled</span>
          <span>🟢 {counts.in_progress} Live</span>
          <span>✓ {counts.completed} Done</span>
          <span>🔴 {counts.cancelled} Cancelled</span>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        {viewMode === "day" && (
          <DayTimeline
            schedules={schedules}
            selectedScheduleId={selectedScheduleId}
            onSelectSchedule={onSelectSchedule}
            onBookSlot={onBookSlot}
            selectedRoomId={selectedRoomId}
            slotHeight={slotHeight}
            baseMin={baseMin}
            pxPerMin={pxPerMin}
            timeToMinutes={timeToMinutes}
          />
        )}
        {viewMode === "week" && (
          <WeekView
            selectedDate={selectedDate}
            schedules={weekSchedules}
            onSelectDate={(d) => { onSetSelectedDate(d); onSetViewMode("day"); }}
            onSelectSchedule={onSelectSchedule}
          />
        )}
        {viewMode === "month" && (
          <MonthView
            selectedDate={selectedDate}
            schedules={monthSchedules}
            onSelectDate={(d) => { onSetSelectedDate(d); onSetViewMode("day"); }}
          />
        )}
      </div>

      {/* Footer */}
      {viewMode === "day" && (
        <div className="border-t border-border px-3 py-2 flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-muted-foreground">Today's utilization</span>
            <span className="text-[11px] font-bold text-foreground">{utilization}%</span>
          </div>
          <Progress value={utilization} className="h-1" />
        </div>
      )}
    </div>
  );
};

// Day Timeline sub-component
const DayTimeline: React.FC<{
  schedules: OTSchedule[];
  selectedScheduleId: string | null;
  onSelectSchedule: (id: string) => void;
  onBookSlot: (time?: string) => void;
  selectedRoomId: string;
  slotHeight: number;
  baseMin: number;
  pxPerMin: number;
  timeToMinutes: (t: string) => number;
}> = ({ schedules, selectedScheduleId, onSelectSchedule, onBookSlot, selectedRoomId, slotHeight, baseMin, pxPerMin, timeToMinutes }) => (
  <div className="px-2 py-1 relative" style={{ height: HOURS.length * 2 * slotHeight, position: "relative" }}>
    {HOURS.map((h) => (
      <div key={h} style={{ position: "absolute", top: (h - 7) * 2 * slotHeight, width: "100%" }}>
        <div className="flex items-start">
          <span className="text-[10px] text-muted-foreground w-10 text-right pr-2 pt-0.5">
            {h > 12 ? `${h - 12} PM` : h === 12 ? "12 PM" : `${h} AM`}
          </span>
          <div className="flex-1 border-t border-dashed border-border" />
        </div>
      </div>
    ))}

    {schedules.map((s) => {
      const startMin = timeToMinutes(s.scheduled_start_time);
      const topPx = (startMin - baseMin) * pxPerMin;
      const heightPx = Math.max(s.estimated_duration_minutes * pxPerMin, slotHeight);
      const colors = STATUS_COLORS[s.status] || STATUS_COLORS.scheduled;

      return (
        <div
          key={s.id}
          className={cn(
            "absolute left-10 right-1 rounded-r-md border-l-[3px] cursor-pointer overflow-hidden transition-shadow hover:shadow-md",
            colors.bg, colors.border,
            selectedScheduleId === s.id && "ring-2 ring-primary/30",
            s.status === "completed" && "opacity-70",
            s.status === "cancelled" && "opacity-60"
          )}
          style={{ top: Math.max(topPx, 0), height: heightPx, zIndex: 10 }}
          onClick={() => onSelectSchedule(s.id)}
        >
          <div className="px-2 py-1">
            <div className="flex items-center justify-between">
              <span className={cn("text-xs font-bold truncate", s.status === "cancelled" && "line-through")}>
                {s.surgery_name}
              </span>
              <span className="text-[9px] text-muted-foreground ml-1 whitespace-nowrap">
                {s.estimated_duration_minutes}m
              </span>
            </div>
            {heightPx > slotHeight && (
              <>
                <p className="text-[11px] text-foreground/80 truncate">{s.patient?.full_name}</p>
                <p className="text-[10px] text-muted-foreground truncate">Dr. {s.surgeon?.full_name}</p>
              </>
            )}
            <div className="flex items-center justify-between">
              <span className={cn("text-[9px] font-medium", colors.text)}>
                {s.status === "in_progress" && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 mr-1 animate-pulse" />}
                {STATUS_LABELS[s.status]}
              </span>
              <div className="flex items-center gap-1">
                {s.admission?.is_mlc && (
                  <span className="text-[8px] bg-red-600 text-white px-1.5 py-0.5 rounded-full font-bold">MLC</span>
                )}
                {s.status === "scheduled" && !s.pac_cleared && (
                  <span className="text-[8px] bg-amber-500 text-white px-1.5 py-0.5 rounded-full font-bold">PAC⚠</span>
                )}
                {selectedRoomId === "all" && s.ot_room && (
                  <span className="text-[8px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">{s.ot_room.name}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    })}
  </div>
);

// Week View
const WeekView: React.FC<{
  selectedDate: Date;
  schedules: OTSchedule[];
  onSelectDate: (d: Date) => void;
  onSelectSchedule: (id: string) => void;
}> = ({ selectedDate, schedules, onSelectDate, onSelectSchedule }) => {
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const getSchedulesForDay = (d: Date) => {
    const dateStr = formatDateForQuery(d);
    return schedules.filter((s) => s.scheduled_date === dateStr);
  };

  return (
    <div className="grid grid-cols-7 h-full">
      {days.map((day) => {
        const dayCases = getSchedulesForDay(day);
        const today = isToday(day);
        return (
          <div
            key={day.toISOString()}
            className={cn("border-r border-border last:border-r-0 flex flex-col", today && "bg-primary/5")}
          >
            <button
              onClick={() => onSelectDate(day)}
              className={cn(
                "px-1 py-2 text-center border-b border-border flex-shrink-0 hover:bg-accent transition-colors",
                today && "border-b-2 border-b-primary"
              )}
            >
              <p className="text-[10px] font-medium text-muted-foreground">{format(day, "EEE")}</p>
              <p className={cn("text-sm font-bold", today ? "text-primary" : "text-foreground")}>{format(day, "d")}</p>
              {dayCases.length > 0 && (
                <span className="text-[9px] bg-primary/10 text-primary px-1.5 rounded-full">{dayCases.length}</span>
              )}
            </button>
            <div className="flex-1 overflow-y-auto p-0.5 space-y-0.5">
              {dayCases.map((s) => {
                const colors = STATUS_COLORS[s.status] || STATUS_COLORS.scheduled;
                return (
                  <button
                    key={s.id}
                    onClick={() => { onSelectDate(day); onSelectSchedule(s.id); }}
                    className={cn("w-full text-left rounded p-1 border-l-2", colors.bg, colors.border, "hover:shadow-sm transition-shadow")}
                  >
                    <p className="text-[9px] font-bold text-primary">{s.scheduled_start_time.slice(0, 5)}</p>
                    <p className="text-[9px] font-medium text-foreground truncate">{s.surgery_name}</p>
                    <p className="text-[8px] text-muted-foreground truncate">{s.patient?.full_name}</p>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// Month View
const MonthView: React.FC<{
  selectedDate: Date;
  schedules: OTSchedule[];
  onSelectDate: (d: Date) => void;
}> = ({ selectedDate, schedules, onSelectDate }) => {
  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });

  const weeks: Date[][] = [];
  let current = calStart;
  while (current <= monthEnd || weeks.length < 5) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(current);
      current = addDays(current, 1);
    }
    weeks.push(week);
    if (weeks.length >= 6) break;
  }

  const getCount = (d: Date) => {
    const dateStr = formatDateForQuery(d);
    return schedules.filter((s) => s.scheduled_date === dateStr);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="grid grid-cols-7 border-b border-border">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="text-center text-[10px] font-medium text-muted-foreground py-1.5">{d}</div>
        ))}
      </div>
      <div className="flex-1 grid grid-cols-7 grid-rows-5">
        {weeks.flat().map((day, idx) => {
          const inMonth = day.getMonth() === selectedDate.getMonth();
          const today = isToday(day);
          const dayCases = getCount(day);

          return (
            <button
              key={idx}
              onClick={() => onSelectDate(day)}
              className={cn(
                "border-r border-b border-border p-1 text-left hover:bg-accent/50 transition-colors flex flex-col",
                !inMonth && "opacity-40",
                today && "bg-primary/5"
              )}
            >
              <span className={cn(
                "text-[11px] font-medium self-end",
                today ? "bg-primary text-primary-foreground w-5 h-5 rounded-full flex items-center justify-center" : "text-foreground"
              )}>
                {format(day, "d")}
              </span>
              <div className="mt-0.5 space-y-0.5 flex-1 overflow-hidden">
                {dayCases.slice(0, 3).map((s) => (
                  <div key={s.id} className="text-[8px] bg-primary/10 text-primary px-1 rounded truncate">
                    {s.surgery_name}
                  </div>
                ))}
                {dayCases.length > 3 && (
                  <span className="text-[8px] text-muted-foreground">+{dayCases.length - 3} more</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default OTSchedulePanel;
