import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import CollapsiblePanel from "@/components/layout/CollapsiblePanel";
import OTSchedulePanel from "@/components/ot/OTSchedulePanel";
import OTCaseWorkspace from "@/components/ot/OTCaseWorkspace";
import OTInfoPanel from "@/components/ot/OTInfoPanel";
import OTOptimizerPanel from "@/components/ot/OTOptimizerPanel";
import OTCancellationPredictor from "@/components/ot/OTCancellationPredictor";
import BookOTModal from "@/components/ot/BookOTModal";

export interface OTRoom {
  id: string;
  name: string;
  type: string;
}

export interface OTSchedule {
  id: string;
  hospital_id: string;
  ot_room_id: string;
  patient_id: string;
  admission_id: string | null;
  surgeon_id: string;
  anaesthetist_id: string | null;
  scrub_nurse_id: string | null;
  surgery_name: string;
  surgery_category: string;
  case_type: string;
  scheduled_date: string;
  scheduled_start_time: string;
  scheduled_end_time: string;
  estimated_duration_minutes: number;
  status: string;
  anaesthesia_type: string;
  booking_notes: string | null;
  cancellation_reason: string | null;
  post_op_diagnosis: string | null;
  actual_start_time: string | null;
  actual_end_time: string | null;
  implants_consumables: any;
  pac_done: boolean | null;
  pac_done_by: string | null;
  pac_done_at: string | null;
  pac_notes: string | null;
  pac_cleared: boolean | null;
  created_at: string;
  patient?: { full_name: string; uhid: string; blood_group: string | null; allergies: string | null; chronic_conditions: string[] | null; gender: string | null; dob: string | null };
  surgeon?: { full_name: string };
  anaesthetist?: { full_name: string };
  ot_room?: { name: string; type: string };
  admission?: { is_mlc: boolean | null } | null;
}

export const formatDateForQuery = (date: Date | string): string => {
  const d = typeof date === "string" ? new Date(date + (date.includes("T") ? "" : "T00:00:00")) : date;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const OTPage: React.FC = () => {
  const { toast } = useToast();
  const [rooms, setRooms] = useState<OTRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string>("all");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [schedules, setSchedules] = useState<OTSchedule[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);
  const [bookModalOpen, setBookModalOpen] = useState(false);
  const [bookModalTime, setBookModalTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"day" | "week" | "month">("day");
  const [hospitalId, setHospitalId] = useState<string | null>(null);

  // Get hospital ID once
  useEffect(() => {
    const getHospitalId = async () => {
      const res = await supabase.rpc("get_user_hospital_id") as any;
      if (res?.data) setHospitalId(res.data);
    };
    getHospitalId();
  }, []);

  const fetchRooms = useCallback(async () => {
    const { data } = await supabase
      .from("ot_rooms")
      .select("id, name, type")
      .eq("is_active", true)
      .order("name");
    if (data && data.length > 0) {
      setRooms(data);
    } else if (hospitalId) {
      const defaults = [
        { hospital_id: hospitalId, name: "OT-1 (Major)", type: "major" },
        { hospital_id: hospitalId, name: "OT-2 (Minor)", type: "minor" },
        { hospital_id: hospitalId, name: "OT-3 (Emergency)", type: "emergency" },
      ];
      const { data: created } = await supabase.from("ot_rooms").insert(defaults).select("id, name, type");
      if (created) setRooms(created);
    }
  }, [hospitalId]);

  const fetchSchedules = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);

    const dateStr = formatDateForQuery(selectedDate);
    let query = supabase
      .from("ot_schedules")
      .select("*, patient:patients(full_name, uhid, blood_group, allergies, chronic_conditions, gender, dob), surgeon:users!ot_schedules_surgeon_id_fkey(full_name), anaesthetist:users!ot_schedules_anaesthetist_id_fkey(full_name), ot_room:ot_rooms(name, type), admission:admissions(is_mlc)")
      .eq("scheduled_date", dateStr)
      .order("scheduled_start_time");

    if (selectedRoomId !== "all") {
      query = query.eq("ot_room_id", selectedRoomId);
    }

    const { data, error } = await query;
    
    setSchedules((data as any) || []);
    setLoading(false);
  }, [hospitalId, selectedRoomId, selectedDate]);

  useEffect(() => { if (hospitalId) fetchRooms(); }, [hospitalId]);
  useEffect(() => { if (hospitalId) fetchSchedules(); }, [hospitalId, selectedRoomId, selectedDate, fetchSchedules]);

  // Realtime subscription
  useEffect(() => {
    if (!hospitalId) return;
    const channel = supabase
      .channel("ot-realtime")
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "ot_schedules",
        filter: `hospital_id=eq.${hospitalId}`,
      }, () => {
        fetchSchedules();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [hospitalId, fetchSchedules]);

  const selectedSchedule = schedules.find((s) => s.id === selectedScheduleId) || null;

  const handleDateChange = (dir: number) => {
    setSelectedDate((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + dir);
      return d;
    });
  };

  const handleBookSlot = (time?: string) => {
    setBookModalTime(time || null);
    setBookModalOpen(true);
  };

  const handleBooked = (bookedDate?: string, bookedRoomId?: string) => {
    setBookModalOpen(false);
    if (bookedDate) {
      setSelectedDate(new Date(bookedDate + "T00:00:00"));
    }
    if (bookedRoomId) {
      setSelectedRoomId(bookedRoomId);
    }
    setViewMode("day");
    fetchSchedules();
  };

  return (
    <div className="flex h-[calc(100vh-56px)] overflow-hidden">
      <CollapsiblePanel panelKey="ot_schedule" title="OT Schedule" side="left" expandedWidth="w-80">
        <OTSchedulePanel
          rooms={rooms}
          selectedRoomId={selectedRoomId}
          onSelectRoom={setSelectedRoomId}
          selectedDate={selectedDate}
          onSetSelectedDate={setSelectedDate}
          onDateChange={handleDateChange}
          onSetToday={() => setSelectedDate(new Date())}
          schedules={schedules}
          selectedScheduleId={selectedScheduleId}
          onSelectSchedule={setSelectedScheduleId}
          onBookSlot={handleBookSlot}
          loading={loading}
          viewMode={viewMode}
          onSetViewMode={setViewMode}
          hospitalId={hospitalId}
        />
      </CollapsiblePanel>
      <OTCaseWorkspace
        schedule={selectedSchedule}
        hospitalId={hospitalId}
        onRefresh={fetchSchedules}
      />
      <CollapsiblePanel panelKey="ot_info" title="OT Info" side="right" expandedWidth="w-[300px]">
        <div className="flex flex-col h-full overflow-hidden border-l border-border">
          <OTInfoPanel
            schedules={schedules}
            selectedDate={selectedDate}
            onSelectSchedule={setSelectedScheduleId}
            hospitalId={hospitalId}
            onSetSelectedDate={setSelectedDate}
            onSetSelectedRoom={setSelectedRoomId}
            onSetViewMode={setViewMode}
          />
          <OTOptimizerPanel
            schedules={schedules}
            hospitalId={hospitalId}
            selectedDate={selectedDate}
          />
          <OTCancellationPredictor
            hospitalId={hospitalId}
            selectedDate={selectedDate}
          />
        </div>
      </CollapsiblePanel>
      {bookModalOpen && (
        <BookOTModal
          rooms={rooms}
          selectedRoomId={selectedRoomId === "all" ? (rooms[0]?.id || "") : selectedRoomId}
          selectedDate={formatDateForQuery(selectedDate)}
          prefillTime={bookModalTime}
          onClose={() => setBookModalOpen(false)}
          onBooked={handleBooked}
        />
      )}
    </div>
  );
};

export default OTPage;
