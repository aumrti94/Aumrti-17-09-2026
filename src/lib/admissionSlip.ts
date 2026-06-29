import { supabase } from "@/integrations/supabase/client";
import { printDocument } from "@/lib/printUtils";

export async function printAdmissionSlip(admissionId: string, hospitalId: string): Promise<void> {
  const [admRes, hospitalRes] = await Promise.all([
    supabase.from("admissions")
      .select(`
        id, admission_number, admitted_at, admitting_diagnosis, admission_type,
        insurance_type, insurance_id,
        patients!admissions_patient_id_fkey(full_name, uhid, dob, gender, blood_group, phone, address, allergies),
        beds!admissions_bed_id_fkey(bed_number, bed_category),
        wards!admissions_ward_id_fkey(name),
        users!admissions_admitting_doctor_id_fkey(full_name),
        departments!admissions_department_id_fkey(name)
      `)
      .eq("id", admissionId)
      .maybeSingle(),
    supabase.from("hospitals").select("name, address, phone, email, logo_url").eq("id", hospitalId).maybeSingle(),
  ]);

  const adm = admRes.data as any;
  const hospital = hospitalRes.data as any;

  if (!adm) return;

  const patient = adm.patients as any;
  const bed = adm.beds as any;
  const ward = adm.wards as any;
  const doctor = adm.users as any;
  const dept = adm.departments as any;

  const dobAge = patient?.dob
    ? Math.floor((Date.now() - new Date(patient.dob).getTime()) / 31557600000) + " yrs"
    : "—";

  const admDate = adm.admitted_at
    ? new Date(adm.admitted_at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";

  const bedCategoryLabel = (cat: string) => {
    const map: Record<string, string> = {
      general: "General", semi_private: "Semi-Private", private: "Private",
      icu: "ICU", nicu: "NICU", sicu: "SICU", picu: "PICU", hdu: "HDU", isolation: "Isolation",
    };
    return map[cat] || cat || "General";
  };

  const insuranceLabel = (type: string) => {
    const map: Record<string, string> = {
      pmjay: "PM-JAY (Ayushman Bharat)", cghs: "CGHS", echs: "ECHS",
      insurance: "Insurance (TPA)", esi: "ESI", self_pay: "Self-Pay",
    };
    return map[type] || type || "Self-Pay";
  };

  const body = `
<style>
  @page { size: A5; margin: 15mm; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #1e293b; padding: 0; }
  .hospital-header { text-align: center; border-bottom: 2px solid #1A2F5A; padding-bottom: 10px; margin-bottom: 12px; }
  .hospital-header h1 { font-size: 16px; color: #1A2F5A; margin: 0 0 2px; }
  .hospital-header p { font-size: 10px; color: #64748b; margin: 1px 0; }
  .title { font-size: 13px; font-weight: 700; text-align: center; background: #1A2F5A; color: white; padding: 4px 0; margin-bottom: 12px; letter-spacing: 1px; }
  .row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 5px; border-bottom: 1px dotted #e2e8f0; padding-bottom: 4px; }
  .lbl { color: #64748b; font-size: 10px; min-width: 120px; }
  .val { font-weight: 600; font-size: 11px; text-align: right; }
  .section { margin-top: 10px; border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px 10px; }
  .section-title { font-size: 10px; font-weight: 700; color: #1A2F5A; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px; }
  .rights { margin-top: 10px; font-size: 9px; color: #64748b; border-top: 1px dashed #cbd5e1; padding-top: 6px; }
  .rights ul { margin: 4px 0 0; padding-left: 14px; }
  .rights li { margin-bottom: 2px; }
  .adm-no { font-size: 11px; font-family: monospace; background: #f1f5f9; padding: 1px 4px; border-radius: 2px; }
</style>
<div class="hospital-header">
  <h1>${hospital?.name || "Hospital"}</h1>
  ${hospital?.address ? `<p>${hospital.address}</p>` : ""}
  ${hospital?.phone ? `<p>Tel: ${hospital.phone}</p>` : ""}
</div>
<div class="title">ADMISSION SLIP</div>

<div class="section">
  <div class="section-title">Patient Details</div>
  <div class="row"><span class="lbl">Patient Name</span><span class="val">${patient?.full_name || "—"}</span></div>
  <div class="row"><span class="lbl">UHID</span><span class="val">${patient?.uhid || "—"}</span></div>
  <div class="row"><span class="lbl">Age / Gender</span><span class="val">${dobAge} / ${patient?.gender ? patient.gender.charAt(0).toUpperCase() + patient.gender.slice(1) : "—"}</span></div>
  <div class="row"><span class="lbl">Blood Group</span><span class="val">${patient?.blood_group || "Not recorded"}</span></div>
  <div class="row"><span class="lbl">Phone</span><span class="val">${patient?.phone || "—"}</span></div>
  ${patient?.allergies ? `<div class="row"><span class="lbl">Allergies</span><span class="val" style="color:#dc2626">${patient.allergies}</span></div>` : ""}
</div>

<div class="section">
  <div class="section-title">Admission Details</div>
  <div class="row"><span class="lbl">Admission No.</span><span class="val"><span class="adm-no">${adm.admission_number || admissionId.slice(0, 8).toUpperCase()}</span></span></div>
  <div class="row"><span class="lbl">Date & Time</span><span class="val">${admDate}</span></div>
  <div class="row"><span class="lbl">Ward</span><span class="val">${ward?.name || "—"}</span></div>
  <div class="row"><span class="lbl">Bed</span><span class="val">${bed?.bed_number || "—"} [${bedCategoryLabel(bed?.bed_category)}]</span></div>
  <div class="row"><span class="lbl">Treating Doctor</span><span class="val">Dr. ${doctor?.full_name || "—"}</span></div>
  <div class="row"><span class="lbl">Department</span><span class="val">${dept?.name || "—"}</span></div>
  <div class="row"><span class="lbl">Admission Diagnosis</span><span class="val">${adm.admitting_diagnosis || "As per treating doctor"}</span></div>
  <div class="row"><span class="lbl">Payment Type</span><span class="val">${insuranceLabel(adm.insurance_type || "self_pay")}</span></div>
  ${adm.insurance_id ? `<div class="row"><span class="lbl">Insurance ID</span><span class="val">${adm.insurance_id}</span></div>` : ""}
</div>

<div class="rights">
  <strong>Patient Rights:</strong>
  <ul>
    <li>Right to informed consent for all procedures</li>
    <li>Right to information about diagnosis and treatment plan</li>
    <li>Right to privacy and confidentiality of medical records</li>
    <li>Right to refuse treatment (LAMA) after signing consent</li>
    <li>Right to second opinion</li>
    <li>Right to see itemised billing before payment</li>
  </ul>
</div>
`;

  printDocument(`Admission Slip — ${patient?.full_name || ""}`, body, { width: 600, height: 750 });
}
