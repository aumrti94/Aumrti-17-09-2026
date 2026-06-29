import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Search, Plus, UserCheck } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (doctorName: string, doctorId?: string) => void;
  hospitalId: string;
  editDoc?: any;
}

const emptyForm = {
  doctor_name: "", specialty: "", qualification: "", clinic_hospital: "",
  phone: "", email: "", city: "", address: "", notes: "",
};

const AddReferralDoctorModal: React.FC<Props> = ({ open, onClose, onSaved, hospitalId, editDoc }) => {
  const { toast } = useToast();
  const [mode, setMode] = useState<"search" | "form">(editDoc ? "form" : "search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (!open) return;
    if (editDoc) {
      setMode("form");
      setForm({
        doctor_name: editDoc.doctor_name || "", specialty: editDoc.specialty || "",
        qualification: editDoc.qualification || "", clinic_hospital: editDoc.clinic_hospital || "",
        phone: editDoc.phone || "", email: editDoc.email || "", city: editDoc.city || "",
        address: editDoc.address || "", notes: editDoc.notes || "",
      });
    } else {
      setMode("search");
      setSearchQuery("");
      setSearchResults([]);
      setForm(emptyForm);
    }
  }, [editDoc, open]);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    const { data } = await supabase
      .from("referral_doctors")
      .select("id, doctor_name, specialty, phone, city, clinic_hospital")
      .eq("hospital_id", hospitalId)
      .or(`doctor_name.ilike.%${q}%,phone.ilike.%${q}%,specialty.ilike.%${q}%`)
      .limit(10);
    setSearchResults(data || []);
    setSearching(false);
  }, [hospitalId]);

  useEffect(() => {
    const t = setTimeout(() => doSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery, doSearch]);

  const selectExisting = (doc: any) => {
    onSaved(doc.doctor_name, doc.id);
    onClose();
  };

  const goToNewForm = () => {
    setForm({ ...emptyForm, doctor_name: searchQuery });
    setMode("form");
  };

  const save = async () => {
    if (!form.doctor_name || !form.phone) {
      toast({ title: "Name and phone required", variant: "destructive" });
      return;
    }
    const payload = { ...form, hospital_id: hospitalId };
    if (editDoc) {
      const { error } = await supabase.from("referral_doctors").update(payload).eq("id", editDoc.id);
      if (error) { toast({ title: "Error saving", description: error.message, variant: "destructive" }); return; }
      toast({ title: "Doctor updated" });
      onSaved(form.doctor_name, editDoc.id);
    } else {
      const { data, error } = await supabase.from("referral_doctors").insert(payload).select("id").maybeSingle();
      if (error) { toast({ title: "Error saving", description: error.message, variant: "destructive" }); return; }
      toast({ title: "Referral doctor added" });
      onSaved(form.doctor_name, data?.id);
    }
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent
        className="max-w-md"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{editDoc ? "Edit" : mode === "search" ? "Find or Add" : "Add"} Referral Doctor</DialogTitle>
        </DialogHeader>

        {mode === "search" && !editDoc && (
          <div className="grid gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, phone, or specialty…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9"
                autoFocus
              />
            </div>

            {searching && <p className="text-sm text-muted-foreground text-center py-2">Searching…</p>}

            {searchResults.length > 0 && (
              <div className="max-h-48 overflow-y-auto border rounded-md divide-y">
                {searchResults.map(doc => (
                  <button
                    key={doc.id}
                    className="w-full text-left px-3 py-2 hover:bg-accent/50 flex items-center gap-2 transition-colors"
                    onClick={() => selectExisting(doc)}
                  >
                    <UserCheck className="h-4 w-4 text-primary shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{doc.doctor_name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {[doc.specialty, doc.phone, doc.city].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-2">No matching doctors found</p>
            )}

            <Button variant="outline" onClick={goToNewForm} className="gap-2">
              <Plus className="h-4 w-4" /> Add New Referral Doctor
            </Button>
          </div>
        )}

        {mode === "form" && (
          <>
            {!editDoc && (
              <Button variant="ghost" size="sm" className="w-fit text-xs gap-1 -mt-2" onClick={() => setMode("search")}>
                <Search className="h-3 w-3" /> Back to search
              </Button>
            )}
            <div className="grid gap-3">
              <div><Label>Doctor Name *</Label><Input value={form.doctor_name} onChange={e => setForm({ ...form, doctor_name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Specialty</Label><Input value={form.specialty} onChange={e => setForm({ ...form, specialty: e.target.value })} /></div>
                <div><Label>Qualification</Label><Input value={form.qualification} onChange={e => setForm({ ...form, qualification: e.target.value })} /></div>
              </div>
              <div><Label>Clinic / Hospital</Label><Input value={form.clinic_hospital} onChange={e => setForm({ ...form, clinic_hospital: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Phone *</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
                <div><Label>Email</Label><Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>City</Label><Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} /></div>
                <div><Label>Address</Label><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
              </div>
              <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} /></div>
            </div>
            <DialogFooter><Button onClick={save}>{editDoc ? "Update" : "Save"}</Button></DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default AddReferralDoctorModal;
