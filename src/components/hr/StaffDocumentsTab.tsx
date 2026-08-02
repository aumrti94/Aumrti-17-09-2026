import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { FileText, Upload, Loader2, Trash2, ExternalLink, ShieldCheck } from "lucide-react";
import { differenceInDays, format } from "date-fns";
import { cn } from "@/lib/utils";
import { openStoredFile, BUCKETS } from "@/lib/storageUrls";

const DOC_TYPES = [
  "offer_letter", "appointment_order", "id_proof", "pan", "address_proof",
  "education_certificate", "experience_certificate", "registration_license", "contract", "other",
];
const label = (s: string) => s.replace(/_/g, " ");

interface Doc {
  id: string;
  user_id: string;
  doc_type: string;
  file_url: string;
  file_name: string | null;
  expiry_date: string | null;
  verified: boolean;
}

const StaffDocumentsTab: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [staff, setStaff] = useState<{ id: string; full_name: string }[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<string>("");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(false);

  const [showUpload, setShowUpload] = useState(false);
  const [uploadForm, setUploadForm] = useState({ doc_type: "id_proof", expiry_date: "" });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!hospitalId) return;
    supabase.from("users").select("id, full_name").eq("hospital_id", hospitalId).eq("is_active", true).order("full_name")
      .then(({ data }) => setStaff(data || []));
  }, [hospitalId]);

  const loadDocs = useCallback(async () => {
    if (!selectedStaff) { setDocs([]); return; }
    setLoading(true);
    const { data } = await (supabase as any).from("staff_documents").select("*").eq("user_id", selectedStaff).order("created_at", { ascending: false });
    setDocs((data || []) as Doc[]);
    setLoading(false);
  }, [selectedStaff]);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file || !selectedStaff || !hospitalId) { toast({ title: "Choose a file", variant: "destructive" }); return; }
    setUploading(true);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      // Private bucket, hospitalId first so the RLS policy accepts the write.
      // The old `staff-documents/${hospitalId}/…` path on public hospital-assets
      // was blocked by that bucket's INSERT policy and exposed staff PII.
      const path = `${hospitalId}/staff-documents/${selectedStaff}/${Date.now()}_${safeName}`;
      const { error: upErr } = await supabase.storage.from(BUCKETS.hospitalPrivate).upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: u } = await supabase.auth.getUser();
      const { data: cu } = await supabase.from("users").select("id").eq("auth_user_id", u.user?.id || "").maybeSingle();
      const { error } = await (supabase as any).from("staff_documents").insert({
        hospital_id: hospitalId, user_id: selectedStaff, doc_type: uploadForm.doc_type,
        file_url: path, file_name: file.name, expiry_date: uploadForm.expiry_date || null,
        uploaded_by: cu?.id || null,
      });
      if (error) throw error;
      toast({ title: "Document uploaded" });
      setShowUpload(false);
      setUploadForm({ doc_type: "id_proof", expiry_date: "" });
      if (fileRef.current) fileRef.current.value = "";
      loadDocs();
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    }
    setUploading(false);
  };

  const toggleVerified = async (doc: Doc) => {
    const { data: u } = await supabase.auth.getUser();
    const { data: cu } = await supabase.from("users").select("id").eq("auth_user_id", u.user?.id || "").maybeSingle();
    await (supabase as any).from("staff_documents").update({ verified: !doc.verified, verified_by: !doc.verified ? cu?.id : null }).eq("id", doc.id);
    setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, verified: !d.verified } : d)));
  };

  const remove = async (id: string) => {
    await (supabase as any).from("staff_documents").delete().eq("id", id);
    setDocs((prev) => prev.filter((d) => d.id !== id));
  };

  const expiryBadge = (date: string | null) => {
    if (!date) return null;
    const days = differenceInDays(new Date(date), new Date());
    if (days < 0) return <Badge className="text-[10px] bg-red-100 text-red-800">Expired</Badge>;
    if (days <= 30) return <Badge className="text-[10px] bg-red-100 text-red-800">{days}d left</Badge>;
    if (days <= 90) return <Badge className="text-[10px] bg-amber-100 text-amber-800">{days}d left</Badge>;
    return <Badge variant="secondary" className="text-[10px]">Valid to {format(new Date(date), "dd MMM yyyy")}</Badge>;
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="h-12 flex-shrink-0 border-b border-border flex items-center gap-3 px-5">
        <FileText className="h-4 w-4 text-primary" />
        <select className="h-8 text-xs border border-input rounded-md px-2 bg-background w-[240px]"
          value={selectedStaff} onChange={(e) => setSelectedStaff(e.target.value)}>
          <option value="">Select staff…</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
        <Button size="sm" className="ml-auto text-xs gap-1.5" disabled={!selectedStaff} onClick={() => setShowUpload(true)}>
          <Upload className="h-3 w-3" /> Upload Document
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {!selectedStaff ? (
          <div className="text-center py-16 text-muted-foreground text-sm">Select a staff member to view documents.</div>
        ) : loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>
        ) : docs.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">No documents uploaded for this staff member.</div>
        ) : (
          <div className="space-y-2">
            {docs.map((d) => (
              <div key={d.id} className="border border-border rounded-lg p-3 bg-card flex items-center gap-3">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold capitalize">{label(d.doc_type)}</span>
                    {expiryBadge(d.expiry_date)}
                    {d.verified && <Badge className="text-[10px] bg-emerald-100 text-emerald-800 gap-0.5"><ShieldCheck className="h-3 w-3" /> Verified</Badge>}
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate">{d.file_name}</p>
                </div>
                <button
                  type="button"
                  className="text-primary"
                  title="Open document"
                  onClick={async () => {
                    if (!(await openStoredFile(BUCKETS.hospitalPrivate, d.file_url))) {
                      toast({ title: "Could not open document", variant: "destructive" });
                    }
                  }}
                >
                  <ExternalLink className="h-4 w-4" />
                </button>
                <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => toggleVerified(d)}>
                  {d.verified ? "Unverify" : "Verify"}
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => remove(d.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Upload dialog */}
      <Dialog open={showUpload} onOpenChange={setShowUpload}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-sm">Upload Document</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Document Type</Label>
              <select className="w-full h-8 text-xs mt-1 border border-input rounded-md px-2 bg-background capitalize"
                value={uploadForm.doc_type} onChange={(e) => setUploadForm((f) => ({ ...f, doc_type: e.target.value }))}>
                {DOC_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Expiry Date (optional)</Label>
              <Input type="date" className="h-8 text-xs mt-1" value={uploadForm.expiry_date} onChange={(e) => setUploadForm((f) => ({ ...f, expiry_date: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">File</Label>
              <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" className="block w-full text-xs mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowUpload(false)}>Cancel</Button>
            <Button size="sm" onClick={handleUpload} disabled={uploading}>
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Upload className="h-3.5 w-3.5 mr-1" />} Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default StaffDocumentsTab;
