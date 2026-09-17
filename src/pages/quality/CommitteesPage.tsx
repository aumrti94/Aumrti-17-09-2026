import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { callAI } from "@/lib/aiProvider";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus, Loader2, Brain, CheckCircle2, RefreshCw,
  Users, CalendarDays, ClipboardList, Trash2, AlertTriangle,
  ChevronRight, UserPlus, Building2, Eye, EyeOff, LayoutGrid, Table2,
} from "lucide-react";
import { format, isPast, parseISO } from "date-fns";
import { getCommitteeTemplate } from "@/constants/committeeTemplates";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Committee {
  id: string;
  name: string;
  description: string | null;
  chairperson_id: string | null;
  secretary_id: string | null;
  is_active: boolean;
  created_at: string;
  chairperson?: { full_name: string } | null;
  secretary?: { full_name: string } | null;
}

interface CommitteeMember {
  id: string;
  committee_id: string;
  user_id: string | null;
  member_name: string | null;
  member_role: string | null;
  designation: string | null;
  is_core_member: boolean;
  users?: { full_name: string; role?: string } | null;
}

interface Meeting {
  id: string;
  committee_id: string;
  meeting_date: string;
  venue: string | null;
  quorum_met: boolean | null;
  agenda: string | null;
  minutes: string | null;
  nabh_chapters_covered: string[] | null;
  ai_minutes_used: boolean;
  created_at: string;
}

interface ActionItem {
  id: string;
  meeting_id: string;
  description: string;
  responsible_owner_id: string | null;
  owner_name: string | null;
  due_date: string | null;
  status: string;
  completion_notes: string | null;
  users?: { full_name: string } | null;
  // enriched client-side
  committee_name?: string;
  meeting_date?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const NABH_CHAPTERS = [
  { code: "AAC", name: "Access, Assessment & Continuity" },
  { code: "COP", name: "Care of Patients" },
  { code: "MOM", name: "Management of Medications" },
  { code: "PRE", name: "Patient Rights & Education" },
  { code: "HIC", name: "Infection Control" },
  { code: "ROM", name: "Responsibilities of Management" },
  { code: "FMS", name: "Facility Management & Safety" },
  { code: "HRM", name: "Human Resource Management" },
  { code: "IMS", name: "Information Management" },
  { code: "QPS", name: "Quality & Patient Safety" },
];

const SUGGESTED_COMMITTEES = [
  "Quality & Safety Committee",
  "IPC Committee",
  "OT Committee",
  "Pharmacy & Therapeutics Committee",
  "Mortality & Morbidity Committee",
  "Blood Transfusion Committee",
  "Ethics Committee",
  "NABH Steering Committee",
  "Biomedical Waste Committee",
  "Disaster Management Committee",
];


const ACTION_STATUS_COLOUR: Record<string, string> = {
  open: "bg-red-100 text-red-700",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  deferred: "bg-amber-100 text-amber-700",
  cancelled: "bg-gray-100 text-gray-500",
};

const KANBAN_COLUMNS = [
  { id: "open",        label: "Open",        headerColour: "bg-red-100 text-red-700",    dropColour: "bg-red-50/50"    },
  { id: "in_progress", label: "In Progress", headerColour: "bg-blue-100 text-blue-700",  dropColour: "bg-blue-50/50"   },
  { id: "completed",   label: "Completed",   headerColour: "bg-green-100 text-green-700", dropColour: "bg-green-50/50" },
  { id: "deferred",    label: "Deferred",    headerColour: "bg-amber-100 text-amber-700", dropColour: "bg-amber-50/50" },
] as const;

// ─── Create Committee Dialog ──────────────────────────────────────────────────

interface CreateCommitteeProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  hospitalId: string;
  staffUsers: { id: string; full_name: string }[];
  onCreated: (c: Committee) => void;
}

const CreateCommitteeDialog: React.FC<CreateCommitteeProps> = ({
  open, onOpenChange, hospitalId, staffUsers, onCreated,
}) => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [chairId, setChairId] = useState("");
  const [secId, setSecId] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(true);

  const reset = () => { setName(""); setDescription(""); setChairId(""); setSecId(""); setShowSuggestions(true); };

  const save = async () => {
    if (!name.trim()) { toast({ title: "Committee name required", variant: "destructive" }); return; }
    setSaving(true);
    const { data, error } = await (supabase as any).from("hospital_committees").insert({
      hospital_id: hospitalId,
      name: name.trim(),
      description: description || null,
      chairperson_id: chairId || null,
      secretary_id: secId || null,
    }).select("*, chairperson:chairperson_id(full_name), secretary:secretary_id(full_name)").maybeSingle();
    setSaving(false);
    if (error || !data) { toast({ title: "Failed", description: error?.message, variant: "destructive" }); return; }
    toast({ title: "Committee created", description: data.name });
    onCreated(data);
    onOpenChange(false);
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={v => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New Committee</DialogTitle></DialogHeader>
        <div className="space-y-3 mt-1">
          {showSuggestions && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Quick-select a common committee:</p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {SUGGESTED_COMMITTEES.map(s => (
                  <button key={s} onClick={() => { setName(s); setShowSuggestions(false); }}
                    className="px-2 py-0.5 rounded-full bg-muted hover:bg-primary/10 hover:text-primary text-xs transition-colors border">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <Label>Committee Name *</Label>
            <Input className="h-8 text-sm mt-1" placeholder="e.g. Quality & Safety Committee"
              value={name} onChange={e => { setName(e.target.value); setShowSuggestions(false); }} />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea className="text-sm mt-1 h-16 resize-none" placeholder="Purpose and scope of this committee"
              value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Chairperson</Label>
              <Select value={chairId} onValueChange={setChairId}>
                <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{staffUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Secretary</Label>
              <Select value={secId} onValueChange={setSecId}>
                <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{staffUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving || !name.trim()}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />} Create Committee
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ─── Add Member Dialog ────────────────────────────────────────────────────────

interface AddMemberProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  committeeId: string;
  staffUsers: { id: string; full_name: string }[];
  onAdded: (m: CommitteeMember) => void;
}

const AddMemberDialog: React.FC<AddMemberProps> = ({
  open, onOpenChange, committeeId, staffUsers, onAdded,
}) => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState("");
  const [memberName, setMemberName] = useState("");
  const [designation, setDesignation] = useState("");
  const [memberRole, setMemberRole] = useState("Member");
  const [isCore, setIsCore] = useState(false);
  const [mode, setMode] = useState<"system" | "external">("system");

  const save = async () => {
    const payload: any = {
      committee_id: committeeId,
      member_role: memberRole,
      is_core_member: isCore,
    };
    if (mode === "system") {
      if (!userId) { toast({ title: "Select a user", variant: "destructive" }); return; }
      payload.user_id = userId;
    } else {
      if (!memberName.trim()) { toast({ title: "Member name required", variant: "destructive" }); return; }
      payload.member_name = memberName.trim();
      payload.designation = designation || null;
    }
    setSaving(true);
    const { data, error } = await (supabase as any).from("committee_members")
      .insert(payload).select("*, users(full_name, role)").maybeSingle();
    setSaving(false);
    if (error || !data) { toast({ title: "Failed", description: error?.message, variant: "destructive" }); return; }
    onAdded(data);
    onOpenChange(false);
    setUserId(""); setMemberName(""); setDesignation(""); setMemberRole("Member"); setIsCore(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Add Committee Member</DialogTitle></DialogHeader>
        <div className="space-y-3 mt-1">
          <div className="flex gap-2">
            {[{ v: "system", l: "HMS User" }, { v: "external", l: "External" }].map(o => (
              <button key={o.v} onClick={() => setMode(o.v as any)}
                className={cn("flex-1 py-1.5 rounded border text-xs font-medium transition-colors",
                  mode === o.v ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted")}>
                {o.l}
              </button>
            ))}
          </div>
          {mode === "system" ? (
            <div><Label>Staff Member</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Select user" /></SelectTrigger>
                <SelectContent>{staffUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-2">
              <div><Label>Name *</Label>
                <Input className="h-8 text-sm mt-1" value={memberName} onChange={e => setMemberName(e.target.value)} />
              </div>
              <div><Label>Designation</Label>
                <Input className="h-8 text-sm mt-1" placeholder="e.g. Consultant Physician" value={designation} onChange={e => setDesignation(e.target.value)} />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Role</Label>
              <Select value={memberRole} onValueChange={setMemberRole}>
                <SelectTrigger className="h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Member", "Invitee", "Advisor", "Observer"].map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end pb-1">
              <div className="flex items-center gap-2">
                <Checkbox id="core" checked={isCore} onCheckedChange={v => setIsCore(!!v)} />
                <Label htmlFor="core" className="text-xs cursor-pointer">Core member</Label>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />} Add Member
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ─── New Meeting Dialog ───────────────────────────────────────────────────────

interface NewMeetingProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  committees: Committee[];
  defaultCommitteeId?: string;
  hospitalId: string;
  userId: string | null;
  onCreated: (m: Meeting) => void;
}

const NewMeetingDialog: React.FC<NewMeetingProps> = ({
  open, onOpenChange, committees, defaultCommitteeId, hospitalId, userId, onCreated,
}) => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [committeeId, setCommitteeId] = useState(defaultCommitteeId || "");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [venue, setVenue] = useState("");
  const [prefillAgenda, setPrefillAgenda] = useState(true);
  const [prefillMinutes, setPrefillMinutes] = useState(true);
  const [showTemplatePreview, setShowTemplatePreview] = useState(false);

  useEffect(() => { if (defaultCommitteeId) setCommitteeId(defaultCommitteeId); }, [defaultCommitteeId]);

  const selectedCommName = committees.find(c => c.id === committeeId)?.name || "";
  const template = selectedCommName ? getCommitteeTemplate(selectedCommName) : null;

  const save = async () => {
    if (!committeeId || !date) { toast({ title: "Select committee and date", variant: "destructive" }); return; }
    setSaving(true);
    const tmpl = selectedCommName ? getCommitteeTemplate(selectedCommName) : null;
    const agenda = prefillAgenda && tmpl ? tmpl.agendaHtml : null;
    const minutes = prefillMinutes && tmpl ? tmpl.minutesHtml : null;
    const nabh_chapters_covered = tmpl?.nabh_chapters?.length ? tmpl.nabh_chapters : null;
    const { data, error } = await (supabase as any).from("committee_meetings").insert({
      committee_id: committeeId,
      meeting_date: date,
      venue: venue || null,
      agenda,
      minutes,
      nabh_chapters_covered,
      created_by: userId,
    }).select().maybeSingle();
    setSaving(false);
    if (error || !data) { toast({ title: "Failed", description: error?.message, variant: "destructive" }); return; }
    toast({ title: "Meeting created", description: format(new Date(date), "dd MMM yyyy") });
    onCreated(data);
    onOpenChange(false);
    setDate(new Date().toISOString().split("T")[0]);
    setVenue(""); setPrefillAgenda(true); setPrefillMinutes(true); setShowTemplatePreview(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Schedule Meeting</DialogTitle></DialogHeader>
        <div className="space-y-3 mt-1">
          <div><Label>Committee *</Label>
            <Select value={committeeId} onValueChange={v => { setCommitteeId(v); setShowTemplatePreview(false); }}>
              <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Select committee" /></SelectTrigger>
              <SelectContent>{committees.filter(c => c.is_active).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          {template && (
            <div className="rounded border border-primary/20 bg-primary/5 p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-primary">Template: {template.name}</span>
                <button
                  onClick={() => setShowTemplatePreview(v => !v)}
                  className="text-xs text-primary hover:underline flex items-center gap-0.5"
                >
                  <Eye className="h-3 w-3 mr-0.5" />{showTemplatePreview ? "Hide" : "Preview agenda"}
                </button>
              </div>
              {template.nabh_chapters.length > 0 && (
                <div className="flex gap-1 flex-wrap mt-1.5">
                  {template.nabh_chapters.map(ch => (
                    <span key={ch} className="text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5 font-mono">{ch}</span>
                  ))}
                </div>
              )}
              {showTemplatePreview && (
                <div
                  className="mt-2 rounded border bg-white p-2.5 text-xs max-h-48 overflow-y-auto prose prose-xs"
                  dangerouslySetInnerHTML={{ __html: template.agendaHtml }}
                />
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div><Label>Meeting Date *</Label>
              <Input type="date" className="h-8 text-sm mt-1" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div><Label>Venue</Label>
              <Input className="h-8 text-sm mt-1" placeholder="e.g. Board Room" value={venue} onChange={e => setVenue(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Checkbox id="prefill" checked={prefillAgenda} onCheckedChange={v => setPrefillAgenda(!!v)} />
              <Label htmlFor="prefill" className="text-xs cursor-pointer">Pre-fill agenda template</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="prefillMin" checked={prefillMinutes} onCheckedChange={v => setPrefillMinutes(!!v)} />
              <Label htmlFor="prefillMin" className="text-xs cursor-pointer">Pre-fill minutes template</Label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />} Create Meeting
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

const CommitteesPage: React.FC = () => {
  const { hospitalId, userId } = useHospitalId();
  const { toast } = useToast();

  // Core data
  const [committees, setCommittees] = useState<Committee[]>([]);
  const [staffUsers, setStaffUsers] = useState<{ id: string; full_name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  // Committees tab
  const [selectedCommittee, setSelectedCommittee] = useState<Committee | null>(null);
  const [members, setMembers] = useState<CommitteeMember[]>([]);
  const [recentMeetings, setRecentMeetings] = useState<Meeting[]>([]);
  const [createCommitteeOpen, setCreateCommitteeOpen] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);

  // Meetings tab
  const [meetingCommitteeFilter, setMeetingCommitteeFilter] = useState<string>("all");
  const [allMeetings, setAllMeetings] = useState<Meeting[]>([]);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [meetingActions, setMeetingActions] = useState<ActionItem[]>([]);
  const [newMeetingOpen, setNewMeetingOpen] = useState(false);
  const [meetingSubTab, setMeetingSubTab] = useState("agenda");
  const [savingMeeting, setSavingMeeting] = useState(false);

  // Local edit buffers for meeting
  const [editAgenda, setEditAgenda] = useState("");
  const [editMinutes, setEditMinutes] = useState("");
  const [editChapters, setEditChapters] = useState<string[]>([]);
  const [editQuorum, setEditQuorum] = useState(true);

  // Action items - new item form in meeting
  const [newActionDesc, setNewActionDesc] = useState("");
  const [newActionOwner, setNewActionOwner] = useState("");
  const [newActionDue, setNewActionDue] = useState("");
  const [savingAction, setSavingAction] = useState(false);

  // Actions tab
  const [allActions, setAllActions] = useState<ActionItem[]>([]);
  const [actionsLoading, setActionsLoading] = useState(false);
  const [actionStatusFilter, setActionStatusFilter] = useState("all");
  const [actionCommitteeFilter, setActionCommitteeFilter] = useState("all");
  const [actionsView, setActionsView] = useState<"board" | "list">("board");
  const draggedIdRef = useRef<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  // AI
  const [aiMinutesLoading, setAiMinutesLoading] = useState(false);
  const [aiMinutesText, setAiMinutesText] = useState("");
  const [aiMinutesConfirmed, setAiMinutesConfirmed] = useState(false);
  const [aiMinutesOpen, setAiMinutesOpen] = useState(false);

  // Preview toggles for agenda/minutes HTML rendering
  const [agendaPreview, setAgendaPreview] = useState(false);
  const [minutesPreview, setMinutesPreview] = useState(false);

  // Main page tab
  const [pageTab, setPageTab] = useState("committees");

  // ── Loaders ────────────────────────────────────────────────────────────────

  const loadCommittees = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const [commRes, userRes] = await Promise.all([
      (supabase as any).from("hospital_committees")
        .select("*, chairperson:chairperson_id(full_name), secretary:secretary_id(full_name)")
        .eq("hospital_id", hospitalId).order("name"),
      (supabase as any).from("users").select("id, full_name")
        .eq("hospital_id", hospitalId).order("full_name").limit(200),
    ]);
    setCommittees(commRes.data || []);
    setStaffUsers(userRes.data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { loadCommittees(); }, [loadCommittees]);

  const selectCommittee = async (c: Committee) => {
    setSelectedCommittee(c);
    const [mRes, meetRes] = await Promise.all([
      (supabase as any).from("committee_members").select("*, users(full_name, role)").eq("committee_id", c.id).order("is_core_member", { ascending: false }),
      (supabase as any).from("committee_meetings").select("id, meeting_date, venue").eq("committee_id", c.id).order("meeting_date", { ascending: false }).limit(5),
    ]);
    setMembers(mRes.data || []);
    setRecentMeetings(meetRes.data || []);
  };

  const loadMeetings = useCallback(async () => {
    if (!hospitalId) return;
    const commIds = committees.map(c => c.id);
    if (!commIds.length) { setAllMeetings([]); return; }
    const { data } = await (supabase as any).from("committee_meetings")
      .select("*").in("committee_id", commIds)
      .order("meeting_date", { ascending: false }).limit(300);
    setAllMeetings(data || []);
  }, [hospitalId, committees]);

  useEffect(() => { if (pageTab === "meetings") loadMeetings(); }, [pageTab, loadMeetings]);

  const selectMeeting = async (m: Meeting) => {
    setSelectedMeeting(m);
    setEditAgenda(m.agenda || "");
    setEditMinutes(m.minutes || "");
    setEditChapters(m.nabh_chapters_covered || []);
    setEditQuorum(m.quorum_met !== false);
    setMeetingSubTab("agenda");
    setAgendaPreview(false);
    setMinutesPreview(false);
    const { data } = await (supabase as any).from("committee_action_items")
      .select("*, users:responsible_owner_id(full_name)").eq("meeting_id", m.id).order("due_date");
    setMeetingActions(data || []);
  };

  const loadAllActions = useCallback(async () => {
    if (!hospitalId || !committees.length) return;
    setActionsLoading(true);
    const commIds = committees.map(c => c.id);
    const { data: meetings } = await (supabase as any).from("committee_meetings")
      .select("id, committee_id, meeting_date").in("committee_id", commIds);
    if (!meetings?.length) { setAllActions([]); setActionsLoading(false); return; }

    const meetingMap = new Map<string, { committee_id: string; meeting_date: string }>(
      meetings.map((m: any) => [m.id, { committee_id: m.committee_id, meeting_date: m.meeting_date }])
    );
    const committeeNameMap = new Map(committees.map(c => [c.id, c.name]));

    const { data: items } = await (supabase as any).from("committee_action_items")
      .select("*, users:responsible_owner_id(full_name)")
      .in("meeting_id", meetings.map((m: any) => m.id))
      .order("due_date");

    setAllActions((items || []).map((a: any) => ({
      ...a,
      committee_name: committeeNameMap.get(meetingMap.get(a.meeting_id)?.committee_id || "") || "",
      meeting_date: meetingMap.get(a.meeting_id)?.meeting_date || "",
    })));
    setActionsLoading(false);
  }, [hospitalId, committees]);

  useEffect(() => { if (pageTab === "actions") loadAllActions(); }, [pageTab, loadAllActions]);

  // ── Save meeting ───────────────────────────────────────────────────────────

  const saveMeeting = async () => {
    if (!selectedMeeting) return;
    setSavingMeeting(true);
    const { error } = await (supabase as any).from("committee_meetings").update({
      agenda: editAgenda,
      minutes: editMinutes,
      nabh_chapters_covered: editChapters,
      quorum_met: editQuorum,
    }).eq("id", selectedMeeting.id);
    setSavingMeeting(false);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    setSelectedMeeting(m => m ? { ...m, agenda: editAgenda, minutes: editMinutes, nabh_chapters_covered: editChapters, quorum_met: editQuorum } : m);
    setAllMeetings(prev => prev.map(m => m.id === selectedMeeting.id
      ? { ...m, agenda: editAgenda, minutes: editMinutes, nabh_chapters_covered: editChapters, quorum_met: editQuorum } : m));

    // Create NABH evidence items for covered chapters
    if (editChapters.length > 0) createNABHEvidence(editChapters, selectedMeeting);
    toast({ title: "Meeting saved" });
  };

  const createNABHEvidence = async (chapters: string[], meeting: Meeting) => {
    const committee = committees.find(c => c.id === meeting.committee_id);
    const description = `Covered in ${committee?.name || "committee"} meeting on ${format(new Date(meeting.meeting_date), "dd MMM yyyy")}`;

    for (const chapter of chapters) {
      const { data: stds } = await (supabase as any).from("nabh_standards")
        .select("id").like("standard_code", `${chapter}%`).limit(1);
      if (!stds?.length) continue;

      const { data: comp } = await (supabase as any).from("nabh_hospital_compliance")
        .upsert({ hospital_id: hospitalId, nabh_standard_id: stds[0].id }, { onConflict: "hospital_id,nabh_standard_id" })
        .select("id").maybeSingle();
      if (!comp?.id) continue;

      await (supabase as any).from("nabh_evidence_items").insert({
        nabh_compliance_id: comp.id,
        title: description,
        evidence_type: "Committee Minutes",
        module_reference: "Quality/Committees",
        notes: `Chapter: ${chapter}`,
      });
    }
  };

  // ── Action items ───────────────────────────────────────────────────────────

  const addActionItem = async () => {
    if (!selectedMeeting || !newActionDesc.trim()) return;
    setSavingAction(true);
    const ownerUser = staffUsers.find(u => u.id === newActionOwner);
    const { data, error } = await (supabase as any).from("committee_action_items").insert({
      meeting_id: selectedMeeting.id,
      description: newActionDesc.trim(),
      responsible_owner_id: newActionOwner || null,
      owner_name: !newActionOwner ? null : undefined,
      due_date: newActionDue || null,
    }).select("*, users:responsible_owner_id(full_name)").maybeSingle();
    setSavingAction(false);
    if (error || !data) { toast({ title: "Failed", description: error?.message, variant: "destructive" }); return; }
    setMeetingActions(prev => [...prev, data]);
    setNewActionDesc(""); setNewActionOwner(""); setNewActionDue("");
  };

  const updateActionStatus = async (id: string, status: string) => {
    // Optimistic update — update UI immediately, then persist
    setMeetingActions(prev => prev.map(a => a.id === id ? { ...a, status } : a));
    setAllActions(prev => prev.map(a => a.id === id ? { ...a, status } : a));
    await (supabase as any).from("committee_action_items").update({ status }).eq("id", id);
  };

  const deleteActionItem = async (id: string) => {
    await (supabase as any).from("committee_action_items").delete().eq("id", id);
    setMeetingActions(prev => prev.filter(a => a.id !== id));
    setAllActions(prev => prev.filter(a => a.id !== id));
  };

  // ── AI Summarise ───────────────────────────────────────────────────────────

  const summariseMeeting = async () => {
    if (!selectedMeeting) return;
    const committee = committees.find(c => c.id === selectedMeeting.committee_id);
    setAiMinutesLoading(true);
    setAiMinutesText("");
    setAiMinutesConfirmed(false);
    setAiMinutesOpen(true);

    const prompt = `You are a committee secretary drafting formal minutes for a hospital governance meeting.

Committee: ${committee?.name || "Hospital Committee"}
Date: ${format(new Date(selectedMeeting.meeting_date), "dd MMMM yyyy")}
Venue: ${selectedMeeting.venue || "Hospital premises"}

Agenda:
${editAgenda || "(not set)"}

Discussion notes / bullet points:
${editMinutes || "(not yet entered)"}

Attended chapters: ${editChapters.join(", ") || "Not specified"}

Please draft structured formal meeting minutes including:
1. Meeting details (committee, date, venue, quorum)
2. Agenda item-by-item: discussion summary, decisions made
3. Action items (if derivable from notes)
4. Next meeting details (if mentioned)

Use formal committee-minutes language. Be concise but complete.`;

    try {
      const result = await callAI({ featureKey: "nabh_criteria_mapper", hospitalId, prompt, maxTokens: 800 });
      if (result.error || !result.text) {
        setAiMinutesText("AI unavailable. Please write minutes manually.");
        toast({ title: "AI unavailable", description: result.error, variant: "destructive" });
      } else {
        setAiMinutesText(result.text);
      }
    } catch {
      setAiMinutesText("AI unavailable. Please write minutes manually.");
    }
    setAiMinutesLoading(false);
  };

  const applyAIMinutes = async () => {
    if (!selectedMeeting) return;
    setEditMinutes(aiMinutesText);
    await (supabase as any).from("committee_meetings")
      .update({ minutes: aiMinutesText, ai_minutes_used: true }).eq("id", selectedMeeting.id);
    setSelectedMeeting(m => m ? { ...m, minutes: aiMinutesText, ai_minutes_used: true } : m);
    setAiMinutesOpen(false);
    toast({ title: "AI minutes applied" });
  };

  // ── Member removal ─────────────────────────────────────────────────────────

  const removeMember = async (memberId: string) => {
    await (supabase as any).from("committee_members").delete().eq("id", memberId);
    setMembers(prev => prev.filter(m => m.id !== memberId));
  };

  // ── Kanban DnD ─────────────────────────────────────────────────────────────

  const handleDragStart = (e: React.DragEvent, id: string) => {
    draggedIdRef.current = id;
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, col: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCol(col);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    const related = e.relatedTarget as Node | null;
    if (!related || !(e.currentTarget as HTMLElement).contains(related)) {
      setDragOverCol(null);
    }
  };

  const handleDragEnd = () => {
    setDragOverCol(null);
    draggedIdRef.current = null;
  };

  const handleDrop = async (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    setDragOverCol(null);
    const id = draggedIdRef.current;
    draggedIdRef.current = null;
    if (!id) return;
    const action = allActions.find(a => a.id === id);
    if (!action || action.status === newStatus) return;
    await updateActionStatus(id, newStatus);
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  const filteredMeetings = allMeetings.filter(m =>
    meetingCommitteeFilter === "all" || m.committee_id === meetingCommitteeFilter
  );

  const filteredActions = allActions.filter(a => {
    if (actionStatusFilter !== "all" && a.status !== actionStatusFilter) return false;
    if (actionCommitteeFilter !== "all" && a.committee_name !== actionCommitteeFilter) return false;
    return true;
  });

  // Board view filters only by committee — columns represent the statuses
  const boardActions = allActions.filter(a =>
    actionCommitteeFilter === "all" || a.committee_name === actionCommitteeFilter
  );

  const openActionsCount = allActions.filter(a => a.status === "open" || a.status === "in_progress").length;
  const overdueCount = allActions.filter(a =>
    (a.status === "open" || a.status === "in_progress") && a.due_date && isPast(parseISO(a.due_date))
  ).length;

  if (!hospitalId) return <div className="p-8 text-muted-foreground">Loading…</div>;

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      {/* Header */}
      <div className="h-[52px] flex-shrink-0 bg-card border-b border-border flex items-center justify-between px-5">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          <span className="text-base font-bold">Governance & Committees</span>
          <Badge variant="outline" className="text-xs ml-1">NABH ROM/HRM</Badge>
          {overdueCount > 0 && (
            <Badge className="text-xs ml-1 bg-red-100 text-red-700 border-0">
              {overdueCount} overdue
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => { loadCommittees(); loadMeetings(); }}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          {pageTab === "committees" && (
            <Button size="sm" onClick={() => setCreateCommitteeOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> New Committee
            </Button>
          )}
          {pageTab === "meetings" && (
            <Button size="sm" onClick={() => setNewMeetingOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Schedule Meeting
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={pageTab} onValueChange={setPageTab} className="flex-1 overflow-hidden flex flex-col">
        <TabsList className="h-10 rounded-none border-b border-border bg-card px-4 justify-start flex-shrink-0">
          {[
            { v: "committees", l: `🏛️ Committees (${committees.length})` },
            { v: "meetings", l: `📋 Meetings` },
            { v: "actions", l: `✅ Action Items${openActionsCount > 0 ? ` (${openActionsCount})` : ""}` },
          ].map(t => (
            <TabsTrigger key={t.v} value={t.v}
              className="text-[13px] rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=active]:bg-transparent px-5 h-full"
            >{t.l}</TabsTrigger>
          ))}
        </TabsList>

        {/* ── Committees Tab ──────────────────────────────────────────────── */}
        <TabsContent value="committees" className="flex-1 overflow-hidden flex m-0">
          {/* Left: committee list */}
          <div className="w-[280px] border-r border-border flex flex-col bg-card flex-shrink-0">
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center gap-2 p-4 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
              ) : committees.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">No committees yet</div>
              ) : (
                committees.map(c => (
                  <button key={c.id} onClick={() => selectCommittee(c)}
                    className={cn("w-full text-left px-3 py-3 border-b border-border/50 transition-colors",
                      selectedCommittee?.id === c.id ? "bg-primary/8 border-l-2 border-l-primary" : "hover:bg-muted/40"
                    )}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{c.name}</span>
                      <Badge className={cn("text-[10px] border-0", c.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>
                        {c.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    {c.chairperson?.full_name && (
                      <p className="text-xs text-muted-foreground mt-0.5">Chair: {c.chairperson.full_name}</p>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Right: committee detail */}
          <div className="flex-1 overflow-y-auto">
            {!selectedCommittee ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                <Building2 className="h-10 w-10 opacity-20" />
                <p className="text-sm">Select a committee to view details</p>
              </div>
            ) : (
              <div className="p-5 max-w-2xl space-y-4">
                {/* Committee header */}
                <div className="rounded-lg border bg-card p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-base font-bold">{selectedCommittee.name}</h2>
                      {selectedCommittee.description && <p className="text-sm text-muted-foreground mt-1">{selectedCommittee.description}</p>}
                    </div>
                    <Badge className={cn("border-0", selectedCommittee.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>
                      {selectedCommittee.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mt-3 pt-3 border-t border-border">
                    <div>
                      <p className="text-xs text-muted-foreground">Chairperson</p>
                      <p className="text-sm font-medium">{selectedCommittee.chairperson?.full_name || "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Secretary</p>
                      <p className="text-sm font-medium">{selectedCommittee.secretary?.full_name || "—"}</p>
                    </div>
                  </div>
                </div>

                {/* Members */}
                <div className="rounded-lg border bg-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold flex items-center gap-1.5">
                      <Users className="h-4 w-4" /> Members ({members.length})
                    </p>
                    <Button size="sm" variant="outline" onClick={() => setAddMemberOpen(true)}>
                      <UserPlus className="h-3.5 w-3.5 mr-1" /> Add
                    </Button>
                  </div>
                  {members.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No members added yet</p>
                  ) : (
                    <div className="space-y-1.5">
                      {members.map(m => (
                        <div key={m.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/30 group">
                          <div>
                            <span className="text-sm font-medium">
                              {m.users?.full_name || m.member_name || "Unknown"}
                            </span>
                            {m.is_core_member && <Badge className="ml-1.5 text-[10px] bg-primary/10 text-primary border-0">Core</Badge>}
                            <div className="text-xs text-muted-foreground">
                              {m.member_role || "Member"}{m.designation ? ` · ${m.designation}` : ""}
                            </div>
                          </div>
                          <button onClick={() => removeMember(m.id)}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Recent meetings */}
                <div className="rounded-lg border bg-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold flex items-center gap-1.5">
                      <CalendarDays className="h-4 w-4" /> Recent Meetings
                    </p>
                    <Button size="sm" variant="outline" onClick={() => { setNewMeetingOpen(true); }}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> New Meeting
                    </Button>
                  </div>
                  {recentMeetings.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No meetings yet</p>
                  ) : (
                    <div className="space-y-1">
                      {recentMeetings.map(m => (
                        <button key={m.id} onClick={() => { setPageTab("meetings"); selectMeeting(m as any); }}
                          className="w-full flex items-center justify-between px-2 py-2 rounded hover:bg-muted/40 text-left transition-colors">
                          <span className="text-sm">{format(new Date(m.meeting_date), "dd MMM yyyy")}</span>
                          {m.venue && <span className="text-xs text-muted-foreground">{m.venue}</span>}
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Meetings Tab ────────────────────────────────────────────────── */}
        <TabsContent value="meetings" className="flex-1 overflow-hidden flex m-0">
          {/* Left: meeting list */}
          <div className="w-[280px] border-r border-border flex flex-col bg-card flex-shrink-0">
            <div className="p-2.5 border-b border-border">
              <Select value={meetingCommitteeFilter} onValueChange={setMeetingCommitteeFilter}>
                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="All committees" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All committees</SelectItem>
                  {committees.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredMeetings.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">No meetings found</div>
              ) : filteredMeetings.map(m => {
                const comm = committees.find(c => c.id === m.committee_id);
                return (
                  <button key={m.id} onClick={() => selectMeeting(m)}
                    className={cn("w-full text-left px-3 py-3 border-b border-border/50 transition-colors",
                      selectedMeeting?.id === m.id ? "bg-primary/8 border-l-2 border-l-primary" : "hover:bg-muted/40"
                    )}>
                    <p className="text-sm font-medium">{format(new Date(m.meeting_date), "dd MMM yyyy")}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{comm?.name || "—"}</p>
                    {m.venue && <p className="text-xs text-muted-foreground">{m.venue}</p>}
                    {m.nabh_chapters_covered && m.nabh_chapters_covered.length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {m.nabh_chapters_covered.map(ch => (
                          <span key={ch} className="text-[10px] bg-primary/10 text-primary rounded px-1">{ch}</span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: meeting editor */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {!selectedMeeting ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                <CalendarDays className="h-10 w-10 opacity-20" />
                <p className="text-sm">Select a meeting to edit</p>
              </div>
            ) : (
              <>
                {/* Meeting header */}
                <div className="flex-shrink-0 px-5 py-3 border-b border-border bg-card flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold">
                      {committees.find(c => c.id === selectedMeeting.committee_id)?.name || "Meeting"}
                      {" · "}
                      {format(new Date(selectedMeeting.meeting_date), "dd MMMM yyyy")}
                    </h2>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                      {selectedMeeting.venue && <span>📍 {selectedMeeting.venue}</span>}
                      <span className="flex items-center gap-1">
                        <Checkbox id="quorum" checked={editQuorum} onCheckedChange={v => setEditQuorum(!!v)} className="h-3 w-3" />
                        <label htmlFor="quorum" className="cursor-pointer">Quorum met</label>
                      </span>
                      {selectedMeeting.ai_minutes_used && <Badge className="text-[10px] bg-primary/10 text-primary border-0">AI-assisted</Badge>}
                    </div>
                  </div>
                  <Button size="sm" onClick={saveMeeting} disabled={savingMeeting}>
                    {savingMeeting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                    Save Meeting
                  </Button>
                </div>

                {/* Meeting sub-tabs */}
                <Tabs value={meetingSubTab} onValueChange={setMeetingSubTab} className="flex-1 overflow-hidden flex flex-col">
                  <TabsList className="h-8 rounded-none border-b border-border bg-muted/20 px-4 justify-start flex-shrink-0">
                    {[
                      { v: "agenda", l: "Agenda" },
                      { v: "minutes", l: "Minutes" },
                      { v: "nabh", l: `NABH (${editChapters.length})` },
                      { v: "actions", l: `Actions (${meetingActions.length})` },
                    ].map(t => (
                      <TabsTrigger key={t.v} value={t.v}
                        className="text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=active]:bg-transparent px-3 h-full"
                      >{t.l}</TabsTrigger>
                    ))}
                  </TabsList>

                  <TabsContent value="agenda" className="flex-1 overflow-auto m-0 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Meeting Agenda</Label>
                      <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 px-2"
                        onClick={() => setAgendaPreview(v => !v)}>
                        {agendaPreview
                          ? <><EyeOff className="h-3 w-3" /> Edit</>
                          : <><Eye className="h-3 w-3" /> Preview</>}
                      </Button>
                    </div>
                    {agendaPreview ? (
                      <div className="rounded border border-border p-4 min-h-[400px] bg-card overflow-auto text-sm prose prose-sm max-w-none whitespace-pre-wrap">
                        {editAgenda}
                      </div>
                    ) : (
                      <Textarea className="text-sm h-full min-h-[400px] resize-none font-mono"
                        placeholder="Enter agenda items…"
                        value={editAgenda} onChange={e => setEditAgenda(e.target.value)} />
                    )}
                  </TabsContent>

                  <TabsContent value="minutes" className="flex-1 overflow-auto m-0 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Meeting Minutes</Label>
                      <div className="flex items-center gap-1.5">
                        <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 px-2"
                          onClick={() => setMinutesPreview(v => !v)}>
                          {minutesPreview
                            ? <><EyeOff className="h-3 w-3" /> Edit</>
                            : <><Eye className="h-3 w-3" /> Preview</>}
                        </Button>
                        <Button size="sm" variant="outline" onClick={summariseMeeting}>
                          <Brain className="h-3.5 w-3.5 mr-1" /> AI Summarise
                        </Button>
                      </div>
                    </div>
                    {minutesPreview ? (
                      <div className="rounded border border-border p-4 min-h-[360px] bg-card overflow-auto text-sm prose prose-sm max-w-none whitespace-pre-wrap">
                        {editMinutes}
                      </div>
                    ) : (
                      <Textarea className="text-sm h-full min-h-[360px] resize-none"
                        placeholder="Record discussion points, decisions made, and key outcomes…"
                        value={editMinutes} onChange={e => setEditMinutes(e.target.value)} />
                    )}
                  </TabsContent>

                  <TabsContent value="nabh" className="flex-1 overflow-auto m-0 p-4">
                    <div className="max-w-lg">
                      <p className="text-sm font-semibold mb-1">NABH Chapters Covered</p>
                      <p className="text-xs text-muted-foreground mb-3">
                        Selecting chapters will auto-create NABH evidence entries linking this meeting to the compliance matrix.
                      </p>
                      <div className="space-y-2">
                        {NABH_CHAPTERS.map(ch => (
                          <div key={ch.code} className="flex items-center gap-2.5">
                            <Checkbox
                              id={`ch_${ch.code}`}
                              checked={editChapters.includes(ch.code)}
                              onCheckedChange={v => setEditChapters(prev =>
                                v ? [...prev, ch.code] : prev.filter(c => c !== ch.code)
                              )}
                            />
                            <label htmlFor={`ch_${ch.code}`} className="text-sm cursor-pointer flex items-center gap-2">
                              <span className="font-mono text-xs bg-primary/10 text-primary rounded px-1.5 py-0.5">{ch.code}</span>
                              {ch.name}
                            </label>
                          </div>
                        ))}
                      </div>
                      {editChapters.length > 0 && (
                        <div className="mt-4 rounded bg-green-50 border border-green-200 p-3 text-xs text-green-700">
                          <CheckCircle2 className="h-3.5 w-3.5 inline mr-1" />
                          {editChapters.length} chapter{editChapters.length !== 1 ? "s" : ""} will be linked as evidence on save: {editChapters.join(", ")}
                        </div>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="actions" className="flex-1 overflow-auto m-0 p-4">
                    <div className="max-w-2xl space-y-3">
                      {/* Add action item */}
                      <div className="rounded-lg border bg-muted/20 p-3">
                        <p className="text-xs font-semibold mb-2">Add Action Item</p>
                        <div className="flex gap-2">
                          <Input className="h-7 text-sm flex-1" placeholder="Action description"
                            value={newActionDesc} onChange={e => setNewActionDesc(e.target.value)} />
                          <Select value={newActionOwner} onValueChange={setNewActionOwner}>
                            <SelectTrigger className="h-7 text-xs w-36"><SelectValue placeholder="Owner" /></SelectTrigger>
                            <SelectContent>{staffUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}</SelectContent>
                          </Select>
                          <Input type="date" className="h-7 text-xs w-32" value={newActionDue} onChange={e => setNewActionDue(e.target.value)} />
                          <Button size="sm" className="h-7 text-xs" onClick={addActionItem} disabled={savingAction || !newActionDesc.trim()}>
                            {savingAction ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                          </Button>
                        </div>
                      </div>

                      {/* Actions list */}
                      {meetingActions.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">No action items for this meeting</p>
                      ) : (
                        <div className="space-y-2">
                          {meetingActions.map(a => {
                            const isOverdue = a.due_date && isPast(parseISO(a.due_date)) && a.status !== "completed" && a.status !== "cancelled";
                            return (
                              <div key={a.id} className={cn("flex items-start gap-2 p-2.5 rounded border bg-card group", isOverdue && "border-red-200")}>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm">{a.description}</p>
                                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                                    {a.users?.full_name && <span>{a.users.full_name}</span>}
                                    {a.due_date && (
                                      <span className={cn(isOverdue && "text-red-600 font-medium")}>
                                        Due: {format(parseISO(a.due_date), "dd MMM yy")}{isOverdue && " ⚠️"}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  <Select value={a.status} onValueChange={v => updateActionStatus(a.id, v)}>
                                    <SelectTrigger className="h-6 text-xs w-28 border-0 bg-transparent">
                                      <Badge className={cn("text-[10px] border-0 cursor-pointer", ACTION_STATUS_COLOUR[a.status])}>
                                        {a.status.replace("_", " ")}
                                      </Badge>
                                    </SelectTrigger>
                                    <SelectContent>
                                      {["open", "in_progress", "completed", "deferred", "cancelled"].map(s => (
                                        <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <button onClick={() => deleteActionItem(a.id)}
                                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              </>
            )}
          </div>
        </TabsContent>

        {/* ── Action Items Tab ────────────────────────────────────────────── */}
        <TabsContent value="actions" className="flex-1 overflow-hidden flex flex-col m-0">

          {/* Toolbar */}
          <div className="flex-shrink-0 px-4 py-2.5 border-b border-border bg-card flex items-center gap-2 flex-wrap">
            <Select value={actionCommitteeFilter} onValueChange={setActionCommitteeFilter}>
              <SelectTrigger className="h-7 text-xs w-48"><SelectValue placeholder="All committees" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All committees</SelectItem>
                {committees.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>

            {actionsView === "list" && (
              <div className="flex gap-1">
                {["all", "open", "in_progress", "completed", "deferred"].map(s => (
                  <button key={s} onClick={() => setActionStatusFilter(s)}
                    className={cn("px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                      actionStatusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
                    )}>
                    {s === "all" ? "All" : s.replace("_", " ")}
                  </button>
                ))}
              </div>
            )}

            <Button size="sm" variant="outline" className="h-7 px-2" onClick={loadAllActions} disabled={actionsLoading}>
              <RefreshCw className={`h-3.5 w-3.5 ${actionsLoading ? "animate-spin" : ""}`} />
            </Button>
            <span className="text-xs text-muted-foreground">
              {actionsView === "board" ? boardActions.length : filteredActions.length} items
              {overdueCount > 0 && <span className="text-red-600 font-medium"> · {overdueCount} overdue</span>}
            </span>

            {/* Board / List toggle */}
            <div className="ml-auto flex items-center gap-0.5 rounded-lg border border-border bg-muted/30 p-0.5">
              <button
                onClick={() => setActionsView("board")}
                title="Board view"
                className={cn(
                  "h-6 w-7 rounded flex items-center justify-center transition-colors",
                  actionsView === "board" ? "bg-card shadow-sm text-primary" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setActionsView("list")}
                title="List view"
                className={cn(
                  "h-6 w-7 rounded flex items-center justify-center transition-colors",
                  actionsView === "list" ? "bg-card shadow-sm text-primary" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Table2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {actionsLoading ? (
            <div className="flex-1 flex items-center justify-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>

          ) : actionsView === "board" ? (
            /* ── Kanban Board ──────────────────────────────────────────────── */
            <div className="flex-1 overflow-auto p-4">
              <div className="grid grid-cols-4 gap-3" style={{ minHeight: "calc(100% - 8px)" }}>
                {KANBAN_COLUMNS.map(col => {
                  const cards = boardActions.filter(a => a.status === col.id);
                  const isOver = dragOverCol === col.id;
                  return (
                    <div
                      key={col.id}
                      onDragOver={e => handleDragOver(e, col.id)}
                      onDragLeave={handleDragLeave}
                      onDrop={e => handleDrop(e, col.id)}
                      className={cn(
                        "flex flex-col rounded-xl border-2 transition-all duration-150 min-h-[400px]",
                        isOver ? "border-primary shadow-md" : "border-border"
                      )}
                    >
                      {/* Column header */}
                      <div className={cn(
                        "flex items-center justify-between px-3 py-2.5 rounded-t-xl flex-shrink-0",
                        col.headerColour
                      )}>
                        <span className="text-[11px] font-bold tracking-widest uppercase">{col.label}</span>
                        <span className="text-[11px] font-bold bg-white/70 rounded-full px-2 py-0.5 min-w-[22px] text-center">
                          {cards.length}
                        </span>
                      </div>

                      {/* Cards area */}
                      <div className={cn(
                        "flex-1 p-2 space-y-2 overflow-y-auto rounded-b-xl transition-colors duration-150",
                        isOver ? col.dropColour : "bg-muted/20"
                      )}>
                        {cards.map(a => {
                          const overdue = !!(a.due_date && isPast(parseISO(a.due_date)) && a.status !== "completed" && a.status !== "cancelled");
                          const ownerDisplay = a.users?.full_name || a.owner_name;
                          const initials = ownerDisplay
                            ? ownerDisplay.trim().split(/\s+/).map((w: string) => w[0] || "").join("").slice(0, 2).toUpperCase()
                            : "";
                          return (
                            <div
                              key={a.id}
                              draggable
                              onDragStart={e => handleDragStart(e, a.id)}
                              onDragEnd={handleDragEnd}
                              className="bg-card rounded-lg border border-border p-3 shadow-sm cursor-grab active:cursor-grabbing active:opacity-60 hover:shadow-md hover:border-primary/30 transition-all select-none"
                            >
                              {/* Description */}
                              <p className="text-[13px] font-medium leading-snug text-foreground">
                                {a.description.length > 60 ? a.description.slice(0, 60) + "…" : a.description}
                              </p>

                              {/* Committee chip */}
                              {a.committee_name && (
                                <span className="inline-block text-[10px] bg-muted text-muted-foreground rounded px-1.5 py-0.5 mt-1.5 max-w-full truncate">
                                  {a.committee_name}
                                </span>
                              )}

                              {/* Owner avatar + name */}
                              <div className="flex items-center gap-1.5 mt-2">
                                <div className={cn(
                                  "h-5 w-5 rounded-full text-[9px] font-bold flex items-center justify-center flex-shrink-0",
                                  ownerDisplay ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground/60"
                                )}>
                                  {initials || "—"}
                                </div>
                                <span className="text-[11px] text-muted-foreground truncate">
                                  {ownerDisplay || "Unassigned"}
                                </span>
                              </div>

                              {/* Dates */}
                              <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-border/40 gap-1">
                                {a.meeting_date ? (
                                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                    📋 {format(parseISO(a.meeting_date), "dd MMM yy")}
                                  </span>
                                ) : <span />}
                                {a.due_date && (
                                  <span className={cn(
                                    "text-[10px] whitespace-nowrap",
                                    overdue ? "text-red-600 font-bold" : "text-muted-foreground"
                                  )}>
                                    {overdue ? "⚠ " : ""}Due {format(parseISO(a.due_date), "dd MMM yy")}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}

                        {/* Empty / drop target placeholder */}
                        <div className={cn(
                          "min-h-[64px] flex items-center justify-center text-xs rounded-lg border-2 border-dashed transition-colors duration-150",
                          cards.length === 0
                            ? isOver
                              ? "border-primary/40 text-primary/70 bg-primary/5"
                              : "border-muted text-muted-foreground/30"
                            : isOver
                              ? "border-primary/30 text-primary/60 bg-primary/5 min-h-[40px]"
                              : "hidden"
                        )}>
                          {isOver ? "Drop here" : cards.length === 0 ? "No items" : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          ) : (
            /* ── List / Table view ─────────────────────────────────────────── */
            <div className="flex-1 overflow-auto p-5">
              {filteredActions.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">No action items matching the filter</div>
              ) : (
                <div className="rounded-lg border bg-card overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>{["Description", "Committee", "Owner", "Due Date", "Status", ""].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {filteredActions.map(a => {
                        const isOverdue = a.due_date && isPast(parseISO(a.due_date)) && a.status !== "completed" && a.status !== "cancelled";
                        return (
                          <tr key={a.id} className={cn("border-t border-border hover:bg-muted/20", isOverdue && "bg-red-50/30")}>
                            <td className="px-3 py-2.5 max-w-xs">
                              <p>{a.description}</p>
                              {a.meeting_date && <p className="text-xs text-muted-foreground mt-0.5">Mtg: {format(parseISO(a.meeting_date), "dd MMM yy")}</p>}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-muted-foreground">{a.committee_name || "—"}</td>
                            <td className="px-3 py-2.5 text-xs">{a.users?.full_name || a.owner_name || "—"}</td>
                            <td className="px-3 py-2.5">
                              {a.due_date ? (
                                <span className={cn("text-xs", isOverdue && "text-red-600 font-medium")}>
                                  {format(parseISO(a.due_date), "dd MMM yy")}
                                  {isOverdue && <AlertTriangle className="h-3 w-3 inline ml-1" />}
                                </span>
                              ) : <span className="text-xs text-muted-foreground">—</span>}
                            </td>
                            <td className="px-3 py-2.5">
                              <Select value={a.status} onValueChange={v => updateActionStatus(a.id, v)}>
                                <SelectTrigger className="h-6 text-xs w-28 border-0 p-0">
                                  <Badge className={cn("text-[10px] border-0 cursor-pointer w-full justify-start", ACTION_STATUS_COLOUR[a.status])}>
                                    {a.status.replace("_", " ")}
                                  </Badge>
                                </SelectTrigger>
                                <SelectContent>
                                  {["open", "in_progress", "completed", "deferred", "cancelled"].map(s => (
                                    <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="px-3 py-2.5">
                              <button onClick={() => deleteActionItem(a.id)} className="text-muted-foreground/30 hover:text-red-500 transition-colors">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <CreateCommitteeDialog
        open={createCommitteeOpen} onOpenChange={setCreateCommitteeOpen}
        hospitalId={hospitalId} staffUsers={staffUsers}
        onCreated={c => { setCommittees(prev => [...prev, c]); selectCommittee(c); }}
      />

      {selectedCommittee && (
        <AddMemberDialog
          open={addMemberOpen} onOpenChange={setAddMemberOpen}
          committeeId={selectedCommittee.id} staffUsers={staffUsers}
          onAdded={m => setMembers(prev => [...prev, m])}
        />
      )}

      <NewMeetingDialog
        open={newMeetingOpen} onOpenChange={setNewMeetingOpen}
        committees={committees}
        defaultCommitteeId={selectedCommittee?.id}
        hospitalId={hospitalId} userId={userId}
        onCreated={m => {
          setAllMeetings(prev => [m, ...prev]);
          if (selectedCommittee && m.committee_id === selectedCommittee.id) {
            setRecentMeetings(prev => [m as any, ...prev].slice(0, 5));
          }
          selectMeeting(m);
          setPageTab("meetings");
        }}
      />

      {/* AI Minutes Dialog */}
      <Dialog open={aiMinutesOpen} onOpenChange={setAiMinutesOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>AI Meeting Minutes Draft</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2 mb-3">
            Review and edit before applying. Saved minutes will be marked AI-assisted.
          </p>
          {aiMinutesLoading ? (
            <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Generating minutes draft…
            </div>
          ) : (
            <div className="space-y-3">
              <Textarea className="text-sm h-64 resize-none" value={aiMinutesText}
                onChange={e => setAiMinutesText(e.target.value)} />
              <div className={cn("rounded border p-2.5", aiMinutesConfirmed ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50")}>
                <div className="flex items-start gap-2">
                  <Checkbox id="ai_confirm" checked={aiMinutesConfirmed}
                    onCheckedChange={v => setAiMinutesConfirmed(!!v)} className="mt-0.5" />
                  <Label htmlFor="ai_confirm" className="text-xs cursor-pointer leading-snug">
                    I confirm this draft accurately reflects the meeting proceedings and is suitable for the official committee record.
                  </Label>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setAiMinutesOpen(false)}>Cancel</Button>
                <Button size="sm" disabled={!aiMinutesConfirmed} onClick={applyAIMinutes}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Apply as Minutes
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CommitteesPage;
