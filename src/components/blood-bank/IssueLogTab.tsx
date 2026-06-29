import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { formatBloodGroup, componentLabel } from "@/lib/bloodCompatibility";
import { format, differenceInMinutes } from "date-fns";

const IssueLogTab: React.FC = () => {
  const { toast } = useToast();
  const [issues, setIssues] = useState<any[]>([]);
  const [adverseModal, setAdverseModal] = useState<any>(null);
  const [reactionType, setReactionType] = useState("febrile");

  const fetchIssues = async () => {
    const { data } = await supabase.from("blood_issues")
      .select("*, blood_units(unit_number, blood_group, rh_factor, component), patients(full_name, uhid), users!blood_issues_issued_by_fkey(full_name)")
      .order("issued_at", { ascending: false });
    if (data) setIssues(data);
  };

  useEffect(() => { fetchIssues(); }, []);

  const reportAdverse = async () => {
    if (!adverseModal) return;
    await supabase.from("blood_issues").update({
      adverse_event: true,
      adverse_event_type: reactionType,
    }).eq("id", adverseModal.id);
    toast({ title: "⚠️ Adverse event reported", description: "Transfusion medicine team alerted" });
    setAdverseModal(null);
    fetchIssues();
  };

  const markReturned = async (issue: any) => {
    const mins = differenceInMinutes(new Date(), new Date(issue.issued_at));
    if (mins > 30) {
      toast({ title: "Cannot return", description: "More than 30 minutes since issue — blood safety protocol.", variant: "destructive" });
      return;
    }
    await supabase.from("blood_issues").update({ returned: true, return_reason: "Not transfused — returned within 30 min" }).eq("id", issue.id);
    await supabase.from("blood_units").update({ status: "available", issued_to: null }).eq("id", issue.unit_id);
    toast({ title: "Unit returned to inventory" });
    fetchIssues();
  };

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Date</TableHead>
            <TableHead className="text-xs">Unit #</TableHead>
            <TableHead className="text-xs">Patient</TableHead>
            <TableHead className="text-xs">Component</TableHead>
            <TableHead className="text-xs">Group</TableHead>
            <TableHead className="text-xs">Issued By</TableHead>
            <TableHead className="text-xs">Status</TableHead>
            <TableHead className="text-xs">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {issues.map(i => (
            <TableRow key={i.id} className={i.adverse_event ? "bg-red-50" : ""}>
              <TableCell className="text-xs">{format(new Date(i.issued_at), "dd/MM/yyyy HH:mm")}</TableCell>
              <TableCell className="text-xs font-mono">{i.blood_units?.unit_number}</TableCell>
              <TableCell className="text-xs">{i.patients?.full_name} ({i.patients?.uhid})</TableCell>
              <TableCell className="text-xs">{componentLabel(i.blood_units?.component || "")}</TableCell>
              <TableCell className="text-xs font-semibold">{formatBloodGroup(i.blood_units?.blood_group || "", i.blood_units?.rh_factor || "")}</TableCell>
              <TableCell className="text-xs">{i.users?.full_name || "—"}</TableCell>
              <TableCell>
                {i.adverse_event && <Badge className="bg-red-100 text-red-700 text-[10px]">Adverse Event</Badge>}
                {i.returned && <Badge className="bg-amber-100 text-amber-700 text-[10px]">Returned</Badge>}
                {!i.adverse_event && !i.returned && <Badge className="bg-green-100 text-green-700 text-[10px]">Issued</Badge>}
              </TableCell>
              <TableCell className="space-x-1">
                {!i.adverse_event && !i.returned && (
                  <>
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] text-red-600" onClick={() => setAdverseModal(i)}>Report Adverse</Button>
                    {!i.transfusion_start && <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => markReturned(i)}>Return</Button>}
                  </>
                )}
              </TableCell>
            </TableRow>
          ))}
          {issues.length === 0 && (
            <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">No blood issues recorded yet</TableCell></TableRow>
          )}
        </TableBody>
      </Table>

      <Dialog open={!!adverseModal} onOpenChange={() => setAdverseModal(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Report Adverse Event</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Reaction Type</Label>
              <Select value={reactionType} onValueChange={setReactionType}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="febrile">Febrile</SelectItem>
                  <SelectItem value="allergic">Allergic</SelectItem>
                  <SelectItem value="haemolytic">Haemolytic</SelectItem>
                  <SelectItem value="trali">TRALI</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full bg-red-600 hover:bg-red-700" onClick={reportAdverse}>Report & Alert Team</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default IssueLogTab;
