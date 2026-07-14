import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Plus, X, Search, Loader2, Award, ShoppingCart } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface Props { hospitalId: string; }

interface Rfq { id: string; rfq_number: string; status: string; due_date: string | null; created_at: string; requisition_id: string | null; }
interface ReqItem { id: string; item_id: string; item_name: string; quantity: number; }
interface Vendor { id: string; vendor_name: string; performance_score: number; }
interface Quote { id: string; vendor_id: string; vendor_name: string; delivery_days: number | null; total_amount: number; status: string; items: Record<string, { unit_rate: number; gst_percent: number }>; }

const getMe = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  const { data } = await supabase.from("users").select("id, hospital_id").eq("auth_user_id", user?.id || "").maybeSingle();
  return data;
};

const RfqPanel: React.FC<Props> = ({ hospitalId }) => {
  const { toast } = useToast();
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [selected, setSelected] = useState<Rfq | null>(null);
  const [reqItems, setReqItems] = useState<ReqItem[]>([]);
  const [invited, setInvited] = useState<Vendor[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [vendorsMaster, setVendorsMaster] = useState<Vendor[]>([]);
  const [itemsMaster, setItemsMaster] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [awarding, setAwarding] = useState(false);

  // quote entry
  const [quotingVendor, setQuotingVendor] = useState<string | null>(null);
  const [quoteRates, setQuoteRates] = useState<Record<string, string>>({});
  const [quoteDelivery, setQuoteDelivery] = useState("");

  const loadRfqs = useCallback(async () => {
    const { data } = await (supabase as any).from("rfqs").select("*").eq("hospital_id", hospitalId).order("created_at", { ascending: false });
    setRfqs(data || []);
  }, [hospitalId]);

  const loadMaster = useCallback(async () => {
    const [v, i] = await Promise.all([
      (supabase as any).from("vendors").select("id, vendor_name, performance_score").eq("hospital_id", hospitalId).eq("is_active", true),
      (supabase as any).from("inventory_items").select("id, item_name, gst_percent").eq("hospital_id", hospitalId).eq("is_active", true),
    ]);
    setVendorsMaster(v.data || []); setItemsMaster(i.data || []);
  }, [hospitalId]);

  useEffect(() => { loadRfqs(); loadMaster(); }, [loadRfqs, loadMaster]);

  const openRfq = async (rfq: Rfq) => {
    setSelected(rfq); setQuotingVendor(null);
    const [{ data: ri }, { data: rv }, { data: q }] = await Promise.all([
      (supabase as any).from("requisition_items").select("id, item_id, quantity, inventory_items(item_name)").eq("requisition_id", rfq.requisition_id),
      (supabase as any).from("rfq_vendors").select("vendor_id, vendors(vendor_name, performance_score)").eq("rfq_id", rfq.id),
      (supabase as any).from("vendor_quotations").select("*, vendors(vendor_name), quotation_items(item_id, unit_rate, gst_percent)").eq("rfq_id", rfq.id),
    ]);
    setReqItems((ri || []).map((r: any) => ({ id: r.id, item_id: r.item_id, item_name: r.inventory_items?.item_name || "—", quantity: r.quantity })));
    setInvited((rv || []).map((r: any) => ({ id: r.vendor_id, vendor_name: r.vendors?.vendor_name || "—", performance_score: r.vendors?.performance_score || 0 })));
    setQuotes((q || []).map((qq: any) => ({
      id: qq.id, vendor_id: qq.vendor_id, vendor_name: qq.vendors?.vendor_name || "—",
      delivery_days: qq.delivery_days, total_amount: qq.total_amount, status: qq.status,
      items: Object.fromEntries((qq.quotation_items || []).map((it: any) => [it.item_id, { unit_rate: it.unit_rate, gst_percent: it.gst_percent }])),
    })));
  };

  const saveQuote = async (vendorId: string) => {
    if (!selected) return;
    let total = 0;
    const lines = reqItems.map((ri) => {
      const rate = Number(quoteRates[ri.item_id] || 0);
      const gst = itemsMaster.find((i) => i.id === ri.item_id)?.gst_percent || 12;
      const amt = ri.quantity * rate * (1 + gst / 100);
      total += amt;
      return { item_id: ri.item_id, quantity: ri.quantity, unit_rate: rate, gst_percent: gst, total_amount: amt };
    });
    const { data: quote } = await (supabase as any).from("vendor_quotations").insert({
      hospital_id: hospitalId, rfq_id: selected.id, vendor_id: vendorId,
      delivery_days: quoteDelivery ? Number(quoteDelivery) : null, total_amount: total, status: "received",
    }).select("id").maybeSingle();
    if (quote) {
      await (supabase as any).from("quotation_items").insert(lines.map((l) => ({ ...l, quotation_id: quote.id })));
    }
    toast({ title: "Quote saved" });
    setQuotingVendor(null); setQuoteRates({}); setQuoteDelivery("");
    openRfq(selected);
  };

  const awardToPO = async (quote: Quote) => {
    if (!selected) return;
    setAwarding(true);
    const me = await getMe();
    if (!me) { setAwarding(false); return; }
    // Build PO from the awarded quote's rates
    const poNumber = `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 900 + 100)}`;
    let subtotal = 0, gstTotal = 0;
    const lines = reqItems.map((ri) => {
      const q = quote.items[ri.item_id] || { unit_rate: 0, gst_percent: 12 };
      const amt = ri.quantity * q.unit_rate;
      const gst = amt * (q.gst_percent / 100);
      subtotal += amt; gstTotal += gst;
      return { item_id: ri.item_id, quantity_ordered: ri.quantity, unit_rate: q.unit_rate, gst_percent: q.gst_percent, total_amount: amt + gst };
    });
    const { data: po, error } = await (supabase as any).from("purchase_orders").insert({
      hospital_id: hospitalId, po_number: poNumber, vendor_id: quote.vendor_id,
      total_amount: subtotal, gst_amount: gstTotal, net_amount: subtotal + gstTotal,
      notes: `Awarded from ${selected.rfq_number}`, created_by: me.id, status: "draft",
    }).select("id").maybeSingle();
    if (error || !po) { toast({ title: "Failed to create PO", variant: "destructive" }); setAwarding(false); return; }
    await (supabase as any).from("po_items").insert(lines.map((l) => ({ ...l, hospital_id: hospitalId, po_id: po.id })));
    await (supabase as any).from("vendor_quotations").update({ status: "awarded", po_id: po.id }).eq("id", quote.id);
    await (supabase as any).from("rfqs").update({ status: "awarded" }).eq("id", selected.id);
    if (selected.requisition_id) await (supabase as any).from("purchase_requisitions").update({ status: "closed" }).eq("id", selected.requisition_id);
    toast({ title: `PO ${poNumber} created from ${quote.vendor_name} — set final terms in Purchase Orders` });
    setAwarding(false);
    loadRfqs();
    openRfq({ ...selected, status: "awarded" });
  };

  const lowestForItem = (itemId: string) => {
    const rates = quotes.map((q) => q.items[itemId]?.unit_rate).filter((r): r is number => typeof r === "number" && r > 0);
    return rates.length ? Math.min(...rates) : null;
  };
  const quotedVendorIds = new Set(quotes.map((q) => q.vendor_id));

  // TCO recommendation: 50% price + 20% delivery + 30% vendor performance
  const recommendedQuoteId = (() => {
    if (quotes.length === 0) return null;
    const totals = quotes.map((q) => Number(q.total_amount) || 0);
    const dels = quotes.map((q) => q.delivery_days ?? 999);
    const minT = Math.min(...totals), maxT = Math.max(...totals);
    const minD = Math.min(...dels), maxD = Math.max(...dels);
    let bestId: string | null = null, bestScore = -1;
    quotes.forEach((q) => {
      const t = Number(q.total_amount) || 0;
      const d = q.delivery_days ?? 999;
      const perf = invited.find((v) => v.id === q.vendor_id)?.performance_score ?? 50;
      const rateScore = maxT > minT ? 1 - (t - minT) / (maxT - minT) : 1;
      const delScore = maxD > minD ? 1 - (d - minD) / (maxD - minD) : 1;
      const tco = 0.5 * rateScore + 0.2 * delScore + 0.3 * (perf / 100);
      if (tco > bestScore) { bestScore = tco; bestId = q.id; }
    });
    return bestId;
  })();

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* LEFT — RFQ list */}
      <div className="w-[300px] flex-shrink-0 border-r border-border flex flex-col overflow-hidden">
        <div className="flex-shrink-0 bg-card border-b border-border p-3">
          <button onClick={() => setShowNew(true)} className="w-full flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground font-semibold hover:bg-primary/90">
            <Plus className="h-3 w-3" /> New RFQ
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {rfqs.map((r) => (
            <div key={r.id} onClick={() => openRfq(r)} className={cn("px-4 py-2.5 border-b border-border/50 cursor-pointer", selected?.id === r.id ? "bg-primary/5 border-l-2 border-l-primary" : "hover:bg-muted/30")}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-semibold">{r.rfq_number}</span>
                <span className={cn("text-[9px] px-2 py-0.5 rounded-full font-medium capitalize", r.status === "awarded" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>{r.status}</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">{format(new Date(r.created_at), "dd MMM")} {r.due_date && `· due ${r.due_date}`}</p>
            </div>
          ))}
          {rfqs.length === 0 && <p className="text-center text-xs text-muted-foreground py-10">No RFQs yet</p>}
        </div>
      </div>

      {/* RIGHT — detail */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selected ? (
          <div className="flex-1 overflow-auto p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold">{selected.rfq_number}</p>
                <p className="text-[10px] text-muted-foreground">{reqItems.length} items · {invited.length} vendors invited · {quotes.length} quotes in</p>
              </div>
            </div>

            {/* Comparison grid */}
            <div className="border border-border rounded-lg overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/40 border-b border-border">
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Item</th>
                    <th className="text-right px-2 py-2 font-semibold text-muted-foreground">Qty</th>
                    {quotes.map((q) => <th key={q.id} className={cn("text-right px-3 py-2 font-semibold text-muted-foreground", q.id === recommendedQuoteId && "bg-emerald-50")}>{q.vendor_name}{q.id === recommendedQuoteId && <span className="ml-1 text-[8px] px-1 py-0.5 rounded bg-emerald-600 text-white font-bold">★ REC</span>}<br /><span className="text-[9px] font-normal">score {invited.find(v => v.id === q.vendor_id)?.performance_score ?? "—"}</span></th>)}
                  </tr>
                </thead>
                <tbody>
                  {reqItems.map((ri) => {
                    const low = lowestForItem(ri.item_id);
                    return (
                      <tr key={ri.id} className="border-b border-border/50">
                        <td className="px-3 py-1.5 font-medium">{ri.item_name}</td>
                        <td className="px-2 py-1.5 text-right text-muted-foreground">{ri.quantity}</td>
                        {quotes.map((q) => {
                          const rate = q.items[ri.item_id]?.unit_rate;
                          const isLow = low != null && rate === low;
                          return <td key={q.id} className={cn("px-3 py-1.5 text-right", isLow ? "text-emerald-700 font-bold bg-emerald-50" : "")}>{rate ? `₹${rate}` : "—"}</td>;
                        })}
                      </tr>
                    );
                  })}
                  <tr className="bg-muted/30 font-semibold">
                    <td className="px-3 py-2" colSpan={2}>Total (incl GST) / Delivery</td>
                    {quotes.map((q) => (
                      <td key={q.id} className="px-3 py-2 text-right">
                        ₹{Number(q.total_amount).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                        <span className="block text-[9px] font-normal text-muted-foreground">{q.delivery_days != null ? `${q.delivery_days}d` : "—"}</span>
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td colSpan={2} />
                    {quotes.map((q) => (
                      <td key={q.id} className={cn("px-3 py-2 text-right", q.id === recommendedQuoteId && "bg-emerald-50")}>
                        {selected.status !== "awarded" && q.status !== "awarded" ? (
                          <button onClick={() => awardToPO(q)} disabled={awarding} className={cn("inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded text-white font-semibold disabled:opacity-50", q.id === recommendedQuoteId ? "bg-emerald-600 hover:bg-emerald-700 ring-1 ring-emerald-700" : "bg-muted-foreground/70 hover:bg-muted-foreground")}>
                            <Award className="h-3 w-3" /> {q.id === recommendedQuoteId ? "Award (best TCO)" : "Award"}
                          </button>
                        ) : q.status === "awarded" ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 font-semibold"><ShoppingCart className="h-3 w-3" /> Awarded</span>
                        ) : null}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Quote entry per invited vendor without a quote */}
            {selected.status !== "awarded" && (
              <div className="border border-border rounded-lg p-3">
                <p className="text-xs font-semibold mb-2">Enter a vendor quote</p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {invited.filter((v) => !quotedVendorIds.has(v.id)).map((v) => (
                    <button key={v.id} onClick={() => { setQuotingVendor(v.id); setQuoteRates({}); setQuoteDelivery(""); }} className={cn("text-[10px] px-2 py-1 rounded-full border", quotingVendor === v.id ? "bg-primary/10 border-primary text-primary" : "border-border hover:bg-muted")}>{v.vendor_name}</button>
                  ))}
                  {invited.filter((v) => !quotedVendorIds.has(v.id)).length === 0 && <span className="text-[10px] text-muted-foreground">All invited vendors have quoted.</span>}
                </div>
                {quotingVendor && (
                  <div className="space-y-1.5">
                    {reqItems.map((ri) => (
                      <div key={ri.id} className="flex items-center gap-2">
                        <span className="text-xs flex-1 truncate">{ri.item_name} <span className="text-muted-foreground">×{ri.quantity}</span></span>
                        <input type="number" placeholder="Unit rate" value={quoteRates[ri.item_id] || ""} onChange={(e) => setQuoteRates({ ...quoteRates, [ri.item_id]: e.target.value })} className="h-7 w-24 text-xs px-2 border border-border rounded" />
                      </div>
                    ))}
                    <div className="flex items-center gap-2 pt-1">
                      <input type="number" placeholder="Delivery days" value={quoteDelivery} onChange={(e) => setQuoteDelivery(e.target.value)} className="h-7 w-28 text-xs px-2 border border-border rounded" />
                      <button onClick={() => saveQuote(quotingVendor)} className="ml-auto text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground font-semibold">Save Quote</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">Select or create an RFQ</div>
        )}
      </div>

      {showNew && <NewRfqModal hospitalId={hospitalId} items={itemsMaster} vendors={vendorsMaster} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); loadRfqs(); }} />}
    </div>
  );
};

// ---- New RFQ modal ------------------------------------------------------------
const NewRfqModal: React.FC<{ hospitalId: string; items: any[]; vendors: Vendor[]; onClose: () => void; onCreated: () => void; }> = ({ hospitalId, items, vendors, onClose, onCreated }) => {
  const { toast } = useToast();
  const [rows, setRows] = useState<{ item_id: string; item_name: string; quantity: number }[]>([]);
  const [vendorIds, setVendorIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const addItem = (it: any) => { if (!rows.find((r) => r.item_id === it.id)) setRows([...rows, { item_id: it.id, item_name: it.item_name, quantity: 1 }]); setSearch(""); };

  const submit = async () => {
    if (rows.length === 0 || vendorIds.length === 0) { toast({ title: "Add items and select vendors", variant: "destructive" }); return; }
    setSaving(true);
    const me = await getMe();
    const { data: req } = await (supabase as any).from("purchase_requisitions").insert({ hospital_id: hospitalId, requested_by: me?.id, status: "rfq_created" }).select("id").maybeSingle();
    if (req) await (supabase as any).from("requisition_items").insert(rows.map((r) => ({ requisition_id: req.id, item_id: r.item_id, quantity: r.quantity })));
    const { data: rfq } = await (supabase as any).from("rfqs").insert({ hospital_id: hospitalId, requisition_id: req?.id || null, due_date: dueDate || null, created_by: me?.id, status: "open" }).select("id").maybeSingle();
    if (rfq) await (supabase as any).from("rfq_vendors").insert(vendorIds.map((v) => ({ rfq_id: rfq.id, vendor_id: v })));
    toast({ title: "RFQ created" });
    setSaving(false);
    onCreated();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl w-full max-w-lg max-h-[85vh] overflow-auto p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="text-sm font-bold">New RFQ</h3><button onClick={onClose}><X className="h-4 w-4" /></button></div>
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <input placeholder="Search items to request…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-8 h-8 text-xs border border-border rounded" />
          {search && (
            <div className="absolute z-10 left-0 right-0 max-h-32 overflow-auto border border-border rounded bg-popover mt-0.5">
              {items.filter((i) => i.item_name.toLowerCase().includes(search.toLowerCase())).slice(0, 8).map((i) => (
                <div key={i.id} onClick={() => addItem(i)} className="px-3 py-1.5 text-xs hover:bg-muted cursor-pointer">{i.item_name}</div>
              ))}
            </div>
          )}
        </div>
        {rows.map((r, idx) => (
          <div key={r.item_id} className="flex items-center gap-2">
            <span className="text-xs flex-1 truncate">{r.item_name}</span>
            <input type="number" min={1} value={r.quantity} onChange={(e) => { const c = [...rows]; c[idx].quantity = Number(e.target.value) || 1; setRows(c); }} className="h-7 w-16 text-xs px-2 border border-border rounded" />
            <button onClick={() => setRows(rows.filter((_, i) => i !== idx))} className="text-destructive"><X className="h-3.5 w-3.5" /></button>
          </div>
        ))}
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground mb-1">Invite vendors</p>
          <div className="flex flex-wrap gap-1.5">
            {vendors.map((v) => (
              <button key={v.id} onClick={() => setVendorIds(vendorIds.includes(v.id) ? vendorIds.filter((x) => x !== v.id) : [...vendorIds, v.id])} className={cn("text-[10px] px-2 py-1 rounded-full border", vendorIds.includes(v.id) ? "bg-primary/10 border-primary text-primary" : "border-border hover:bg-muted")}>{v.vendor_name}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-muted-foreground">Due</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-7 text-xs px-2 border border-border rounded" />
          <button onClick={submit} disabled={saving} className="ml-auto text-xs px-4 py-1.5 rounded bg-primary text-primary-foreground font-semibold disabled:opacity-50">{saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Create RFQ"}</button>
        </div>
      </div>
    </div>
  );
};

export default RfqPanel;
