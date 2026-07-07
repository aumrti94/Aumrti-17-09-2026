import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { OTSchedule } from "@/pages/ot/OTPage";
import { getOnDutyStaff } from "@/lib/roster";

interface TeamMember {
  id: string;
  user_id: string;
  role_in_ot: string;
  confirmed: boolean;
  user?: { full_name: string };
}

interface StaffOption {
  id: string;
  full_name: string;
  role: string;
}

const ROLES = [
  { key: "primary_surgeon", label: "Primary Surgeon", filter: "doctor" },
  { key: "assistant_surgeon", label: "Assistant Surgeon", filter: "doctor" },
  { key: "anaesthetist", label: "Anaesthetist", filter: "doctor" },
  { key: "scrub_nurse", label: "Scrub Nurse", filter: "nurse" },
  { key: "circulating_nurse", label: "Circulating Nurse", filter: "nurse" },
  { key: "ot_technician", label: "OT Technician", filter: null },
];

const EQUIPMENT = [
  "OT table adjusted",
  "Anaesthesia machine ready",
  "Surgical instruments sterilised (CSSD)",
  "Blood ordered (if required)",
  "Imaging ready (C-arm, scope etc.)",
];

interface EquipmentRow {
  id: string;
  item_text: string;
  checked: boolean;
}

interface Props {
  schedule: OTSchedule;
}

const OTTeamTab: React.FC<Props> = ({ schedule }) => {
  const { toast } = useToast();
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [equipment, setEquipment] = useState<EquipmentRow[]>([]);
  const [onDutyIds, setOnDutyIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchTeam = async () => {
      const { data } = await supabase
        .from("ot_team_members")
        .select("*")
        .eq("ot_schedule_id", schedule.id);

      // Fetch user names for team members
      if (data && data.length > 0) {
        const userIds = data.map((t: any) => t.user_id);
        const { data: users } = await supabase
          .from("users")
          .select("id, full_name")
          .in("id", userIds);
        const userMap = new Map((users || []).map((u: any) => [u.id, u]));
        setTeam(data.map((t: any) => ({ ...t, user: userMap.get(t.user_id) })));
      } else {
        // Auto-populate primary surgeon from schedule
        setTeam([]);
      }
    };

    const fetchStaff = async () => {
      const { data } = await supabase
        .from("users")
        .select("id, full_name, role")
        .eq("is_active", true)
        .order("full_name");
      setStaff((data as any) || []);
    };

    const fetchEquipment = async () => {
      const { data } = await (supabase as any)
        .from("ot_equipment_checklist")
        .select("id, item_text, checked")
        .eq("ot_schedule_id", schedule.id);

      const existingTexts = new Set((data || []).map((r: any) => r.item_text));
      const missing = EQUIPMENT.filter((t) => !existingTexts.has(t));
      let rows: EquipmentRow[] = data || [];

      if (missing.length > 0) {
        const hid = (await supabase.rpc("get_user_hospital_id")) as any;
        const { data: created } = await (supabase as any)
          .from("ot_equipment_checklist")
          .insert(missing.map((item_text) => ({ hospital_id: hid.data, ot_schedule_id: schedule.id, item_text })))
          .select("id, item_text, checked");
        rows = [...rows, ...((created as EquipmentRow[]) || [])];
      }
      rows.sort((a, b) => EQUIPMENT.indexOf(a.item_text) - EQUIPMENT.indexOf(b.item_text));
      setEquipment(rows);
    };

    const fetchOnDuty = async () => {
      const { data: hid } = await supabase.rpc("get_user_hospital_id");
      if (hid && schedule.scheduled_date) {
        const onDuty = await getOnDutyStaff(hid as string, schedule.scheduled_date);
        setOnDutyIds(new Set(onDuty.map((s) => s.user_id)));
      }
    };

    fetchTeam();
    fetchStaff();
    fetchEquipment();
    fetchOnDuty();
  }, [schedule.id, schedule.scheduled_date]);

  const toggleEquipment = async (row: EquipmentRow) => {
    const next = !row.checked;
    setEquipment((prev) => prev.map((r) => (r.id === row.id ? { ...r, checked: next } : r)));
    const { data: { user } } = await supabase.auth.getUser();
    await (supabase as any)
      .from("ot_equipment_checklist")
      .update({ checked: next, checked_by: user?.id || null, checked_at: next ? new Date().toISOString() : null })
      .eq("id", row.id);
  };

  const assignRole = async (roleKey: string, userId: string) => {
    const existing = team.find((t) => t.role_in_ot === roleKey);
    if (existing) {
      await supabase.from("ot_team_members").update({ user_id: userId }).eq("id", existing.id);
    } else {
      await supabase.from("ot_team_members").insert({
        ot_schedule_id: schedule.id,
        user_id: userId,
        role_in_ot: roleKey,
        confirmed: true,
      });
    }

    // Refresh
    const { data } = await supabase.from("ot_team_members").select("*").eq("ot_schedule_id", schedule.id);
    if (data) {
      const userIds = data.map((t: any) => t.user_id);
      const { data: users } = await supabase.from("users").select("id, full_name").in("id", userIds);
      const userMap = new Map((users || []).map((u: any) => [u.id, u]));
      setTeam(data.map((t: any) => ({ ...t, user: userMap.get(t.user_id) })));
    }
    toast({ title: "Team member assigned ✓" });
  };

  const getAssigned = (roleKey: string) => team.find((t) => t.role_in_ot === roleKey);

  const getFilteredStaff = (filter: string | null) => {
    const list = filter ? staff.filter((s) => s.role === filter) : staff;
    // Surface rostered-on-duty staff first
    return [...list].sort((a, b) => (onDutyIds.has(b.id) ? 1 : 0) - (onDutyIds.has(a.id) ? 1 : 0));
  };

  return (
    <div className="p-4 h-full overflow-y-auto">
      <div className="grid grid-cols-2 gap-4">
        {/* Team roster */}
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-[13px] font-bold text-foreground mb-3">OT Team for this case</p>
          <div className="space-y-3">
            {ROLES.map(({ key, label, filter }) => {
              const assigned = getAssigned(key);
              const filteredStaff = getFilteredStaff(filter);
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-32 flex-shrink-0">{label}</span>
                  {assigned?.user ? (
                    <div className="flex items-center gap-2 flex-1">
                      <span className="text-[13px] font-medium text-foreground">{assigned.user.full_name}</span>
                      <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">Confirmed</span>
                    </div>
                  ) : (
                    <select
                      className="flex-1 text-xs border border-border rounded-md px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                      value=""
                      onChange={(e) => e.target.value && assignRole(key, e.target.value)}
                    >
                      <option value="">Select...</option>
                      {filteredStaff.map((s) => (
                        <option key={s.id} value={s.id}>{s.full_name}{onDutyIds.has(s.id) ? " • On duty" : ""}</option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Equipment checklist */}
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-[13px] font-bold text-foreground mb-3">Equipment Ready?</p>
          <div className="space-y-2">
            {equipment.map((row) => (
              <button
                key={row.id}
                onClick={() => toggleEquipment(row)}
                className="flex items-center gap-3 w-full text-left py-2"
              >
                <div className={`w-5 h-5 rounded-sm border-2 flex items-center justify-center flex-shrink-0 transition-colors ${row.checked ? "bg-emerald-500 border-emerald-500" : "border-muted-foreground/30"}`}>
                  {row.checked && <span className="text-white text-xs">✓</span>}
                </div>
                <span className="text-[13px] text-foreground/80">{row.item_text}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OTTeamTab;
