import React, { useState, useEffect, useRef, useCallback } from "react";
import { X, Search, Plus, Trash2, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { roundCurrency, formatINR } from "@/lib/currency";
import { chargeOTCase } from "@/lib/serviceBilling";
import { deductCentralFEFO, reverseCentral } from "@/lib/inventoryStock";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import { useToast } from "@/hooks/use-toast";
import type { OTSchedule } from "@/pages/ot/OTPage";

interface OTImplantRow {
  id: string;
  item_name: string;
  manufacturer: string | null;
  lot_number: string | null;
  expiry_date: string | null;
  unit_cost: number;
  quantity: number;
  cdsco_registration_number: string | null;
  billed: boolean;
}

interface DraftImplant {
  name: string;
  manufacturer: string;
  lot_number: string;
  expiry_date: string;
  cdsco_registration_number: string;
  unit_cost: string;
  quantity: string;
  inventory_item_id?: string;
}

const BLANK_DRAFT: DraftImplant = {
  name: "", manufacturer: "", lot_number: "", expiry_date: "",
  cdsco_registration_number: "", unit_cost: "", quantity: "1",
};

interface Props {
  schedule: OTSchedule;
  onClose: () => void;
  onEnded: () => void;
}

const EndCaseModal: React.FC<Props> = ({ schedule, onClose, onEnded }) => {
  const { toast } = useToast();
  const [postOpDx, setPostOpDx] = useState("");
  const [outcome, setOutcome] = useState("success");
  const [complications, setComplications] = useState("");
  const [saving, setSaving] = useState(false);

  // Implant declaration
  const [implantDeclaration, setImplantDeclaration] = useState<"yes" | "no" | null>(null);
  const [noImplantConfirmed, setNoImplantConfirmed] = useState(false);
  const [implants, setImplants] = useState<OTImplantRow[]>([]);

  const fetchImplants = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("ot_implants")
      .select("id, item_name, manufacturer, lot_number, expiry_date, unit_cost, quantity, cdsco_registration_number, billed, inventory_item_id, stock_deducted")
      .eq("schedule_id", schedule.id)
      .order("created_at");
    setImplants(data || []);
  }, [schedule.id]);
  useEffect(() => { fetchImplants(); }, [fetchImplants]);

  // Implant add form
  const [draft, setDraft] = useState<DraftImplant>({ ...BLANK_DRAFT });
  const [implantQuery, setImplantQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Hospital ID (needed for inventory search)
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  useEffect(() => {
    (supabase as any).rpc("get_user_hospital_id").then(({ data }: any) => setHospitalId(data));
  }, []);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const elapsed = schedule.actual_start_time
    ? Math.round((Date.now() - new Date(schedule.actual_start_time).getTime()) / 60000)
    : 0;

  const searchInventory = async (q: string) => {
    if (!hospitalId || q.length < 2) { setSearchResults([]); setShowDropdown(false); return; }
    const { data } = await (supabase as any)
      .from("inventory_items")
      .select("id, item_name, item_code, inventory_stock(cost_price, mrp, batch_number, expiry_date)")
      .eq("hospital_id", hospitalId)
      .ilike("item_name", `%${q}%`)
      .limit(8);
    setSearchResults(data || []);
    setShowDropdown(true);
  };

  const selectInventoryItem = (item: any) => {
    const stock = Array.isArray(item.inventory_stock) && item.inventory_stock.length > 0
      ? item.inventory_stock[0]
      : null;
    setDraft({
      name: item.item_name || "",
      manufacturer: "",
      lot_number: stock?.batch_number || "",
      expiry_date: stock?.expiry_date ? String(stock.expiry_date).split("T")[0] : "",
      unit_cost: stock?.cost_price ? String(stock.cost_price) : (stock?.mrp ? String(stock.mrp) : ""),
      quantity: "1",
      inventory_item_id: item.id,
    });
    setImplantQuery(item.item_name || "");
    setShowDropdown(false);
  };

  const addImplant = async () => {
    const cost = parseFloat(draft.unit_cost);
    const qty = Math.max(1, parseInt(draft.quantity) || 1);
    if (!draft.name.trim() || isNaN(cost) || cost <= 0) {
      toast({ title: "Item name and unit cost are required", variant: "destructive" });
      return;
    }
    if (!draft.cdsco_registration_number.trim()) {
      toast({ title: "CDSCO registration number is required", variant: "destructive" });
      return;
    }
    if (!hospitalId) return;
    // If this implant came from the central inventory master, consume the stock (FEFO).
    const linkedItemId = draft.inventory_item_id || null;
    const { error } = await (supabase as any).from("ot_implants").insert({
      hospital_id: hospitalId,
      schedule_id: schedule.id,
      item_name: draft.name.trim(),
      manufacturer: draft.manufacturer.trim() || null,
      lot_number: draft.lot_number.trim() || null,
      expiry_date: draft.expiry_date || null,
      cdsco_registration_number: draft.cdsco_registration_number.trim(),
      unit_cost: roundCurrency(cost),
      quantity: qty,
      inventory_item_id: linkedItemId,
      stock_deducted: !!linkedItemId,
    });
    if (error) {
      toast({ title: "Failed to add implant", description: error.message, variant: "destructive" });
      return;
    }

    if (linkedItemId) {
      await deductCentralFEFO({
        hospitalId, itemId: linkedItemId, qty,
        ledger: { transactionType: "ot_consumption", referenceId: schedule.id, referenceType: "ot", notes: `OT implant/consumable — ${draft.name.trim()}` },
      });
    }

    setDraft({ ...BLANK_DRAFT });
    setImplantQuery("");
    setSearchResults([]);
    fetchImplants();
  };

  const removeImplant = async (id: string) => {
    const imp: any = implants.find((i) => i.id === id);
    await (supabase as any).from("ot_implants").delete().eq("id", id);
    // Reverse the consumption if this line had deducted central stock.
    if (imp?.inventory_item_id && imp.stock_deducted && hospitalId) {
      await reverseCentral({
        hospitalId, itemId: imp.inventory_item_id, qty: imp.quantity || 0,
        ledger: { transactionType: "ot_consumption_reversal", referenceId: schedule.id, referenceType: "ot", notes: `OT implant removed — ${imp.item_name}` },
      });
    }
    fetchImplants();
  };

  const hasImplants = implants.length > 0;
  const allImplantsCdscoComplete = implants.every((i) => !!i.cdsco_registration_number?.trim());

  const canClose =
    !saving &&
    (hasImplants
      ? allImplantsCdscoComplete
      : implantDeclaration === "no" && noImplantConfirmed);

  const triggerOTBilling = async (otSchedule: OTSchedule) => {
    const { data: userData } = await supabase.rpc("get_user_hospital_id") as any;
    const hospId = userData;
    if (!hospId) return;

    if (!otSchedule.admission_id) {
      toast({ title: "OT completed. Create bill manually for OPD procedure." });
      return;
    }

    const { data: existingBill } = await supabase
      .from("bills")
      .select("id")
      .eq("hospital_id", hospId)
      .eq("admission_id", otSchedule.admission_id)
      .eq("bill_type", "ipd")
      .maybeSingle();

    let billId = existingBill?.id;

    if (!billId) {
      const today = new Date().toISOString().split("T")[0];
      const billNum = await generateBillNumber(hospId, "BILL");
      const { data: newBill } = await supabase
        .from("bills")
        .insert({
          hospital_id: hospId,
          patient_id: otSchedule.patient_id,
          admission_id: otSchedule.admission_id,
          bill_number: billNum,
          bill_type: "ipd",
          bill_date: today,
          bill_status: "draft",
          payment_status: "unpaid",
          total_amount: 0,
          balance_due: 0,
        })
        .select("id")
        .maybeSingle();
      billId = newBill?.id;
    }

    if (!billId) return;

    const result = await chargeOTCase({ hospitalId: hospId, billId, schedule: otSchedule });

    if (result.itemsAdded > 0) {
      toast({ title: `OT charges auto-billed: ₹${result.total.toLocaleString("en-IN")}` });
    } else {
      toast({ title: "OT charges already billed", description: "No new items to add" });
    }
  };

  const handleEnd = async () => {
    setSaving(true);
    const endTime = new Date().toISOString();

    // Check implants against approved pre-auth for insurance admissions
    if (schedule.admission_id && implants.length > 0) {
      const { data: adm } = await supabase
        .from("admissions")
        .select("insurance_type")
        .eq("id", schedule.admission_id)
        .maybeSingle();

      if (adm?.insurance_type && adm.insurance_type !== "self_pay") {
        const { data: preAuth } = await (supabase as any)
          .from("insurance_pre_auth")
          .select("id, procedure_codes, tpa_name")
          .eq("admission_id", schedule.admission_id)
          .in("status", ["approved", "partially_approved"])
          .order("approved_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const implantNames = implants.map(i => i.item_name).join(", ");

        if (!preAuth) {
          toast({
            title: "No Approved Pre-Auth — Implants Unbilled Risk",
            description: `Implants used: ${implantNames}. No approved pre-auth on file for this admission. Billing team must obtain retrospective approval before discharge.`,
            variant: "destructive",
          });
        } else {
          const approvedCodes: string[] = Array.isArray(preAuth.procedure_codes)
            ? preAuth.procedure_codes
            : [];
          if (approvedCodes.length === 0) {
            toast({
              title: "Pre-Auth Has No Procedure Codes — Verify Implants",
              description: `Implants: ${implantNames}. Pre-auth from ${preAuth.tpa_name} has no procedure codes listed. Billing team must confirm implant coverage before discharge.`,
              variant: "destructive",
            });
          } else {
            toast({
              title: "Implants Declared — Billing Team to Verify Pre-Auth Scope",
              description: `Implants: ${implantNames}. Confirm these items fall within the approved pre-auth scope (${approvedCodes.length} procedure code(s) on file).`,
            });
          }
        }
      }
    }

    // ── WHO SSC gate — all 3 phases must be complete before case can close ──
    const { data: whoChecklist } = await (supabase as any)
      .from("ot_checklists")
      .select("signin_completed_at, timeout_completed_at, signout_completed_at, skip_reason")
      .eq("ot_schedule_id", schedule.id)
      .maybeSingle();

    const allPhasesComplete =
      whoChecklist?.signin_completed_at &&
      whoChecklist?.timeout_completed_at &&
      whoChecklist?.signout_completed_at;
    const hasDocumentedSkip = !!whoChecklist?.skip_reason?.trim();

    if (!allPhasesComplete && !hasDocumentedSkip) {
      toast({
        title: "WHO Checklist Incomplete",
        description:
          "All 3 phases (Sign In, Time Out, Sign Out) must be completed — or a documented reason must be entered in the WHO Checklist tab — before ending this case.",
        variant: "destructive",
      });
      setSaving(false);
      return;
    }

    // ── Anaesthesia consultant signature gate ──
    const { data: anaesthesiaRecord } = await (supabase as any)
      .from("anaesthesia_records")
      .select("consultant_signature")
      .eq("ot_id", schedule.id)
      .maybeSingle();

    if (!anaesthesiaRecord?.consultant_signature) {
      toast({
        title: "Anaesthesia Consultant Signature Required",
        description:
          "The anaesthesia record for this case must be signed by the consultant (Anaesthesia tab → Consultant Sign-Off) before it can be closed.",
        variant: "destructive",
      });
      setSaving(false);
      return;
    }

    const { error } = await supabase
      .from("ot_schedules")
      .update({
        status: "completed",
        actual_end_time: endTime,
        post_op_diagnosis: postOpDx || null,
        booking_notes: complications
          ? `${schedule.booking_notes || ""}\n\nComplications: ${complications}`.trim()
          : schedule.booking_notes,
      })
      .eq("id", schedule.id);

    if (error) {
      toast({ title: "Failed to end case", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    toast({ title: `Case completed ✓ — ${schedule.surgery_name} (${elapsed} min)` });

    // NABH COP.8.4 — implant documentation evidence
    if (hospitalId) {
      const implantSummary = implants.length > 0
        ? implants.map(i => `${i.item_name} x${i.quantity} @ ${formatINR(i.unit_cost)}${i.cdsco_registration_number ? ` (CDSCO ${i.cdsco_registration_number})` : ""}`).join(", ")
        : "None (surgeon confirmed no implants used)";
      await logNABHEvidence(
        hospitalId,
        "COP.8.4",
        `OT Case Closed: ${schedule.surgery_name} — Implants: ${implantSummary}`,
        "compliant"
      );
    }

    await triggerOTBilling({ ...schedule, actual_end_time: endTime, status: "completed" });

    setSaving(false);
    onEnded();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card rounded-2xl w-full max-w-[500px] shadow-xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-border flex-shrink-0">
          <h2 className="text-lg font-bold text-foreground">End Case</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 active:scale-95"><X size={18} /></button>
        </div>

        <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-sm font-bold text-foreground">{schedule.surgery_name}</p>
            <p className="text-xs text-muted-foreground">{schedule.patient?.full_name} · {elapsed} min elapsed</p>
          </div>

          <div>
            <label className="text-xs font-medium mb-1 block">Post-op Diagnosis</label>
            <input value={postOpDx} onChange={(e) => setPostOpDx(e.target.value)} placeholder="Final diagnosis after surgery" className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>

          <div>
            <label className="text-xs font-medium mb-2 block">Case Outcome</label>
            <div className="space-y-2">
              {[
                { value: "success", label: "Completed Successfully" },
                { value: "complications", label: "Completed with Complications" },
                { value: "abandoned", label: "Abandoned / Converted" },
              ].map((opt) => (
                <label key={opt.value} className="flex items-center gap-3 cursor-pointer">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${outcome === opt.value ? "border-primary" : "border-muted-foreground/30"}`}>
                    {outcome === opt.value && <div className="w-2 h-2 rounded-full bg-primary" />}
                  </div>
                  <span className="text-sm text-foreground">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {outcome === "complications" && (
            <div>
              <label className="text-xs font-medium mb-1 block">Describe complications</label>
              <textarea value={complications} onChange={(e) => setComplications(e.target.value)} rows={2} className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
          )}

          {/* ── Implant Declaration (mandatory) ── */}
          <div className="border border-border rounded-lg p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Package size={14} className="text-amber-600 shrink-0" />
              <span className="text-xs font-semibold text-foreground">Implants / High-Value Consumables</span>
              <span className="text-[10px] text-red-500 font-medium ml-auto">Required</span>
            </div>

            {!hasImplants && (
              <>
                <p className="text-xs text-muted-foreground">Were any implants or high-value consumables used in this procedure?</p>
                <div className="flex gap-6">
                  {(["yes", "no"] as const).map((v) => (
                    <label
                      key={v}
                      className="flex items-center gap-2 cursor-pointer"
                      onClick={() => { setImplantDeclaration(v); setNoImplantConfirmed(false); }}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${implantDeclaration === v ? "border-primary" : "border-muted-foreground/30"}`}>
                        {implantDeclaration === v && <div className="w-2 h-2 rounded-full bg-primary" />}
                      </div>
                      <span className="text-sm">{v === "yes" ? "Yes" : "No"}</span>
                    </label>
                  ))}
                </div>
              </>
            )}

            {/* Implants exist (added here or in the Implants & Consumables tab) or user is actively declaring some */}
            {(hasImplants || implantDeclaration === "yes") && (
              <div className="space-y-3 pt-1">
                {/* Inventory search */}
                <div ref={searchRef} className="relative">
                  <div className="flex items-center border border-border rounded-md px-2.5 gap-1.5 bg-background">
                    <Search size={12} className="text-muted-foreground shrink-0" />
                    <input
                      value={implantQuery}
                      onChange={(e) => { setImplantQuery(e.target.value); searchInventory(e.target.value); }}
                      placeholder="Search inventory by name..."
                      className="flex-1 text-xs py-2 bg-transparent focus:outline-none"
                    />
                  </div>
                  {showDropdown && searchResults.length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-20 bg-background border border-border rounded-md shadow-md max-h-36 overflow-y-auto mt-0.5">
                      {searchResults.map((item: any) => {
                        const stock = Array.isArray(item.inventory_stock) && item.inventory_stock.length > 0
                          ? item.inventory_stock[0] : null;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onMouseDown={() => selectInventoryItem(item)}
                            className="w-full text-left px-3 py-2 hover:bg-muted/50 text-xs flex items-center justify-between"
                          >
                            <span className="font-medium">{item.item_name}</span>
                            {stock?.cost_price && (
                              <span className="text-muted-foreground ml-2">{formatINR(Number(stock.cost_price))}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Draft form fields */}
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft(d => ({ ...d, name: e.target.value }))}
                    placeholder="Item name *"
                    className="col-span-2 text-xs border border-border rounded-md px-2.5 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <input
                    value={draft.manufacturer}
                    onChange={(e) => setDraft(d => ({ ...d, manufacturer: e.target.value }))}
                    placeholder="Manufacturer"
                    className="text-xs border border-border rounded-md px-2.5 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <input
                    value={draft.lot_number}
                    onChange={(e) => setDraft(d => ({ ...d, lot_number: e.target.value }))}
                    placeholder="Lot / Batch no."
                    className="text-xs border border-border rounded-md px-2.5 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <input
                    type="date"
                    value={draft.expiry_date}
                    onChange={(e) => setDraft(d => ({ ...d, expiry_date: e.target.value }))}
                    className="text-xs border border-border rounded-md px-2.5 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    title="Expiry date"
                  />
                  <input
                    value={draft.cdsco_registration_number}
                    onChange={(e) => setDraft(d => ({ ...d, cdsco_registration_number: e.target.value }))}
                    placeholder="CDSCO registration # *"
                    className="text-xs border border-border rounded-md px-2.5 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      value={draft.unit_cost}
                      onChange={(e) => setDraft(d => ({ ...d, unit_cost: e.target.value }))}
                      placeholder="Cost ₹ *"
                      min="0"
                      step="0.01"
                      className="flex-1 w-0 text-xs border border-border rounded-md px-2.5 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <input
                      type="number"
                      value={draft.quantity}
                      onChange={(e) => setDraft(d => ({ ...d, quantity: e.target.value }))}
                      placeholder="Qty"
                      min="1"
                      className="w-16 text-xs border border-border rounded-md px-2.5 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={addImplant}
                  className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  <Plus size={13} /> Add to list
                </button>

                {/* Captured implants list */}
                {implants.length > 0 ? (
                  <div className="space-y-1.5 border-t border-border pt-2">
                    {implants.map((imp) => (
                      <div key={imp.id} className="flex items-start justify-between bg-muted/40 rounded-md px-2.5 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate">{imp.item_name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            Qty {imp.quantity} · {formatINR(imp.unit_cost)} each · Total {formatINR(roundCurrency(imp.unit_cost * imp.quantity))}
                            {imp.lot_number ? ` · Lot: ${imp.lot_number}` : ""}
                            {imp.expiry_date ? ` · Exp: ${imp.expiry_date}` : ""}
                          </p>
                          {imp.cdsco_registration_number ? (
                            <p className="text-[10px] text-emerald-600">CDSCO: {imp.cdsco_registration_number}</p>
                          ) : (
                            <p className="text-[10px] text-red-500">⚠ CDSCO registration number missing — required to close</p>
                          )}
                        </div>
                        {!imp.billed && (
                          <button
                            type="button"
                            onClick={() => removeImplant(imp.id)}
                            className="text-muted-foreground hover:text-destructive transition-colors ml-2 shrink-0 mt-0.5"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                    <p className="text-[10px] text-muted-foreground text-right pt-0.5">
                      Implant subtotal (excl. 12% GST): {formatINR(roundCurrency(implants.reduce((s, i) => s + i.unit_cost * i.quantity, 0)))}
                    </p>
                  </div>
                ) : (
                  <p className="text-[10px] text-red-500">At least one implant must be added to proceed.</p>
                )}
              </div>
            )}

            {/* NO — confirmation checkbox */}
            {!hasImplants && implantDeclaration === "no" && (
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={noImplantConfirmed}
                  onChange={(e) => setNoImplantConfirmed(e.target.checked)}
                  className="w-3.5 h-3.5 mt-0.5 shrink-0 rounded border-border accent-primary"
                />
                <span className="text-xs text-muted-foreground leading-relaxed">
                  I confirm no implants or high-value consumables were used in this procedure.
                </span>
              </label>
            )}
          </div>
        </div>

        <div className="px-6 pb-5 pt-3 border-t border-border flex-shrink-0">
          {!canClose && hasImplants && (
            <p className="text-[10px] text-amber-600 mb-2 text-center">All implants must have a CDSCO registration number before closing this case.</p>
          )}
          {!canClose && !hasImplants && implantDeclaration === null && (
            <p className="text-[10px] text-amber-600 mb-2 text-center">Implant declaration is required before closing this case.</p>
          )}
          <button
            onClick={handleEnd}
            disabled={!canClose}
            className="w-full bg-[hsl(var(--sidebar-accent))] text-white font-semibold py-3 rounded-lg hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Ending & Billing..." : "✓ End Case & Close OT"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EndCaseModal;
