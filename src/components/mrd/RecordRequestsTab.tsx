import React, { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const statusColors: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  fulfilled: "bg-blue-100 text-blue-700",
  partial: "bg-purple-100 text-purple-700",
};

const requesterTypes = ["patient", "legal_guardian", "lawyer", "insurance", "police", "court", "government", "treating_doctor"];

interface Props {
  hospitalId: string;
  userId: string;
  showNewRequest: boolean;
  onCloseNewRequest: () => void;
  onRefresh?: () => void;
}

const RecordRequestsTab: React.FC<Props> = ({ hospitalId, userId, showNewRequest, onCloseNewRequest, onRefresh }) => {
  const [requests, setRequests] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [filter, setFilter] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [rejReason, setRejReason] = useState("");

  // New request form
  const [nrPatientSearch, setNrPatientSearch] = useState("");
  const [nrPatients, setNrPatients] = useState<any[]>([]);
  const [nrPatientId, setNrPatientId] = useState("");
  const [nrRequesterType, setNrRequesterType] = useState("patient");
  const [nrRequesterName, setNrRequesterName] = useState("");
  const [nrRequesterContact, setNrRequesterContact] = useState("");
  const [nrPurpose, setNrPurpose] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (hospitalId) fetchRequests(); }, [filter, hospitalId]);

  const fetchRequests = async () => {
    if (!hospitalId) return;
    setLoading(true);
    let query = (supabase as any).from("record_requests").select("*, patients(full_name, uhid)").eq("hospital_id", hospitalId).order("created_at", { ascending: false }).limit(100);
    if (filter !== "all") query = query.eq("status", filter);
    const { data, error } = await query;
    if (error) toast.error(error.message);
    setRequests(data || []);
    setLoading(false);
  };

  const searchPatients = async (q: string) => {
    setNrPatientSearch(q);
    if (q.length < 2 || !hospitalId) { setNrPatients([]); return; }
    const { data } = await (supabase as any).from("patients").select("id, full_name, uhid").eq("hospital_id", hospitalId).or(`full_name.ilike.%${q}%,uhid.ilike.%${q}%`).limit(10);
    setNrPatients(data || []);
  };

  const createRequest = async () => {
    if (!nrPatientId || !nrRequesterName || !nrPurpose) { toast.error("Fill required fields"); return; }
    setSaving(true);
    const { error } = await (supabase as any).from("record_requests").insert({
      hospital_id: hospitalId,
      patient_id: nrPatientId,
      requester_type: nrRequesterType,
      requester_name: nrRequesterName,
      requester_contact: nrRequesterContact || null,
      purpose: nrPurpose,
      status: "pending",
    });
    if (error) { toast.error(error.message); setSaving(false); return; }
    toast.success("Request created");
    setSaving(false);
    onCloseNewRequest();
    setNrPatientId(""); setNrRequesterName(""); setNrPurpose(""); setNrRequesterContact(""); setNrPatientSearch("");
    fetchRequests();
    onRefresh?.();
  };

  const approveRequest = async () => {
    if (!selected) return;
    const { error } = await (supabase as any).from("record_requests").update({
      status: "approved", approved_by: userId, approved_at: new Date().toISOString(),
    }).eq("id", selected.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Request approved");
    setSelected(null);
    fetchRequests();
    onRefresh?.();
  };

  const rejectRequest = async () => {
    if (!selected || !rejReason) { toast.error("Provide rejection reason"); return; }
    const { error } = await (supabase as any).from("record_requests").update({
      status: "rejected", rejection_reason: rejReason,
    }).eq("id", selected.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Request rejected");
    setSelected(null); setRejReason("");
    fetchRequests();
    onRefresh?.();
  };

  const fulfillRequest = async () => {
    if (!selected) return;
    const { error } = await (supabase as any).from("record_requests").update({
      status: "fulfilled", fulfilled_at: new Date().toISOString(),
    }).eq("id", selected.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Request fulfilled");
    setSelected(null);
    fetchRequests();
    onRefresh?.();
  };

  return (
    <>
      <div className="flex gap-3 h-full">
        <div className="w-[320px] flex flex-col border rounded-lg bg-card">
          <Tabs value={filter} onValueChange={setFilter} className="p-2">
            <TabsList className="w-full">
              <TabsTrigger value="pending" className="flex-1 text-xs">Pending</TabsTrigger>
              <TabsTrigger value="approved" className="flex-1 text-xs">Approved</TabsTrigger>
              <TabsTrigger value="fulfilled" className="flex-1 text-xs">Fulfilled</TabsTrigger>
              <TabsTrigger value="all" className="flex-1 text-xs">All</TabsTrigger>
            </TabsList>
          </Tabs>
          <ScrollArea className="flex-1">
            {loading ? (
              <p className="text-center py-8 text-muted-foreground text-sm">Loading...</p>
            ) : requests.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground text-sm">No requests</p>
            ) : requests.map((req) => (
              <button
                key={req.id}
                onClick={() => setSelected(req)}
                className={`w-full text-left px-3 py-2 border-b hover:bg-muted/50 ${selected?.id === req.id ? "bg-muted" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{req.patients?.full_name || "—"}</span>
                  <Badge variant="secondary" className={`text-[10px] ${statusColors[req.status]}`}>{req.status}</Badge>
                </div>
                <div className="text-[10px] text-muted-foreground capitalize">{req.requester_type?.replace("_", " ")}</div>
                <div className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">{req.purpose}</div>
              </button>
            ))}
          </ScrollArea>
        </div>

        <div className="flex-1 border rounded-lg bg-card p-4 overflow-auto">
          {!selected ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">Select a request</div>
          ) : (
            <div className="space-y-4">
              <h3 className="font-semibold text-sm">Request Details</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground text-xs">Patient:</span><br />{selected.patients?.full_name}</div>
                <div><span className="text-muted-foreground text-xs">Requester:</span><br />{selected.requester_name} ({selected.requester_type?.replace("_", " ")})</div>
                <div><span className="text-muted-foreground text-xs">Contact:</span><br />{selected.requester_contact || "—"}</div>
                <div><span className="text-muted-foreground text-xs">Status:</span><br /><Badge className={statusColors[selected.status]}>{selected.status}</Badge></div>
              </div>
              <div><span className="text-muted-foreground text-xs">Purpose:</span><p className="text-sm mt-1">{selected.purpose}</p></div>

              {selected.status === "pending" && (
                <div className="space-y-3 pt-2 border-t">
                  <div className="flex gap-2">
                    <Button size="sm" onClick={approveRequest}>✓ Approve</Button>
                    <Button size="sm" variant="destructive" onClick={rejectRequest} disabled={!rejReason}>✗ Reject</Button>
                  </div>
                  <Textarea placeholder="Rejection reason (required to reject)" value={rejReason} onChange={(e) => setRejReason(e.target.value)} rows={2} />
                </div>
              )}

              {selected.status === "approved" && (
                <Button size="sm" onClick={fulfillRequest}>Mark as Fulfilled</Button>
              )}

              {selected.rejection_reason && (
                <div className="text-sm text-destructive">Rejected: {selected.rejection_reason}</div>
              )}
            </div>
          )}
        </div>
      </div>

      <Dialog open={showNewRequest} onOpenChange={onCloseNewRequest}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New Record Request</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Patient</Label>
              <Input placeholder="Search patient..." value={nrPatientSearch} onChange={(e) => searchPatients(e.target.value)} />
              {nrPatients.length > 0 && (
                <div className="border rounded mt-1 max-h-32 overflow-auto">
                  {nrPatients.map((p) => (
                    <button key={p.id} onClick={() => { setNrPatientId(p.id); setNrPatientSearch(p.full_name); setNrPatients([]); }}
                      className="w-full text-left px-2 py-1 text-sm hover:bg-muted">
                      {p.full_name} — {p.uhid}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs">Requester Type</Label>
              <Select value={nrRequesterType} onValueChange={setNrRequesterType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{requesterTypes.map((t) => <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Requester Name</Label><Input value={nrRequesterName} onChange={(e) => setNrRequesterName(e.target.value)} /></div>
            <div><Label className="text-xs">Contact</Label><Input value={nrRequesterContact} onChange={(e) => setNrRequesterContact(e.target.value)} /></div>
            <div><Label className="text-xs">Purpose</Label><Textarea value={nrPurpose} onChange={(e) => setNrPurpose(e.target.value)} rows={3} /></div>
            <Button onClick={createRequest} disabled={saving} className="w-full">Submit Request</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default RecordRequestsTab;
