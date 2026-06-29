import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MessageSquare, Bell, ChevronDown, ChevronRight } from "lucide-react";

interface Props { hospitalId: string; }

interface GroupedPatient {
  patientId: string;
  fullName: string;
  uhid: string;
  phone: string;
  dob: string | null;
  items: any[];
}

const DueListTab: React.FC<Props> = ({ hospitalId }) => {
  const [filter, setFilter] = useState<"overdue" | "today" | "week" | "month">("overdue");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedPatient, setExpandedPatient] = useState<string | null>(null);

  useEffect(() => { loadDue(); }, [filter]);

  const loadDue = async () => {
    setLoading(true);
    const today = new Date().toISOString().split("T")[0];
    let q = supabase.from("vaccination_due")
      .select("*, patients(full_name, uhid, phone, dob), vaccine_master(vaccine_name, vaccine_code)")
      .eq("hospital_id", hospitalId);

    if (filter === "overdue") {
      q = q.eq("status", "overdue");
    } else if (filter === "today") {
      q = q.eq("due_date", today).eq("status", "due");
    } else if (filter === "week") {
      const week = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];
      q = q.lte("due_date", week).in("status", ["due", "overdue"]);
    } else {
      const month = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];
      q = q.lte("due_date", month).in("status", ["due", "overdue"]);
    }

    const { data, error } = await q.order("due_date").limit(500);
    if (error) { console.error(error); toast.error("Failed to load due list"); }
    setItems(data || []);
    setLoading(false);
  };

  const getDaysOverdue = (dueDate: string) => {
    const diff = Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000);
    return diff > 0 ? diff : 0;
  };

  const getAge = (dob: string | null) => {
    if (!dob) return "—";
    const months = Math.floor((Date.now() - new Date(dob).getTime()) / (30.44 * 86400000));
    if (months < 1) return `${Math.max(0, Math.floor((Date.now() - new Date(dob).getTime()) / 86400000))} d`;
    if (months < 24) return `${months} mo`;
    return `${Math.floor(months / 12)} yr`;
  };

  // Group items by patient
  const groupedPatients: GroupedPatient[] = React.useMemo(() => {
    const map = new Map<string, GroupedPatient>();
    for (const item of items) {
      const pid = item.patient_id;
      if (!map.has(pid)) {
        map.set(pid, {
          patientId: pid,
          fullName: item.patients?.full_name || "Unknown",
          uhid: item.patients?.uhid || "",
          phone: item.patients?.phone || "",
          dob: item.patients?.dob || null,
          items: [],
        });
      }
      map.get(pid)!.items.push(item);
    }
    return Array.from(map.values());
  }, [items]);

  const sendReminderForPatient = (patient: GroupedPatient) => {
    const phone = patient.phone?.replace(/\D/g, "") || "";
    if (!phone) { toast.error("No phone number for this patient"); return; }

    const vaccineLines = patient.items.map((item) => {
      const vName = item.vaccine_master?.vaccine_name || item.vaccine_master?.vaccine_code || "Vaccine";
      const dose = item.dose_number;
      const dueDate = new Date(item.due_date).toLocaleDateString("en-IN");
      const overdue = getDaysOverdue(item.due_date);
      return `• ${vName} (Dose ${dose}) — Due: ${dueDate}${overdue > 0 ? ` (Overdue ${overdue} days)` : ""}`;
    }).join("\n");

    const msg = encodeURIComponent(
      `Dear parent/guardian,\n\nYour child *${patient.fullName}* has the following vaccinations due:\n\n${vaccineLines}\n\nPlease visit the hospital at your earliest convenience.\n\nThank you.`
    );
    window.open(`https://wa.me/91${phone}?text=${msg}`, "_blank", "noopener,noreferrer");
  };

  const sendBulkReminders = () => {
    const overduePatients = groupedPatients.filter(p => p.items.some(i => getDaysOverdue(i.due_date) > 0));
    if (overduePatients.length === 0) { toast.info("No overdue patients to remind"); return; }
    toast.info(`Opening WhatsApp for ${overduePatients.length} patients...`);
    // Open first one; for bulk, WATI integration needed
    if (overduePatients.length > 0) sendReminderForPatient(overduePatients[0]);
    if (overduePatients.length > 1) {
      toast.info(`For bulk messaging ${overduePatients.length} patients, WATI WhatsApp integration is recommended.`);
    }
  };

  const togglePatient = (patientId: string) => {
    setExpandedPatient(prev => prev === patientId ? null : patientId);
  };

  const filters = [
    { key: "overdue", label: "Overdue" },
    { key: "today", label: "Due Today" },
    { key: "week", label: "Due This Week" },
    { key: "month", label: "Due This Month" },
  ] as const;

  return (
    <div className="space-y-3 pb-4">
      <div className="flex items-center gap-2 flex-wrap">
        {filters.map((f) => (
          <Button key={f.key} size="sm" variant={filter === f.key ? "default" : "outline"} onClick={() => setFilter(f.key)}>
            {f.label}
          </Button>
        ))}
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={sendBulkReminders}>
          <Bell className="h-4 w-4 mr-1" /> Send Reminders to All Overdue
        </Button>
      </div>

      <div className="border rounded-lg overflow-auto max-h-[calc(100vh-340px)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Age</TableHead>
              <TableHead>Vaccines Due</TableHead>
              <TableHead>Max Overdue</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groupedPatients.map((patient) => {
              const isExpanded = expandedPatient === patient.patientId;
              const maxOverdue = Math.max(...patient.items.map(i => getDaysOverdue(i.due_date)));
              return (
                <React.Fragment key={patient.patientId}>
                  {/* Patient summary row */}
                  <TableRow
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => togglePatient(patient.patientId)}
                  >
                    <TableCell className="px-2">
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </TableCell>
                    <TableCell>
                      <p className="font-medium text-sm">{patient.fullName}</p>
                      <p className="text-xs text-muted-foreground font-mono">{patient.uhid}</p>
                    </TableCell>
                    <TableCell className="text-sm">{getAge(patient.dob)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {patient.items.slice(0, 4).map((item, idx) => (
                          <Badge key={idx} variant="outline" className="text-xs">
                            {item.vaccine_master?.vaccine_code}
                          </Badge>
                        ))}
                        {patient.items.length > 4 && (
                          <Badge variant="secondary" className="text-xs">+{patient.items.length - 4}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {maxOverdue > 0 ? (
                        <Badge variant="destructive" className="text-xs">{maxOverdue}d</Badge>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); sendReminderForPatient(patient); }} title="Send WhatsApp reminder with all due vaccines">
                        <MessageSquare className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>

                  {/* Expanded vaccine details */}
                  {isExpanded && patient.items.map((item) => (
                    <TableRow key={item.id} className="bg-muted/30">
                      <TableCell></TableCell>
                      <TableCell colSpan={1} className="pl-8 text-xs text-muted-foreground">↳</TableCell>
                      <TableCell className="text-sm">
                        <Badge variant="outline" className="text-xs">{item.vaccine_master?.vaccine_code}</Badge>
                        <span className="ml-2 text-xs text-muted-foreground">{item.vaccine_master?.vaccine_name}</span>
                      </TableCell>
                      <TableCell className="font-mono text-sm">Dose {item.dose_number}</TableCell>
                      <TableCell className="text-sm">
                        {new Date(item.due_date).toLocaleDateString("en-IN")}
                        {getDaysOverdue(item.due_date) > 0 && (
                          <Badge variant="destructive" className="text-xs ml-2">{getDaysOverdue(item.due_date)}d</Badge>
                        )}
                      </TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  ))}
                </React.Fragment>
              );
            })}
            {groupedPatients.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No items found</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        {groupedPatients.length} patient{groupedPatients.length !== 1 ? "s" : ""} · {items.length} total vaccine{items.length !== 1 ? "s" : ""} due
      </p>
    </div>
  );
};

export default DueListTab;
