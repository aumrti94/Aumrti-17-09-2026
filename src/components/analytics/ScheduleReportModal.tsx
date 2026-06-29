import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Calendar, Mail, MessageSquare, Save, X } from "lucide-react";
import { toast } from "sonner";

interface ScheduleReportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportName: string;
}

const FREQUENCIES = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
] as const;

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const ScheduleReportModal: React.FC<ScheduleReportModalProps> = ({ open, onOpenChange, reportName }) => {
  const [frequency, setFrequency] = useState("daily");
  const [time, setTime] = useState("07:00");
  const [weekDay, setWeekDay] = useState("Monday");
  const [monthDay, setMonthDay] = useState("1");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientInput, setRecipientInput] = useState("");
  const [allAdmins, setAllAdmins] = useState(true);
  const [deliveryWhatsapp, setDeliveryWhatsapp] = useState(true);
  const [deliveryEmail, setDeliveryEmail] = useState(false);
  const [formatExcel, setFormatExcel] = useState(true);
  const [formatPdf, setFormatPdf] = useState(false);

  const addRecipient = () => {
    if (recipientInput.trim() && !recipients.includes(recipientInput.trim())) {
      setRecipients(prev => [...prev, recipientInput.trim()]);
      setRecipientInput("");
    }
  };

  const removeRecipient = (r: string) => setRecipients(prev => prev.filter(x => x !== r));

  const handleSave = async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const { getHospitalId } = await import("@/lib/getHospitalId");
    const hospitalId = await getHospitalId();
    if (!hospitalId) {
      toast.error("Cannot find your hospital. Please re-login.");
      return;
    }

    const dayMap: Record<string, number> = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
    const formats: string[] = [];
    if (formatExcel) formats.push("excel");
    if (formatPdf) formats.push("pdf");
    const fmt = formats.length === 2 ? "both" : formats[0] || "pdf";

    const payload: any = {
      hospital_id: hospitalId,
      report_name: reportName,
      report_type: "custom",
      frequency,
      send_time: time,
      recipient_emails: recipients,
      format: fmt,
      is_active: true,
      config: {
        allAdmins,
        deliveryWhatsapp,
        deliveryEmail,
        weekDay: frequency === "weekly" ? weekDay : null,
        monthDay: frequency === "monthly" ? monthDay : null,
      },
    };
    if (frequency === "weekly") payload.day_of_week = dayMap[weekDay];
    if (frequency === "monthly") payload.day_of_month = parseInt(monthDay, 10);

    const { error } = await supabase.from("report_schedules").insert(payload);
    if (error) {
      toast.error(`Save failed: ${error.message}`);
      return;
    }

    const freqLabel =
      frequency === "daily" ? "every day" :
      frequency === "weekly" ? `every ${weekDay}` :
      `on day ${monthDay} of each month`;
    toast.success(`Report scheduled ✓ — delivers ${freqLabel} at ${time}`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-lg flex items-center gap-2">
            <Calendar size={18} /> Schedule Report
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Report */}
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground uppercase">Report</label>
            <p className="text-[13px] font-medium text-foreground">{reportName}</p>
          </div>

          {/* Frequency */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-muted-foreground uppercase">Frequency</label>
            <div className="flex gap-1.5">
              {FREQUENCIES.map(f => (
                <button key={f.id} onClick={() => setFrequency(f.id)}
                  className={cn("flex-1 py-1.5 rounded-lg text-[12px] font-medium border transition-colors",
                    frequency === f.id ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"
                  )}>
                  {f.label}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              {frequency === "weekly" && (
                <Select value={weekDay} onValueChange={setWeekDay}>
                  <SelectTrigger className="text-[12px] flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DAYS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {frequency === "monthly" && (
                <Select value={monthDay} onValueChange={setMonthDay}>
                  <SelectTrigger className="text-[12px] flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                      <SelectItem key={d} value={String(d)}>{d}{d === 1 ? "st" : d === 2 ? "nd" : d === 3 ? "rd" : "th"}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Input type="time" value={time} onChange={e => setTime(e.target.value)} className="text-[12px] w-[120px]" />
            </div>
          </div>

          {/* Recipients */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-muted-foreground uppercase">Recipients</label>
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-foreground">All CEO/Admin users</span>
              <Switch checked={allAdmins} onCheckedChange={setAllAdmins} />
            </div>
            <div className="flex gap-1.5">
              <Input placeholder="Add name..." value={recipientInput} onChange={e => setRecipientInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addRecipient()} className="text-[12px] flex-1" />
              <Button size="sm" variant="outline" onClick={addRecipient} className="text-[11px]">Add</Button>
            </div>
            {recipients.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {recipients.map(r => (
                  <span key={r} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-[11px] font-medium text-foreground">
                    {r}
                    <button onClick={() => removeRecipient(r)} className="hover:text-destructive"><X size={10} /></button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Delivery */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-muted-foreground uppercase">Delivery</label>
            <div className="flex gap-2">
              <button onClick={() => setDeliveryWhatsapp(!deliveryWhatsapp)}
                className={cn("flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] border",
                  deliveryWhatsapp ? "bg-emerald-50 border-emerald-300 text-emerald-700 font-medium" : "border-border text-muted-foreground"
                )}>
                <MessageSquare size={14} /> WhatsApp
              </button>
              <button onClick={() => setDeliveryEmail(!deliveryEmail)}
                className={cn("flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] border",
                  deliveryEmail ? "bg-blue-50 border-blue-300 text-blue-700 font-medium" : "border-border text-muted-foreground"
                )}>
                <Mail size={14} /> Email
              </button>
            </div>
          </div>

          {/* Format */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-muted-foreground uppercase">Format</label>
            <div className="flex gap-2">
              <button onClick={() => setFormatExcel(!formatExcel)}
                className={cn("flex-1 py-1.5 rounded-lg text-[12px] border",
                  formatExcel ? "bg-primary/10 border-primary text-primary font-medium" : "border-border text-muted-foreground"
                )}>
                Excel
              </button>
              <button onClick={() => setFormatPdf(!formatPdf)}
                className={cn("flex-1 py-1.5 rounded-lg text-[12px] border",
                  formatPdf ? "bg-primary/10 border-primary text-primary font-medium" : "border-border text-muted-foreground"
                )}>
                PDF
              </button>
            </div>
          </div>

          <Button onClick={handleSave} className="w-full gap-2">
            <Save size={14} /> Save Schedule
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ScheduleReportModal;
