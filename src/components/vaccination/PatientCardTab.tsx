import React, { useState, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Printer, MessageSquare, Syringe } from "lucide-react";
import PatientSearchPicker from "@/components/shared/PatientSearchPicker";

interface Props { hospitalId: string; }

const MILESTONES = [
  { label: "Birth", weeks: [0] },
  { label: "6 wk", weeks: [6] },
  { label: "10 wk", weeks: [10] },
  { label: "14 wk", weeks: [14] },
  { label: "9 mo", weeks: [39] },
  { label: "16-24 mo", weeks: [78] },
  { label: "5-6 yr", weeks: [] },
  { label: "10 yr", weeks: [] },
  { label: "16 yr", weeks: [] },
];

const PatientCardTab: React.FC<Props> = ({ hospitalId }) => {
  const [patientId, setPatientId] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<any>(null);
  const [vaccines, setVaccines] = useState<any[]>([]);
  const [records, setRecords] = useState<any[]>([]);
  const [dueItems, setDueItems] = useState<any[]>([]);
  const [optionalVaccines, setOptionalVaccines] = useState<any[]>([]);
  const printRef = useRef<HTMLDivElement>(null);

  const handlePatientSelect = async (id: string) => {
    setPatientId(id);
    if (!id) { setSelectedPatient(null); return; }

    // Fetch full patient
    const { data: p, error: pErr } = await supabase.from("patients")
      .select("id, full_name, uhid, dob, phone, gender")
      .eq("id", id).maybeSingle();
    if (pErr || !p) { toast.error("Failed to load patient"); return; }
    setSelectedPatient(p);

    const [vacRes, recRes, dueRes, optRes] = await Promise.all([
      supabase.from("vaccine_master").select("*").eq("nis_schedule", true).order("week_of_life"),
      supabase.from("vaccination_records").select("*, vaccine_master(vaccine_name, vaccine_code, week_of_life)")
        .eq("patient_id", p.id).eq("hospital_id", hospitalId),
      supabase.from("vaccination_due").select("*, vaccine_master(vaccine_name, vaccine_code, week_of_life)")
        .eq("patient_id", p.id).eq("hospital_id", hospitalId).in("status", ["due", "overdue"]),
      supabase.from("vaccine_master").select("*").eq("nis_schedule", false).eq("is_active", true),
    ]);

    setVaccines(vacRes.data || []);
    setRecords(recRes.data || []);
    setDueItems(dueRes.data || []);
    setOptionalVaccines(optRes.data || []);

    // Auto-generate due schedule if no due items and patient has DOB
    if ((dueRes.data || []).length === 0 && p.dob) {
      await generateDueSchedule(p.id, p.dob, vacRes.data || [], recRes.data || []);
      const { data: newDue } = await supabase.from("vaccination_due")
        .select("*, vaccine_master(vaccine_name, vaccine_code, week_of_life)")
        .eq("patient_id", p.id).eq("hospital_id", hospitalId).in("status", ["due", "overdue"]);
      setDueItems(newDue || []);
    }
  };

  const generateDueSchedule = async (pid: string, dob: string, vacs: any[], given: any[]) => {
    const dobDate = new Date(dob);
    const givenSet = new Set(given.map((g: any) => `${g.vaccine_id}-${g.dose_number}`));
    const dueList: any[] = [];

    for (const v of vacs) {
      if (!v.nis_schedule || v.week_of_life === null) continue;
      const key = `${v.id}-1`;
      if (givenSet.has(key)) continue;
      const dueDate = new Date(dobDate);
      dueDate.setDate(dueDate.getDate() + v.week_of_life * 7);
      dueList.push({
        hospital_id: hospitalId,
        patient_id: pid,
        vaccine_id: v.id,
        dose_number: 1,
        due_date: dueDate.toISOString().split("T")[0],
        status: dueDate <= new Date() ? "overdue" : "due",
      });
    }
    if (dueList.length > 0) {
      const { error } = await supabase.from("vaccination_due").insert(dueList);
      if (error) console.error("Due schedule insert error:", error.message);
    }
  };

  const getVaccineStatus = (vaccineId: string) => {
    const rec = records.find((r: any) => r.vaccine_id === vaccineId);
    if (rec) return { status: "given", date: rec.administered_at };
    const due = dueItems.find((d: any) => d.vaccine_id === vaccineId);
    if (due) return { status: due.status, date: due.due_date };
    return { status: "upcoming", date: null };
  };

  const getAge = (dob: string) => {
    const d = new Date(dob);
    const now = new Date();
    const months = (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth();
    if (months < 1) return `${Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86400000))} days`;
    if (months < 24) return `${months} months`;
    return `${Math.floor(months / 12)} years`;
  };

  const printCard = () => {
    if (!printRef.current) return;
    const win = window.open("", "_blank", "noopener,noreferrer");
    if (!win) { toast.error("Popup blocked — allow popups to print"); return; }
    win.document.write(`<html><head><title>Vaccination Card - ${selectedPatient?.full_name}</title>
      <style>body{font-family:Inter,sans-serif;padding:24px;font-size:13px}
      h2{margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:12px}
      th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;font-size:12px}
      th{background:#f1f5f9}.given{color:#16a34a;font-weight:600}.overdue{color:#dc2626;font-weight:600}
      .header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #1a2f5a;padding-bottom:8px;margin-bottom:12px}
      </style></head><body>`);
    win.document.write(`<div class="header"><div><h2>${selectedPatient?.full_name}</h2>
      <p>UHID: ${selectedPatient?.uhid} | DOB: ${selectedPatient?.dob ? new Date(selectedPatient.dob).toLocaleDateString("en-IN") : "N/A"} | Age: ${selectedPatient?.dob ? getAge(selectedPatient.dob) : "N/A"}</p></div>
      <div><strong>Vaccination Card</strong></div></div>`);
    win.document.write(`<table><tr><th>Vaccine</th><th>Code</th><th>Dose</th><th>Status</th><th>Date</th></tr>`);
    for (const v of vaccines) {
      const s = getVaccineStatus(v.id);
      const cls = s.status === "given" ? "given" : s.status === "overdue" ? "overdue" : "";
      win.document.write(`<tr><td>${v.vaccine_name}</td><td>${v.vaccine_code}</td><td>1</td>
        <td class="${cls}">${s.status === "given" ? "✅ Given" : s.status === "overdue" ? "⚠️ Overdue" : "Upcoming"}</td>
        <td>${s.date ? new Date(s.date).toLocaleDateString("en-IN") : "—"}</td></tr>`);
    }
    win.document.write(`</table><p style="margin-top:24px;font-size:10px;color:#666">Printed on ${new Date().toLocaleDateString("en-IN")} at ${new Date().toLocaleTimeString("en-IN")}</p></body></html>`);
    win.document.close();
    win.print();
  };

  const sendWhatsApp = () => {
    if (!selectedPatient) return;
    const lines = [`Vaccination record for ${selectedPatient.full_name}:`];
    for (const r of records) {
      const vm = (r as any).vaccine_master;
      lines.push(`✅ ${vm?.vaccine_name || "Vaccine"}: ${new Date(r.administered_at).toLocaleDateString("en-IN")}`);
    }
    for (const d of dueItems) {
      const vm = (d as any).vaccine_master;
      if (d.status === "overdue") lines.push(`⚠️ OVERDUE: ${vm?.vaccine_name} (due: ${new Date(d.due_date).toLocaleDateString("en-IN")})`);
      else lines.push(`📅 Next: ${vm?.vaccine_name} on ${new Date(d.due_date).toLocaleDateString("en-IN")}`);
    }
    const msg = encodeURIComponent(lines.join("\n"));
    const phone = selectedPatient.phone?.replace(/\D/g, "") || "";
    window.open(`https://wa.me/91${phone}?text=${msg}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-4 pb-4">
      {/* Patient Search */}
      <div className="max-w-md">
        <PatientSearchPicker
          hospitalId={hospitalId}
          value={patientId}
          onChange={handlePatientSelect}
          placeholder="Search patient by name or UHID…"
        />
      </div>

      {selectedPatient && (
        <div ref={printRef}>
          {/* Patient Info */}
          <Card className="p-3 flex items-center justify-between mb-4">
            <div>
              <p className="font-semibold">{selectedPatient.full_name}
                <span className="ml-2 text-xs font-mono text-muted-foreground">{selectedPatient.uhid}</span>
              </p>
              {selectedPatient.dob && (
                <p className="text-sm text-muted-foreground">
                  DOB: {new Date(selectedPatient.dob).toLocaleDateString("en-IN")} · Age: {getAge(selectedPatient.dob)}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={printCard}>
                <Printer className="h-4 w-4 mr-1" /> Print Card
              </Button>
              <Button size="sm" variant="outline" onClick={sendWhatsApp}>
                <MessageSquare className="h-4 w-4 mr-1" /> WhatsApp
              </Button>
            </div>
          </Card>

          {/* NIS Timeline */}
          <div className="mb-4">
            <h3 className="text-sm font-semibold mb-2">National Immunization Schedule</h3>
            <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2">
              {MILESTONES.map((ms) => {
                const msVaccines = vaccines.filter((v: any) =>
                  ms.weeks.length > 0 ? ms.weeks.includes(v.week_of_life) : false
                );
                if (msVaccines.length === 0 && ms.weeks.length > 0) return null;
                return (
                  <Card key={ms.label} className="p-2">
                    <p className="text-[10px] font-bold text-center text-muted-foreground uppercase mb-1">{ms.label}</p>
                    <div className="space-y-1">
                      {msVaccines.map((v: any) => {
                        const s = getVaccineStatus(v.id);
                        return (
                          <Badge key={v.id} variant={s.status === "given" ? "default" : s.status === "overdue" ? "destructive" : "secondary"}
                            className="w-full justify-center text-[10px] py-0.5">
                            {v.vaccine_code}
                            {s.status === "given" && " ✅"}
                            {s.status === "overdue" && " ⚠️"}
                          </Badge>
                        );
                      })}
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Optional Vaccines */}
          {optionalVaccines.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2">Optional / IAP Recommended</h3>
              <div className="flex flex-wrap gap-2">
                {optionalVaccines.map((v: any) => {
                  const s = getVaccineStatus(v.id);
                  return (
                    <Badge key={v.id} variant={s.status === "given" ? "default" : "outline"} className="text-xs">
                      {v.vaccine_name} {s.status === "given" ? "✅" : ""}
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {!selectedPatient && (
        <div className="text-center py-16 text-muted-foreground">
          <Syringe className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Search for a patient to view their vaccination card</p>
        </div>
      )}
    </div>
  );
};

export default PatientCardTab;
