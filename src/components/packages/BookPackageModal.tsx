import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import PatientSearchPicker from "@/components/shared/PatientSearchPicker";
import { useHospitalId } from '@/hooks/useHospitalId';
import { generateBillNumber } from "@/hooks/useBillNumber";
import { autoPostJournalEntry } from "@/lib/accounting";
import { recalculateBillTotalsSafe } from "@/lib/billTotals";
import { parseComponents, componentsOfType } from "@/lib/packageComponents";
import { resolveComponentNames, STAGED_ORDERS_KEY } from "@/lib/packageOrders";

interface Props { open: boolean; onClose: () => void; }

export default function BookPackageModal({ open, onClose }: Props) {
  const { hospitalId } = useHospitalId();
  const [packages, setPackages] = useState<any[]>([]);
  const [patientId, setPatientId] = useState("");
  const [packageId, setPackageId] = useState("");
  const [scheduledDate, setScheduledDate] = useState(new Date().toISOString().split("T")[0]);
  const [scheduledTime, setScheduledTime] = useState("09:00");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // `included_tests` / `included_radiology` / `included_services` were selected here for a
    // long time and DO NOT EXIST on health_packages. PostgREST 400d the whole query, so this
    // list was always empty and no package could be booked. The real column is `components`.
    supabase.from("health_packages")
      .select("id, package_name, price, package_type, components")
      .eq("hospital_id", hospitalId).eq("is_active", true).order("display_order")
      .then(({ data, error }) => {
        if (error) { console.error("Load packages failed:", error.message); return; }
        setPackages(data || []);
      });
  }, [hospitalId]);

  const book = async () => {
    if (!patientId || !packageId || !scheduledDate) { toast.error("Please fill all required fields"); return; }
    setSaving(true);
    try {
      const selectedPkg = packages.find(p => p.id === packageId);
      if (!selectedPkg) { toast.error("Package not found"); setSaving(false); return; }

      // 1. Create booking
      const { data: booking, error } = await supabase.from("package_bookings").insert({
        hospital_id: hospitalId,
        patient_id: patientId,
        package_id: packageId,
        booking_date: new Date().toISOString().split("T")[0],
        scheduled_date: scheduledDate,
        scheduled_time: scheduledTime || null,
        status: "booked",
      }).select("id").maybeSingle();

      if (error) { toast.error("Booking failed: " + error.message); setSaving(false); return; }

      // 2. Get user for billing
      const { data: { user } } = await supabase.auth.getUser();
      const { data: userData } = await supabase.from("users").select("id").eq("auth_user_id", user?.id || "").maybeSingle();
      const userId = userData?.id || null;

      // 3. Create bill
      const fee = Number(selectedPkg.price) || 0;
      const billNumber = await generateBillNumber(hospitalId, "PKG");
      const today = new Date().toISOString().split("T")[0];

      const { data: bill, error: billErr } = await supabase.from("bills").insert({
        hospital_id: hospitalId,
        patient_id: patientId,
        bill_number: billNumber,
        bill_type: "package" as any,
        bill_date: today,
        subtotal: fee,
        total_amount: fee,
        patient_payable: fee,
        paid_amount: 0,
        balance_due: fee,
        payment_status: "unpaid",
        bill_status: "final",
        created_by: userId,
      }).select("id").maybeSingle();

      if (billErr || !bill) {
        console.error("Package bill failed:", billErr);
        toast.success("Package booked (billing failed — create bill manually)");
        onClose();
        setSaving(false);
        return;
      }

      // 4. Insert bill line item
      await supabase.from("bill_line_items").insert({
        hospital_id: hospitalId,
        bill_id: bill.id,
        description: `Health Package: ${selectedPkg.package_name}`,
        item_type: "package",
        unit_rate: fee,
        quantity: 1,
        taxable_amount: fee,
        gst_percent: 0,
        gst_amount: 0,
        total_amount: fee,
      });

      await recalculateBillTotalsSafe(bill.id);

      // 5. Post journal entry
      await autoPostJournalEntry({
        triggerEvent: "bill_finalized_opd",
        sourceModule: "packages",
        sourceId: bill.id,
        amount: fee,
        description: `Package Revenue - ${selectedPkg.package_name} - ${billNumber}`,
        hospitalId,
        postedBy: userId || "",
      });

      // 6. Stage the constituent orders.
      //
      // They are created NOW (so the coordinator can see what the day holds) but both
      // syncLabOrders and syncRadiologyOrders write billing_status: "unbilled", and both
      // worklists filter `.neq("billing_status","unbilled")` — so nothing reaches the lab or
      // the radiographer until the package is actually paid for. releasePackageOrders() in
      // lib/packageOrders.ts flips them the moment the bill settles.
      const components = parseComponents(selectedPkg.components);
      const labNames = await resolveComponentNames(
        hospitalId, componentsOfType(components, "lab_test"), "lab_test_master", "test_name");
      const radNames = await resolveComponentNames(
        hospitalId, componentsOfType(components, "radiology"), "radiology_study_master", "study_name");

      let labCount = 0;
      let radCount = 0;
      const stagedLabIds: string[] = [];
      const stagedRadIds: string[] = [];
      const indication = `Health Package: ${selectedPkg.package_name}`;

      if (labNames.length > 0 && hospitalId) {
        try {
          const { syncLabOrders } = await import("@/lib/investigationSync");
          const labSync = await syncLabOrders({
            hospitalId, patientId, orderedBy: userId || "",
            encounterId: null, admissionId: null,
            items: labNames.map(t => ({ test_name: t, urgency: "routine", clinical_indication: indication })),
          });
          labCount = labSync.created;
          stagedLabIds.push(...labSync.orderIds);
          if (labSync.unmatched.length > 0) {
            toast.warning(`Not in test master (order manually): ${labSync.unmatched.join(", ")}`);
          }
        } catch (e) {
          console.error("Package lab order sync error:", e);
        }
      }

      if (radNames.length > 0 && hospitalId) {
        try {
          const { syncRadiologyOrders } = await import("@/lib/investigationSync");
          const radSync = await syncRadiologyOrders({
            hospitalId, patientId, orderedBy: userId || "",
            encounterId: null, admissionId: null,
            items: radNames.map(r => ({ study_name: r, urgency: "routine", clinical_indication: indication })),
          });
          radCount = radSync.created;
          stagedRadIds.push(...radSync.orderIds);
        } catch (e) {
          console.error("Package radiology order sync error:", e);
        }
      }

      // 7. Link the bill and the staged orders to the booking. `bill_id` existed on
      //    package_bookings but was never populated — it is what payment matches on.
      await supabase.from("package_bookings").update({
        bill_id: bill.id,
        components_done: {
          [STAGED_ORDERS_KEY]: { lab: stagedLabIds, radiology: stagedRadIds },
        },
      } as never).eq("id", booking.id);

      const parts = [`Package booked — ₹${fee.toLocaleString("en-IN")}`];
      if (labCount > 0) parts.push(`${labCount} lab orders`);
      if (radCount > 0) parts.push(`${radCount} radiology orders`);
      toast.success(parts.join(" + "));
      if (labCount > 0 || radCount > 0) {
        toast.info("Orders are held until the package is paid — they appear in the Lab / Radiology worklists on payment.");
      }
      onClose();
    } catch (err) {
      console.error("Package booking error:", err);
      toast.error("Booking failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Book Health Package</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Patient *</Label>
            <PatientSearchPicker hospitalId={hospitalId} value={patientId} onChange={(id) => setPatientId(id)} />
          </div>
          <div>
            <Label>Package *</Label>
            <Select value={packageId} onValueChange={setPackageId}>
              <SelectTrigger><SelectValue placeholder="Select package" /></SelectTrigger>
              <SelectContent>
                {packages.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.package_name} — ₹{Number(p.price).toLocaleString("en-IN")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Date *</Label><Input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} /></div>
            <div><Label>Time</Label><Input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} /></div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={book} disabled={saving}>{saving ? "Booking..." : "Book & Bill Package"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
