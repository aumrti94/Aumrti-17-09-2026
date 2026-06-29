import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Upload, Users, Loader2, Download } from "lucide-react";
import * as XLSX from "xlsx";
import { useHospitalId } from '@/hooks/useHospitalId';


interface CsvEmployee {
  name: string; phone: string; dob: string; gender: string; employee_id: string;
  _error?: string;
}

export default function CorporateTab() {
  const { hospitalId } = useHospitalId();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [packages, setPackages] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [bulkAccountId, setBulkAccountId] = useState("");
  const [bulkPackageId, setBulkPackageId] = useState("");
  const [bulkDate, setBulkDate] = useState(new Date().toISOString().split("T")[0]);
  const [csvEmployees, setCsvEmployees] = useState<CsvEmployee[]>([]);
  const [booking, setBooking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ company_name: "", contact_person: "", contact_phone: "", contact_email: "", gstin: "", credit_days: 30, negotiated_rate_percent: 0 });

  const load = async () => {
    const { data } = await supabase.from("corporate_accounts").select("*").eq("hospital_id", hospitalId).eq("is_active", true).order("company_name");
    setAccounts(data || []);
  };

  const loadPackages = async () => {
    const { data } = await supabase.from("health_packages").select("id, package_name, price").eq("hospital_id", hospitalId).eq("is_active", true).order("package_name");
    setPackages(data || []);
  };

  useEffect(() => { load(); loadPackages(); }, []);

  const save = async () => {
    if (!form.company_name.trim()) { toast.error("Company name required"); return; }
    const { error } = await supabase.from("corporate_accounts").insert({
      hospital_id: hospitalId, ...form,
    });
    if (error) { console.error("Corporate account insert error:", error); toast.error(error.message || "Failed to add account"); return; }
    toast.success("Corporate account added");
    setShowAdd(false);
    setForm({ company_name: "", contact_person: "", contact_phone: "", contact_email: "", gstin: "", credit_days: 30, negotiated_rate_percent: 0 });
    load();
  };

  const parseRows = (rows: Record<string, string>[]) => {
    const employees: CsvEmployee[] = rows.map(row => {
      const lc = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase().trim(), String(v || "").trim()]));
      const name = lc.name || lc.full_name || lc.employee_name || "";
      const phone = lc.phone || lc.mobile || lc.contact || "";
      const dob = lc.dob || lc.date_of_birth || lc.birth_date || "";
      const gender = lc.gender || "other";
      const employee_id = lc.employee_id || lc.emp_id || lc.id || "";
      const error = !name ? "Name is required" : (!phone && !employee_id) ? "Phone or Employee ID needed" : undefined;
      return { name, phone, dob, gender, employee_id, _error: error };
    }).filter(e => e.name || e.phone);
    setCsvEmployees(employees);
    const errorCount = employees.filter(e => e._error).length;
    if (errorCount > 0) toast.error(`${errorCount} row(s) have validation errors — review before submitting`);
    else toast.success(`Parsed ${employees.length} employees`);
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isXlsx = file.name.endsWith(".xlsx") || file.name.endsWith(".xls");
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (isXlsx) {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: Record<string, string>[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
        parseRows(rows);
      } else {
        const text = ev.target?.result as string;
        const lines = text.split("\n").filter(l => l.trim());
        if (lines.length < 2) { toast.error("File must have header + at least 1 row"); return; }
        const header = lines[0].split(",").map(h => h.trim());
        const rows = lines.slice(1).map(line => {
          const cols = line.split(",").map(c => c.trim());
          return Object.fromEntries(header.map((h, i) => [h, cols[i] || ""]));
        });
        parseRows(rows);
      }
    };
    if (isXlsx) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["employee_id", "name", "phone", "dob", "gender", "email", "package_code", "visit_date"],
      ["EMP001", "John Doe", "9876543210", "1990-01-15", "male", "john@corp.com", "", ""],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Employees");
    XLSX.writeFile(wb, "corporate_bulk_booking_template.xlsx");
  };

  const bulkBook = async () => {
    if (!bulkAccountId) { toast.error("Select a corporate account"); return; }
    if (!bulkPackageId) { toast.error("Select a package"); return; }
    if (csvEmployees.length === 0) { toast.error("Upload file first"); return; }
    const validEmployees = csvEmployees.filter(e => !e._error);
    if (validEmployees.length === 0) { toast.error("No valid employees to book"); return; }

    setBooking(true);
    let success = 0;
    let failed = 0;

    for (const emp of validEmployees) {
      try {
        // Find or create patient by phone
        let patientId: string | null = null;
        if (emp.phone) {
          const { data: existing } = await supabase
            .from("patients")
            .select("id")
            .eq("hospital_id", hospitalId)
            .eq("phone", emp.phone)
            .limit(1)
            .maybeSingle();
          
          if (existing) {
            patientId = existing.id;
          }
        }

        if (!patientId && emp.name) {
          const { data: newPatient, error: pErr } = await supabase
            .from("patients")
            .insert({
              hospital_id: hospitalId,
              full_name: emp.name,
              phone: emp.phone || null,
              dob: emp.dob || null,
              gender: (emp.gender || "other") as any,
              uhid: `EMP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            } as any)
            .select("id")
            .maybeSingle();
          
          if (pErr || !newPatient) { failed++; continue; }
          patientId = newPatient.id;
        }

        if (!patientId) { failed++; continue; }

        // Create booking
        const { error: bErr } = await supabase.from("package_bookings").insert({
          patient_id: patientId,
          package_id: bulkPackageId,
          scheduled_date: bulkDate,
          status: "booked",
          corporate_account_id: bulkAccountId,
          booking_source: "corporate",
        } as any);

        if (bErr) { failed++; } else { success++; }
      } catch {
        failed++;
      }
    }

    setBooking(false);
    toast.success(`Booked ${success} employees. ${failed > 0 ? `${failed} failed.` : ""}`);
    setCsvEmployees([]);
    setShowBulk(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold">Corporate Accounts</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowBulk(true)}><Upload className="h-4 w-4 mr-1" /> Bulk Book from File</Button>
          <Button size="sm" onClick={() => setShowAdd(true)}><Plus className="h-4 w-4 mr-1" /> Add Corporate Account</Button>
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>GSTIN</TableHead>
              <TableHead>Credit Days</TableHead>
              <TableHead>Discount %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.company_name}</TableCell>
                <TableCell>{a.contact_person || "—"}</TableCell>
                <TableCell>{a.contact_phone || "—"}</TableCell>
                <TableCell className="font-mono text-xs">{a.gstin || "—"}</TableCell>
                <TableCell>{a.credit_days}</TableCell>
                <TableCell>{a.negotiated_rate_percent}%</TableCell>
              </TableRow>
            ))}
            {accounts.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No corporate accounts</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Add Account Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Corporate Account</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Company Name *</Label><Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} /></div>
            <div><Label>Contact Person</Label><Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></div>
            <div><Label>Phone</Label><Input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} /></div>
            <div><Label>Email</Label><Input value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} /></div>
            <div><Label>GSTIN</Label><Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} /></div>
            <div><Label>Credit Days</Label><Input type="number" value={form.credit_days} onChange={(e) => setForm({ ...form, credit_days: +e.target.value })} /></div>
            <div><Label>Discount %</Label><Input type="number" value={form.negotiated_rate_percent} onChange={(e) => setForm({ ...form, negotiated_rate_percent: +e.target.value })} /></div>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Booking Dialog */}
      <Dialog open={showBulk} onOpenChange={setShowBulk}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle><Users className="h-5 w-5 inline mr-2" />Corporate Bulk Booking</DialogTitle></DialogHeader>
          
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Corporate Account *</Label>
              <Select value={bulkAccountId} onValueChange={setBulkAccountId}>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.company_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Package *</Label>
              <Select value={bulkPackageId} onValueChange={setBulkPackageId}>
                <SelectTrigger><SelectValue placeholder="Select package" /></SelectTrigger>
                <SelectContent>
                  {packages.map(p => <SelectItem key={p.id} value={p.id}>{p.package_name} — ₹{p.price}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Scheduled Date *</Label>
              <Input type="date" value={bulkDate} onChange={e => setBulkDate(e.target.value)} />
            </div>
          </div>

          <div className="border-2 border-dashed rounded-lg p-4 text-center space-y-2">
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleCsvUpload} />
            <div className="flex justify-center gap-2">
              <Button variant="outline" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4 mr-2" /> Upload Employee File
              </Button>
              <Button variant="ghost" size="sm" onClick={downloadTemplate}>
                <Download className="h-4 w-4 mr-1" /> Download Template
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Accepts .xlsx, .xls, or .csv — columns: employee_id, name, phone, dob, gender</p>
          </div>

          {csvEmployees.length > 0 && (
            <div className="max-h-48 overflow-auto border rounded">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>DOB</TableHead>
                    <TableHead>Gender</TableHead>
                    <TableHead>Emp ID</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {csvEmployees.map((emp, i) => (
                    <TableRow key={i} className={emp._error ? "bg-red-50" : ""}>
                      <TableCell>{emp.name}</TableCell>
                      <TableCell>{emp.phone}</TableCell>
                      <TableCell>{emp.dob}</TableCell>
                      <TableCell>{emp.gender}</TableCell>
                      <TableCell>{emp.employee_id}</TableCell>
                      <TableCell>{emp._error ? <span className="text-xs text-red-600">{emp._error}</span> : <span className="text-xs text-emerald-600">✓ OK</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {csvEmployees.length > 0 && (
            <Badge variant={csvEmployees.some(e => e._error) ? "destructive" : "secondary"} className="text-sm">
              {csvEmployees.filter(e => !e._error).length}/{csvEmployees.length} valid employees ready to book
            </Badge>
          )}

          <div className="flex justify-end gap-2 mt-3">
            <Button variant="outline" onClick={() => { setShowBulk(false); setCsvEmployees([]); }}>Cancel</Button>
            <Button onClick={bulkBook} disabled={booking || csvEmployees.length === 0}>
              {booking ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Book for {csvEmployees.length} Employees
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
