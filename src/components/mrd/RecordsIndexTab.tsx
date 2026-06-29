import React, { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClipboardList, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import CaseBundleModal from "./CaseBundleModal";

const typeColors: Record<string, string> = {
  ipd: "bg-blue-100 text-blue-800",
  opd: "bg-green-100 text-green-800",
  emergency: "bg-red-100 text-red-800",
  day_care: "bg-purple-100 text-purple-800",
};

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  archived: "bg-gray-100 text-gray-600",
  destroyed: "bg-red-100 text-red-700",
  transferred: "bg-amber-100 text-amber-700",
};

interface Props {
  hospitalId: string;
}

const RecordsIndexTab: React.FC<Props> = ({ hospitalId }) => {
  const [records, setRecords] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [loading, setLoading] = useState(true);
  const [bundleRecord, setBundleRecord] = useState<any>(null);
  const [summaryAdmId, setSummaryAdmId] = useState<string | null>(null);
  const [summaryText, setSummaryText] = useState<string>("");
  const [summaryLoading, setSummaryLoading] = useState(false);

  useEffect(() => { if (hospitalId) fetchRecords(); }, [typeFilter, statusFilter, hospitalId]);

  const fetchRecords = async () => {
    if (!hospitalId) return;
    setLoading(true);
    let query = (supabase as any).from("medical_records").select("*, patients(full_name, uhid)").eq("hospital_id", hospitalId).order("created_at", { ascending: false }).limit(50);
    if (typeFilter !== "all") query = query.eq("record_type", typeFilter);
    if (statusFilter !== "all") query = query.eq("status", statusFilter);
    const { data, error } = await query;
    if (error) { toast.error(error.message); setLoading(false); return; }
    setRecords(data || []);
    setLoading(false);
  };

  const filtered = records.filter((r) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return r.patients?.full_name?.toLowerCase().includes(s) || r.patients?.uhid?.toLowerCase().includes(s);
  });

  const openSummary = async (visitId: string) => {
    setSummaryAdmId(visitId);
    setSummaryLoading(true);
    const { data } = await (supabase as any)
      .from("admissions")
      .select("discharge_notes")
      .eq("id", visitId)
      .maybeSingle();
    setSummaryText(data?.discharge_notes || "No discharge summary recorded.");
    setSummaryLoading(false);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-3 mb-3">
        <Input placeholder="Search patient name or UHID..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="ipd">IPD</SelectItem>
            <SelectItem value="opd">OPD</SelectItem>
            <SelectItem value="emergency">Emergency</SelectItem>
            <SelectItem value="day_care">Day Care</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-auto border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patient</TableHead>
              <TableHead>Record Type</TableHead>
              <TableHead>Visit Date</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Barcode</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No records found</TableCell></TableRow>
            ) : filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <div className="text-[13px] font-medium">{r.patients?.full_name || "—"}</div>
                  <div className="text-[10px] font-mono text-muted-foreground">{r.patients?.uhid || "—"}</div>
                </TableCell>
                <TableCell><Badge variant="secondary" className={typeColors[r.record_type] || ""}>{r.record_type?.toUpperCase()}</Badge></TableCell>
                <TableCell className="text-xs">{r.created_at ? new Date(r.created_at).toLocaleDateString("en-IN") : "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.physical_location || "—"}</TableCell>
                <TableCell className="text-[10px] font-mono">{r.barcode || "—"}</TableCell>
                <TableCell><Badge variant="secondary" className={statusColors[r.status] || ""}>{r.status}</Badge></TableCell>
                <TableCell>
                  {r.record_type === "ipd" && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setBundleRecord(r)}>
                        <ClipboardList className="h-3 w-3 mr-1" /> Bundle →
                      </Button>
                      {r.visit_id && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openSummary(r.visit_id)}>
                          <FileText className="h-3 w-3 mr-1" /> Summary
                        </Button>
                      )}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {summaryAdmId && (
        <Dialog open={!!summaryAdmId} onOpenChange={() => setSummaryAdmId(null)}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Discharge Summary</DialogTitle>
            </DialogHeader>
            {summaryLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">{summaryText}</pre>
            )}
          </DialogContent>
        </Dialog>
      )}

      {bundleRecord && (
        <CaseBundleModal
          open={!!bundleRecord}
          onClose={() => setBundleRecord(null)}
          record={bundleRecord}
          hospitalId={hospitalId}
        />
      )}
    </div>
  );
};

export default RecordsIndexTab;
