import React, { useState, useEffect, useRef, useMemo } from "react";
import { format } from "date-fns";
import { CalendarIcon, Download, CheckCircle2, LayoutList, CalendarDays, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useConfigValues } from "@/hooks/useConfigValues";
import { cn } from "@/lib/utils";
import AttendanceCalendarView from "./AttendanceCalendarView";

interface AttendanceRow {
  userId: string;
  fullName: string;
  role: string;
  deptName: string;
  shiftName: string;
  inTime: string | null;
  outTime: string | null;
  hoursWorked: number | null;
  status: string;
  attendanceId: string | null;
}

interface ParsedImportRow {
  rawName: string;
  date: string;
  inTime: string;
  outTime: string;
  status: string;
  userId: string | null;
  matched: boolean;
}

const statusColors: Record<string, string> = {
  present:  "bg-success/10 text-success",
  absent:   "bg-destructive/10 text-destructive",
  half_day: "bg-accent/10 text-accent-foreground",
  late:     "bg-accent/10 text-accent-foreground",
  on_leave: "bg-primary/10 text-primary",
  holiday:  "bg-muted text-muted-foreground",
};

// Parse "HH:MM" or "H:MM" from various formats
function parseTime(raw: string): string {
  const clean = raw.trim();
  if (!clean) return "";
  const m = clean.match(/^(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  return "";
}

// Parse date string to yyyy-MM-dd
function parseDate(raw: string): string {
  const s = raw.trim();
  // yyyy-MM-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // dd/MM/yyyy or d/M/yyyy
  const dm = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dm) return `${dm[3]}-${dm[2].padStart(2, "0")}-${dm[1].padStart(2, "0")}`;
  // dd-MM-yyyy
  const dd = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dd) return `${dd[3]}-${dd[2].padStart(2, "0")}-${dd[1].padStart(2, "0")}`;
  return s;
}

function computeHours(inTime: string, outTime: string): number | null {
  if (!inTime || !outTime) return null;
  const [ih, im] = inTime.split(":").map(Number);
  const [oh, om] = outTime.split(":").map(Number);
  const diff = (oh * 60 + om - (ih * 60 + im)) / 60;
  return diff > 0 ? Math.round(diff * 10) / 10 : null;
}

// ── Biometric Import Dialog ────────────────────────────────────────────────
const BiometricImportDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  hospitalId: string | null;
  onImported: () => void;
}> = ({ open, onClose, hospitalId, onImported }) => {
  const { toast } = useToast();
  const [staff, setStaff] = useState<{ id: string; full_name: string; hospital_id: string }[]>([]);
  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !hospitalId) return;
    supabase.from("users").select("id, full_name, hospital_id")
      .eq("hospital_id", hospitalId).eq("is_active", true)
      .then(({ data }) => setStaff(data || []));
  }, [open, hospitalId]);

  const parsedRows = useMemo<ParsedImportRow[]>(() => {
    if (!csvText.trim()) return [];
    const lines = csvText.trim().split("\n").filter(Boolean);
    const dataLines = lines[0].toLowerCase().includes("name") ? lines.slice(1) : lines;
    return dataLines.map((line) => {
      const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      const [rawName = "", rawDate = "", rawIn = "", rawOut = ""] = cols;
      const date   = parseDate(rawDate);
      const inTime = parseTime(rawIn);
      const outTime = parseTime(rawOut);
      const hours  = computeHours(inTime, outTime);
      const status = inTime ? "present" : "absent";
      const nameLower = rawName.toLowerCase();
      const match = staff.find((s) => s.full_name.toLowerCase() === nameLower);
      return { rawName, date, inTime, outTime, status, userId: match?.id || null, matched: !!match,
               hoursWorked: hours } as ParsedImportRow & { hoursWorked: number | null };
    });
  }, [csvText, staff]);

  const matchedCount = parsedRows.filter((r) => r.matched).length;

  const handleImport = async () => {
    if (!hospitalId) return;
    setImporting(true);
    let ok = 0;
    for (const row of parsedRows.filter((r) => r.matched)) {
      const r = row as ParsedImportRow & { hoursWorked: number | null };
      await (supabase as any).from("staff_attendance").upsert(
        {
          hospital_id: hospitalId,
          user_id: r.userId,
          attendance_date: r.date,
          in_time: r.inTime || null,
          out_time: r.outTime || null,
          hours_worked: (r as any).hoursWorked ?? null,
          status: r.status,
          source: "biometric",
        },
        { onConflict: "hospital_id,user_id,attendance_date" }
      );
      ok++;
    }
    toast({ title: `Imported ${ok} attendance records` });
    setImporting(false);
    setCsvText("");
    onImported();
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCsvText(ev.target?.result as string);
    reader.readAsText(file);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Biometric CSV</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Expected columns: <code className="bg-muted px-1 rounded">Name, Date, In Time, Out Time</code><br />
          Dates: <code className="bg-muted px-1 rounded">YYYY-MM-DD</code> or <code className="bg-muted px-1 rounded">DD/MM/YYYY</code> &nbsp;
          Times: <code className="bg-muted px-1 rounded">HH:MM</code>
        </p>

        <div className="flex gap-2">
          <Textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={"Name,Date,InTime,OutTime\nDr. Smith,2026-05-01,08:30,17:30"}
            className="text-xs font-mono h-28"
          />
          <div className="flex flex-col gap-1">
            <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileChange} />
            <Button variant="outline" size="sm" className="text-xs whitespace-nowrap"
              onClick={() => fileRef.current?.click()}>
              <Upload className="h-3 w-3 mr-1" /> Upload File
            </Button>
          </div>
        </div>

        {parsedRows.length > 0 && (
          <div className="border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 sticky top-0">
                <tr>
                  {["Name", "Date", "In", "Out", "Status", "Match"].map((h) => (
                    <th key={h} className="px-2 py-1.5 text-left font-semibold text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsedRows.map((r, i) => (
                  <tr key={i} className={cn("border-t border-border", r.matched ? "" : "bg-red-50/40")}>
                    <td className="px-2 py-1">{r.rawName}</td>
                    <td className="px-2 py-1">{r.date}</td>
                    <td className="px-2 py-1">{r.inTime || "—"}</td>
                    <td className="px-2 py-1">{r.outTime || "—"}</td>
                    <td className="px-2 py-1 capitalize">{r.status}</td>
                    <td className="px-2 py-1">
                      {r.matched
                        ? <span className="text-success font-semibold">✓</span>
                        : <span className="text-destructive font-semibold">✗ no match</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {parsedRows.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {matchedCount} of {parsedRows.length} rows matched. Unmatched rows will be skipped.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} size="sm">Cancel</Button>
          <Button size="sm" disabled={matchedCount === 0 || importing} onClick={handleImport}>
            {importing ? "Importing…" : `Import ${matchedCount} rows`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ── Main Component ─────────────────────────────────────────────────────────
const AttendanceTab: React.FC = () => {
  const attendanceStatusOptions = useConfigValues("attendance_statuses");
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [importOpen, setImportOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [deptFilter, setDeptFilter] = useState("all");
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);

  const dateStr = format(selectedDate, "yyyy-MM-dd");

  useEffect(() => {
    if (viewMode !== "list") return;
    const load = async () => {
      const [staffRes, attRes, rosterRes, deptRes] = await Promise.all([
        supabase.from("users").select("id, full_name, role, department_id, departments(name)").eq("is_active", true).order("full_name"),
        (supabase as any).from("staff_attendance").select("*").eq("attendance_date", dateStr),
        (supabase as any).from("duty_roster").select("*, shift_master(shift_name)").eq("roster_date", dateStr),
        supabase.from("departments").select("id, name").eq("is_active", true).order("name", { ascending: true }),
      ]);

      const staffList = staffRes.data || [];
      const attList   = attRes.data   || [];
      const rosterList = rosterRes.data || [];

      const merged: AttendanceRow[] = staffList.map((s: any) => {
        const att  = attList.find((a: any)  => a.user_id === s.id);
        const rost = rosterList.find((r: any) => r.user_id === s.id);
        return {
          userId:       s.id,
          fullName:     s.full_name,
          role:         s.role,
          deptName:     s.departments?.name || "—",
          shiftName:    (rost as any)?.shift_master?.shift_name || "—",
          inTime:       att?.in_time    || null,
          outTime:      att?.out_time   || null,
          hoursWorked:  att?.hours_worked || null,
          status:       att?.status     || "",
          attendanceId: att?.id         || null,
        };
      });

      setRows(merged);
      setDepartments(deptRes.data || []);
    };
    load();
  }, [dateStr, viewMode]);

  const filteredRows = deptFilter === "all"
    ? rows
    : rows.filter((r) => r.deptName === departments.find((d) => d.id === deptFilter)?.name);

  const summary = {
    present: rows.filter((r) => r.status === "present" || r.status === "late").length,
    absent:  rows.filter((r) => r.status === "absent").length,
    late:    rows.filter((r) => r.status === "late").length,
  };

  const markStatus = async (userId: string, status: string) => {
    const { data: userData } = await supabase.from("users").select("hospital_id").eq("id", userId).maybeSingle();
    if (!userData) return;
    const { error } = await (supabase as any).from("staff_attendance").upsert(
      { hospital_id: userData.hospital_id, user_id: userId, attendance_date: dateStr, status, source: "manual" },
      { onConflict: "hospital_id,user_id,attendance_date" }
    );
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setRows((prev) => prev.map((r) => (r.userId === userId ? { ...r, status } : r)));
    }
  };

  const markAllPresent = async () => {
    const unmarked = rows.filter((r) => !r.status);
    for (const row of unmarked) await markStatus(row.userId, "present");
    toast({ title: `Marked ${unmarked.length} staff as present` });
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="h-12 flex-shrink-0 bg-card border-b border-border flex items-center gap-3 px-5">
        {/* View toggle */}
        <div className="flex items-center border border-border rounded-md overflow-hidden h-7">
          <button
            onClick={() => setViewMode("list")}
            className={cn("flex items-center gap-1 px-2.5 h-full text-xs transition-colors",
              viewMode === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50")}
          >
            <LayoutList className="h-3 w-3" /> List
          </button>
          <button
            onClick={() => setViewMode("calendar")}
            className={cn("flex items-center gap-1 px-2.5 h-full text-xs transition-colors",
              viewMode === "calendar" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50")}
          >
            <CalendarDays className="h-3 w-3" /> Calendar
          </button>
        </div>

        {viewMode === "list" && (
          <>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="text-xs gap-1.5">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {format(selectedDate, "dd MMM yyyy")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={selectedDate} onSelect={(d) => d && setSelectedDate(d)} className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>

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

            <div className="flex items-center gap-3 ml-4">
              <span className="text-xs px-2.5 py-1 rounded-full bg-success/10 text-success font-medium">Present: {summary.present}</span>
              <span className="text-xs px-2.5 py-1 rounded-full bg-destructive/10 text-destructive font-medium">Absent: {summary.absent}</span>
              <span className="text-xs px-2.5 py-1 rounded-full bg-accent/10 text-accent-foreground font-medium">Late: {summary.late}</span>
            </div>
          </>
        )}

        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => setImportOpen(true)}>
            <Upload className="h-3 w-3" /> Import CSV
          </Button>
          {viewMode === "list" && (
            <>
              <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={markAllPresent}>
                <CheckCircle2 className="h-3 w-3" /> Mark All Present
              </Button>
              <Button variant="ghost" size="sm" className="text-xs gap-1.5">
                <Download className="h-3 w-3" /> Export
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      {viewMode === "calendar" ? (
        hospitalId ? <AttendanceCalendarView hospitalId={hospitalId} /> : null
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card z-10">
              <tr className="border-b border-border">
                <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Staff</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Role</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Dept</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Shift</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">In</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Out</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Hours</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.userId} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="px-4 py-2 font-medium text-foreground">{row.fullName}</td>
                  <td className="px-3 py-2 text-muted-foreground capitalize">{row.role}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.deptName}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.shiftName}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.inTime?.slice(0, 5) || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.outTime?.slice(0, 5) || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.hoursWorked ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Select value={row.status || "unmarked"} onValueChange={(v) => markStatus(row.userId, v)}>
                      <SelectTrigger className={cn("h-7 w-[110px] text-[10px] border-0",
                        statusColors[row.status] || "bg-muted/50 text-muted-foreground")}>
                        <SelectValue placeholder="Mark" />
                      </SelectTrigger>
                      <SelectContent>
                        {attendanceStatusOptions.map((s) => (
                          <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <BiometricImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        hospitalId={hospitalId}
        onImported={() => setSelectedDate(new Date())}
      />
    </div>
  );
};

export default AttendanceTab;
