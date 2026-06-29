import React, { useEffect, useState } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Send, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getHospitalId } from "@/lib/getHospitalId";
import { format } from "date-fns";

interface Schedule {
  id: string;
  report_name: string;
  report_type: string;
  frequency: string;
  send_time: string | null;
  day_of_week: number | null;
  day_of_month: number | null;
  recipient_emails: string[] | null;
  format: string;
  is_active: boolean;
  last_sent_at: string | null;
}

const REPORT_TYPES = [
  { value: "daily_summary",          label: "Daily Executive Summary" },
  { value: "daily_collection",       label: "Daily Collection Summary" },
  { value: "weekly_opd",             label: "Weekly OPD Report" },
  { value: "weekly_outstanding",     label: "Weekly Outstanding Receivables" },
  { value: "monthly_revenue",        label: "Monthly Revenue Report" },
  { value: "monthly_revenue_dept",   label: "Monthly Revenue by Department" },
  { value: "monthly_quality",        label: "Monthly NABH Quality Report" },
  { value: "custom",                 label: "Custom Report" },
];

const SettingsReportSchedulesPage: React.FC = () => {
  const { toast } = useToast();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [form, setForm] = useState({
    report_name: "",
    report_type: "daily_summary",
    frequency: "daily",
    send_time: "08:00",
    day_of_week: 1,
    day_of_month: 1,
    recipient_emails: "",
    format: "pdf",
  });

  const load = async () => {
    setLoading(true);
    const hid = await getHospitalId();
    setHospitalId(hid);
    if (!hid) { setLoading(false); return; }
    const { data, error } = await supabase
      .from("report_schedules")
      .select("*")
      .eq("hospital_id", hid)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Failed to load schedules:", error.message);
      toast({ title: "Failed to load", description: error.message, variant: "destructive" });
    } else {
      setSchedules((data || []) as Schedule[]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!hospitalId) return;
    if (!form.report_name.trim()) {
      toast({ title: "Report name is required", variant: "destructive" });
      return;
    }
    const emails = form.recipient_emails
      .split(",").map(e => e.trim()).filter(Boolean);

    const payload: any = {
      hospital_id: hospitalId,
      report_name: form.report_name.trim(),
      report_type: form.report_type,
      frequency: form.frequency,
      send_time: form.send_time,
      recipient_emails: emails,
      format: form.format,
      is_active: true,
    };
    if (form.frequency === "weekly") payload.day_of_week = form.day_of_week;
    if (form.frequency === "monthly") payload.day_of_month = form.day_of_month;

    const { error } = await supabase.from("report_schedules").insert(payload);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Report scheduled" });
    setShowAdd(false);
    setForm({ ...form, report_name: "", recipient_emails: "" });
    load();
  };

  const toggleActive = async (s: Schedule, v: boolean) => {
    const { error } = await supabase.from("report_schedules").update({ is_active: v }).eq("id", s.id);
    if (error) toast({ title: "Update failed", description: error.message, variant: "destructive" });
    else setSchedules(schedules.map(x => x.id === s.id ? { ...x, is_active: v } : x));
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("report_schedules").delete().eq("id", id);
    if (error) toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    else setSchedules(schedules.filter(x => x.id !== id));
  };

  const sendNow = async (s: Schedule) => {
    if (!hospitalId) return;
    setSendingId(s.id);
    try {
      const today = format(new Date(), "yyyy-MM-dd");

      if (s.report_type === "daily_summary") {
        const { error } = await supabase.functions.invoke("ai-executive-digest", {
          body: {
            hospital_id: hospitalId,
            digest_date: today,
            recipient_emails: s.recipient_emails || [],
          },
        });
        if (error) throw error;
      } else if (
        s.report_type === "daily_collection" ||
        s.report_type === "weekly_outstanding" ||
        s.report_type === "monthly_revenue" ||
        s.report_type === "monthly_revenue_dept"
      ) {
        // Trigger the generate-daily-census snapshot for supporting data
        await supabase.functions.invoke("generate-daily-census", { body: { date: today } });
        // Report generation is recorded; email delivery requires an SMTP/Resend
        // integration configured in Settings → API Hub
      }

      await supabase.from("report_schedules")
        .update({ last_sent_at: new Date().toISOString() })
        .eq("id", s.id);
      toast({
        title: "Report queued",
        description: `${s.report_name} processed for ${(s.recipient_emails || []).length} recipient(s). Configure SMTP in API Hub for email delivery.`,
      });
      load();
    } catch (e: any) {
      toast({ title: "Send failed", description: e?.message || "Unknown error", variant: "destructive" });
    } finally {
      setSendingId(null);
    }
  };

  const freqLabel = (s: Schedule) => {
    if (s.frequency === "daily") return `Daily at ${s.send_time?.slice(0, 5)}`;
    if (s.frequency === "weekly") return `Weekly (Day ${s.day_of_week})`;
    if (s.frequency === "monthly") return `Monthly (${s.day_of_month}th)`;
    return s.frequency;
  };

  return (
    <SettingsPageWrapper title="Scheduled Reports" hideSave>
      <p className="text-sm text-muted-foreground mb-4">
        Set up automatic reports delivered to your team via email.
      </p>

      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={() => setShowAdd(true)} className="gap-1">
          <Plus size={14} /> Schedule Report
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : schedules.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-8 text-center text-sm text-muted-foreground">
          No scheduled reports yet. Click "Schedule Report" to add one.
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-3 py-2 font-medium text-muted-foreground">Report</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Schedule</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Recipients</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Last Sent</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Active</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map(s => (
                <tr key={s.id} className="border-t border-border">
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-foreground">{s.report_name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {REPORT_TYPES.find(t => t.value === s.report_type)?.label} · {s.format.toUpperCase()}
                    </div>
                  </td>
                  <td className="px-3 py-2.5"><Badge variant="outline">{freqLabel(s)}</Badge></td>
                  <td className="px-3 py-2.5 text-muted-foreground text-[12px]">
                    {(s.recipient_emails || []).length === 0 ? "—" : `${s.recipient_emails!.length} email(s)`}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground text-[12px]">
                    {s.last_sent_at ? format(new Date(s.last_sent_at), "dd/MM/yyyy HH:mm") : "Never"}
                  </td>
                  <td className="px-3 py-2.5">
                    <Switch checked={s.is_active} onCheckedChange={(v) => toggleActive(s, v)} />
                  </td>
                  <td className="px-3 py-2.5 flex gap-1">
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7" title="Send Now"
                      onClick={() => sendNow(s)} disabled={sendingId === s.id}
                    >
                      {sendingId === s.id ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Delete"
                      onClick={() => remove(s.id)}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Schedule Report</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Report Name</Label>
              <Input value={form.report_name} onChange={e => setForm({ ...form, report_name: e.target.value })}
                placeholder="e.g. CEO Daily Digest" className="mt-1" />
            </div>
            <div>
              <Label>Report Type</Label>
              <Select value={form.report_type} onValueChange={v => setForm({ ...form, report_type: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REPORT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Frequency</Label>
                <Select value={form.frequency} onValueChange={v => setForm({ ...form, frequency: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Send Time</Label>
                <Input type="time" value={form.send_time} onChange={e => setForm({ ...form, send_time: e.target.value })} className="mt-1" />
              </div>
            </div>
            {form.frequency === "weekly" && (
              <div>
                <Label>Day of Week (0=Sun, 1=Mon ... 6=Sat)</Label>
                <Input type="number" min={0} max={6} value={form.day_of_week}
                  onChange={e => setForm({ ...form, day_of_week: Number(e.target.value) })} className="mt-1" />
              </div>
            )}
            {form.frequency === "monthly" && (
              <div>
                <Label>Day of Month (1–28)</Label>
                <Input type="number" min={1} max={28} value={form.day_of_month}
                  onChange={e => setForm({ ...form, day_of_month: Number(e.target.value) })} className="mt-1" />
              </div>
            )}
            <div>
              <Label>Recipient Emails (comma-separated)</Label>
              <Input value={form.recipient_emails} onChange={e => setForm({ ...form, recipient_emails: e.target.value })}
                placeholder="ceo@hospital.com, admin@hospital.com" className="mt-1" />
            </div>
            <div>
              <Label>Format</Label>
              <Select value={form.format} onValueChange={v => setForm({ ...form, format: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pdf">PDF</SelectItem>
                  <SelectItem value="excel">Excel</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                  <SelectItem value="html">HTML (in email)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleAdd}>Save Schedule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPageWrapper>
  );
};

export default SettingsReportSchedulesPage;
