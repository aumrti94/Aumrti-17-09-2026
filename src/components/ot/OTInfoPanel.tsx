import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { format, isToday, addDays } from "date-fns";
import type { OTSchedule } from "@/pages/ot/OTPage";
import { formatDateForQuery } from "@/pages/ot/OTPage";
import OTUtilizationTab from "@/components/ot/tabs/OTUtilizationTab";

interface Props {
  schedules: OTSchedule[];
  selectedDate: Date;
  onSelectSchedule: (id: string) => void;
  hospitalId: string | null;
  onSetSelectedDate: (d: Date) => void;
  onSetSelectedRoom: (id: string) => void;
  onSetViewMode: (m: "day" | "week" | "month") => void;
}

const OTInfoPanel: React.FC<Props> = ({ schedules, selectedDate, onSelectSchedule, hospitalId, onSetSelectedDate, onSetSelectedRoom, onSetViewMode }) => {
  const [upcomingTab, setUpcomingTab] = useState<"today" | "tomorrow" | "week">("today");
  const [upcomingCases, setUpcomingCases] = useState<any[]>([]);
  const [allBookingsOpen, setAllBookingsOpen] = useState(false);
  const [allBookings, setAllBookings] = useState<any[]>([]);
  const [showUtilization, setShowUtilization] = useState(false);

  const total = schedules.length;
  const completed = schedules.filter((s) => s.status === "completed").length;
  const inProgress = schedules.filter((s) => s.status === "in_progress").length;
  const cancelled = schedules.filter((s) => s.status === "cancelled").length;

  // Fetch upcoming cases
  useEffect(() => {
    if (!hospitalId) return;
    const fetchUpcoming = async () => {
      const today = new Date();
      let startDate: string, endDate: string;
      if (upcomingTab === "today") {
        startDate = endDate = formatDateForQuery(today);
      } else if (upcomingTab === "tomorrow") {
        startDate = endDate = formatDateForQuery(addDays(today, 1));
      } else {
        startDate = formatDateForQuery(today);
        endDate = formatDateForQuery(addDays(today, 7));
      }

      const { data } = await supabase
        .from("ot_schedules")
        .select("id, surgery_name, scheduled_date, scheduled_start_time, scheduled_end_time, status, ot_room_id, estimated_duration_minutes, patient:patients(full_name, uhid), surgeon:users!ot_schedules_surgeon_id_fkey(full_name), ot_room:ot_rooms(name, type)")
        .gte("scheduled_date", startDate)
        .lte("scheduled_date", endDate)
        .in("status", ["scheduled", "confirmed", "in_progress"])
        .order("scheduled_date")
        .order("scheduled_start_time")
        .limit(20);

      setUpcomingCases((data as any) || []);
    };
    fetchUpcoming();
  }, [hospitalId, upcomingTab]);

  const fetchAllBookings = async () => {
    if (!hospitalId) return;
    const { data } = await supabase
      .from("ot_schedules")
      .select("*, patient:patients(full_name, uhid), surgeon:users!ot_schedules_surgeon_id_fkey(full_name), ot_room:ot_rooms(name, type)")
      .gte("scheduled_date", formatDateForQuery(new Date()))
      .order("scheduled_date")
      .order("scheduled_start_time")
      .limit(50);
    setAllBookings((data as any) || []);
    setAllBookingsOpen(true);
  };

  const stats = [
    { label: "Total Cases", value: total, color: "text-foreground" },
    { label: "Completed", value: completed, color: "text-emerald-600" },
    { label: "In Progress", value: inProgress, color: "text-orange-600" },
    { label: "Cancelled", value: cancelled, color: "text-destructive" },
  ];

  const borderColors: Record<string, string> = {
    scheduled: "border-l-slate-400",
    confirmed: "border-l-emerald-500",
    in_progress: "border-l-orange-500",
  };

  const handleCaseClick = (c: any) => {
    onSetSelectedDate(new Date(c.scheduled_date + "T00:00:00"));
    if (c.ot_room_id) onSetSelectedRoom(c.ot_room_id);
    onSetViewMode("day");
    onSelectSchedule(c.id);
  };

  return (
    <div className="w-full bg-card border-l border-border flex flex-col h-full overflow-hidden">
      {/* Today's summary */}
      <div className="p-4 border-b border-border flex-shrink-0">
        <p className="text-xs font-bold uppercase text-muted-foreground mb-2">Today's OT</p>
        <div className="grid grid-cols-2 gap-2">
          {stats.map((s) => (
            <div key={s.label} className="bg-muted/50 rounded-md p-2">
              <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Upcoming cases */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-bold uppercase text-muted-foreground">Upcoming Schedule</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-3">
          {(["today", "tomorrow", "week"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setUpcomingTab(tab)}
              className={cn(
                "text-[10px] px-2.5 py-1 rounded-full font-medium capitalize transition-colors",
                upcomingTab === tab
                  ? "bg-[hsl(var(--sidebar-accent))] text-white"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              )}
            >
              {tab === "week" ? "This Week" : tab}
            </button>
          ))}
        </div>

        {upcomingCases.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No upcoming cases</p>
        ) : (
          <div className="space-y-2">
            {upcomingCases.map((c) => {
              const caseDate = new Date(c.scheduled_date + "T00:00:00");
              const showDate = !isToday(caseDate);
              return (
                <button
                  key={c.id}
                  onClick={() => handleCaseClick(c)}
                  className={`w-full text-left bg-muted/30 rounded-lg p-2.5 border-l-[3px] ${borderColors[c.status] || "border-l-slate-300"} hover:bg-muted/60 transition-colors active:scale-[0.98]`}
                >
                  <div className="flex items-center justify-between">
                    {showDate && (
                      <span className="text-[9px] bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground">
                        {format(caseDate, "EEE, dd MMM")}
                      </span>
                    )}
                    <span className="text-xs font-bold text-primary ml-auto">
                      {c.scheduled_start_time.slice(0, 5)} — {c.scheduled_end_time.slice(0, 5)}
                    </span>
                  </div>
                  <p className="text-xs font-bold text-foreground truncate mt-0.5">{c.surgery_name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{c.patient?.full_name}</p>
                  <div className="flex items-center justify-between mt-0.5">
                    <p className="text-[10px] text-muted-foreground/70 truncate">Dr. {c.surgeon?.full_name}</p>
                    {c.ot_room && (
                      <span className="text-[8px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">{c.ot_room.name}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="p-4 border-t border-border flex-shrink-0">
        <p className="text-[11px] font-bold uppercase text-muted-foreground/70 mb-2">Quick Actions</p>
        <div className="space-y-1.5">
          <button
            onClick={fetchAllBookings}
            className="w-full text-left bg-muted text-foreground/80 text-xs px-3 py-2 rounded-md hover:bg-accent transition-colors active:scale-[0.98]"
          >
            📅 View All Bookings →
          </button>
          <button
            onClick={() => setShowUtilization(true)}
            className="w-full text-left bg-muted text-foreground/80 text-xs px-3 py-2 rounded-md hover:bg-accent transition-colors active:scale-[0.98]"
          >
            📊 OT Utilization Report →
          </button>
          {["📋 OT List Today", "✅ WHO Compliance"].map((label) => (
            <button
              key={label}
              className="w-full text-left bg-muted text-foreground/80 text-xs px-3 py-2 rounded-md hover:bg-accent transition-colors active:scale-[0.98]"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* OT Utilization Report Modal */}
      {showUtilization && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowUtilization(false)}>
          <div className="bg-card rounded-2xl w-full max-w-[560px] max-h-[85vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-border flex-shrink-0">
              <h2 className="text-lg font-bold text-foreground">📊 OT Utilization Report</h2>
              <button onClick={() => setShowUtilization(false)} className="text-muted-foreground hover:text-foreground text-lg">×</button>
            </div>
            <div className="flex-1 overflow-hidden">
              <OTUtilizationTab hospitalId={hospitalId} />
            </div>
          </div>
        </div>
      )}

      {/* All Bookings Modal */}
      {allBookingsOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setAllBookingsOpen(false)}>
          <div className="bg-card rounded-2xl w-full max-w-[800px] max-h-[80vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-border flex-shrink-0">
              <h2 className="text-lg font-bold text-foreground">All OT Bookings</h2>
              <button onClick={() => setAllBookingsOpen(false)} className="text-muted-foreground hover:text-foreground text-lg">×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {allBookings.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No upcoming bookings</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-2">Date</th>
                      <th className="py-2 pr-2">Time</th>
                      <th className="py-2 pr-2">Room</th>
                      <th className="py-2 pr-2">Surgery</th>
                      <th className="py-2 pr-2">Patient</th>
                      <th className="py-2 pr-2">Surgeon</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allBookings.map((b: any) => (
                      <tr
                        key={b.id}
                        className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                        onClick={() => { handleCaseClick(b); setAllBookingsOpen(false); }}
                      >
                        <td className="py-2 pr-2 text-xs">{format(new Date(b.scheduled_date + "T00:00:00"), "dd MMM")}</td>
                        <td className="py-2 pr-2 text-xs font-medium">{b.scheduled_start_time.slice(0, 5)}</td>
                        <td className="py-2 pr-2"><span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">{b.ot_room?.name}</span></td>
                        <td className="py-2 pr-2 text-xs font-bold truncate max-w-[140px]">{b.surgery_name}</td>
                        <td className="py-2 pr-2 text-xs truncate max-w-[120px]">{b.patient?.full_name}</td>
                        <td className="py-2 pr-2 text-xs text-muted-foreground">Dr. {b.surgeon?.full_name}</td>
                        <td className="py-2">
                          <span className={cn(
                            "text-[10px] px-2 py-0.5 rounded-full font-medium capitalize",
                            b.status === "scheduled" ? "bg-blue-50 text-blue-700" :
                            b.status === "confirmed" ? "bg-emerald-50 text-emerald-700" :
                            b.status === "in_progress" ? "bg-orange-50 text-orange-700" :
                            b.status === "completed" ? "bg-slate-50 text-slate-500" :
                            "bg-rose-50 text-rose-500"
                          )}>
                            {b.status.replace("_", " ")}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OTInfoPanel;
