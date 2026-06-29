import React, { useState, useEffect } from "react";
import { Plus, Search, Phone, Mail, X, Star, ArrowLeft, MessageCircle, Truck, ShieldCheck, TrendingUp, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface VendorMetrics {
  totalOrders: number;
  totalSpend: number;
  onTimePct: number;
  qualityPassPct: number;
  grnCount: number;
}

const VendorsPanel: React.FC = () => {
  const { toast } = useToast();
  const [vendors, setVendors] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [vendorPOs, setVendorPOs] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<VendorMetrics | null>(null);
  const [form, setForm] = useState({ vendor_name: "", vendor_code: "", gstin: "", contact_name: "", contact_phone: "", contact_email: "", address: "", credit_days: "30" });
  const [syncingScore, setSyncingScore] = useState(false);
  const [batchScoring, setBatchScoring] = useState(false);

  const loadVendors = async () => {
    const { data } = await (supabase as any).from("vendors").select("*").eq("is_active", true).order("vendor_name");
    setVendors(data || []);
  };

  useEffect(() => { loadVendors(); }, []);

  const loadVendorPOs = async (vendorId: string) => {
    const [posRes, grnsRes] = await Promise.all([
      (supabase as any)
        .from("purchase_orders")
        .select("po_number, po_date, expected_delivery, net_amount, status")
        .eq("vendor_id", vendorId)
        .order("po_date", { ascending: false })
        .limit(10),
      (supabase as any)
        .from("grn_records")
        .select("grn_date, quality_check, total_amount, po_id")
        .eq("vendor_id", vendorId)
        .order("grn_date", { ascending: false })
        .limit(50),
    ]);
    const pos = posRes.data || [];
    const grns = grnsRes.data || [];
    setVendorPOs(pos.slice(0, 5));

    // Compute metrics
    const totalOrders = pos.length;
    const totalSpend = pos.reduce((s: number, p: any) => s + (p.net_amount || 0), 0);
    const poMap: Record<string, string> = {};
    pos.forEach((p: any) => { if (p.expected_delivery) poMap[p.id] = p.expected_delivery; });
    // On-time: GRNs where grn_date <= expected_delivery of linked PO
    let onTime = 0;
    let grnsWithPO = 0;
    grns.forEach((g: any) => {
      if (g.po_id && pos.find((p: any) => p.id === g.po_id)) {
        const po = pos.find((p: any) => p.id === g.po_id);
        if (po?.expected_delivery) {
          grnsWithPO++;
          if (g.grn_date <= po.expected_delivery) onTime++;
        }
      }
    });
    const qualityPass = grns.filter((g: any) => g.quality_check === "pass").length;
    setMetrics({
      totalOrders,
      totalSpend,
      onTimePct: grnsWithPO > 0 ? Math.round((onTime / grnsWithPO) * 100) : -1,
      qualityPassPct: grns.length > 0 ? Math.round((qualityPass / grns.length) * 100) : -1,
      grnCount: grns.length,
    });
  };

  const contactVendorWhatsApp = (vendor: any) => {
    if (!vendor.contact_phone) { toast({ title: "No phone number for this vendor", variant: "destructive" }); return; }
    const msg = `Hello ${vendor.vendor_name},\n\nThis is a message from our hospital procurement team.\n\nPlease respond at your earliest convenience.\n\nThank you.`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
  };

  const selectVendor = (v: any) => { setSelected(v); setMetrics(null); loadVendorPOs(v.id); };

  const syncVendorScore = async () => {
    if (!selected || !metrics || metrics.grnCount === 0) {
      toast({ title: "No GRN data available to calculate score", variant: "destructive" });
      return;
    }
    setSyncingScore(true);
    const onTime = metrics.onTimePct >= 0 ? metrics.onTimePct : 50;
    const quality = metrics.qualityPassPct >= 0 ? metrics.qualityPassPct : 50;
    const score = Math.round(onTime * 0.5 + quality * 0.5);
    await (supabase as any).from("vendors").update({ performance_score: score }).eq("id", selected.id);
    setSelected((s: any) => ({ ...s, performance_score: score }));
    setVendors(prev => prev.map(v => v.id === selected.id ? { ...v, performance_score: score } : v));
    toast({ title: `Score synced: ${score}/100` });
    setSyncingScore(false);
  };

  const batchRescore = async () => {
    setBatchScoring(true);
    const { data: userData } = await supabase.from("users").select("hospital_id").limit(1).maybeSingle();
    if (!userData) { setBatchScoring(false); return; }
    const [vendorsRes, posRes, grnsRes] = await Promise.all([
      (supabase as any).from("vendors").select("id").eq("hospital_id", userData.hospital_id).eq("is_active", true),
      (supabase as any).from("purchase_orders").select("id, vendor_id, expected_delivery").eq("hospital_id", userData.hospital_id),
      (supabase as any).from("grn_records").select("vendor_id, po_id, grn_date, quality_check").eq("hospital_id", userData.hospital_id),
    ]);
    const pos: any[] = posRes.data || [];
    const grns: any[] = grnsRes.data || [];
    let updated = 0;
    for (const vendor of (vendorsRes.data || [])) {
      const vgrns = grns.filter((g: any) => g.vendor_id === vendor.id);
      if (vgrns.length === 0) continue;
      let onTime = 0, grnsWithPO = 0;
      vgrns.forEach((g: any) => {
        const po = pos.find((p: any) => p.id === g.po_id);
        if (po?.expected_delivery) {
          grnsWithPO++;
          if (g.grn_date <= po.expected_delivery) onTime++;
        }
      });
      const qualityPass = vgrns.filter((g: any) => g.quality_check === "pass").length;
      const onTimePct = grnsWithPO > 0 ? Math.round(onTime / grnsWithPO * 100) : 50;
      const qualityPct = Math.round(qualityPass / vgrns.length * 100);
      const score = Math.round(onTimePct * 0.5 + qualityPct * 0.5);
      await (supabase as any).from("vendors").update({ performance_score: score }).eq("id", vendor.id);
      updated++;
    }
    toast({ title: `${updated} vendor score${updated !== 1 ? "s" : ""} updated` });
    setBatchScoring(false);
    loadVendors();
  };

  const filtered = vendors.filter((v) => v.vendor_name.toLowerCase().includes(search.toLowerCase()));

  const handleAdd = async () => {
    if (!form.vendor_name) { toast({ title: "Vendor name required", variant: "destructive" }); return; }
    const { data: userData } = await supabase.from("users").select("hospital_id").limit(1).maybeSingle();
    if (!userData) return;
    await (supabase as any).from("vendors").insert({
      hospital_id: userData.hospital_id,
      ...form,
      credit_days: parseInt(form.credit_days) || 30,
    });
    toast({ title: "Vendor added" });
    setShowAdd(false);
    setForm({ vendor_name: "", vendor_code: "", gstin: "", contact_name: "", contact_phone: "", contact_email: "", address: "", credit_days: "30" });
    loadVendors();
  };

  const scoreColor = (score: number) => score >= 80 ? "text-emerald-600" : score >= 50 ? "text-amber-600" : "text-red-600";

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* LEFT — Vendor List */}
      <div className={cn("flex-shrink-0 border-r border-border flex flex-col overflow-hidden", selected ? "w-[320px]" : "flex-1")}>
        <div className="flex-shrink-0 bg-card border-b border-border px-3 py-2 flex items-center gap-2">
          <div className="relative flex-1 max-w-[220px]">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Search vendors..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-xs" />
          </div>
          <Button size="sm" variant="outline" className="text-xs gap-1.5 h-7" onClick={batchRescore} disabled={batchScoring}>
            <RefreshCw className={cn("h-3 w-3", batchScoring && "animate-spin")} />
            {batchScoring ? "Scoring..." : "Rescore All"}
          </Button>
          <Button size="sm" className="text-xs gap-1.5 h-7" onClick={() => setShowAdd(true)}>
            <Plus className="h-3 w-3" /> Add Vendor
          </Button>
        </div>

        <div className="flex-1 overflow-auto">
          {selected ? (
            // Compact list when detail visible
            filtered.map((v) => (
              <div
                key={v.id}
                onClick={() => selectVendor(v)}
                className={cn(
                  "px-4 py-2.5 border-b border-border/50 cursor-pointer transition-colors",
                  selected?.id === v.id ? "bg-primary/5 border-l-2 border-l-primary" : "hover:bg-muted/30"
                )}
              >
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                    {v.vendor_name.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-foreground truncate">{v.vendor_name}</p>
                    <p className="text-[9px] text-muted-foreground">Score: {v.performance_score}/100</p>
                  </div>
                </div>
              </div>
            ))
          ) : (
            // Card grid when no detail
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((v) => (
                <div key={v.id} onClick={() => selectVendor(v)} className="bg-card border border-border rounded-lg p-4 cursor-pointer hover:border-primary/30 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold flex-shrink-0">
                      {v.vendor_name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-semibold text-foreground truncate">{v.vendor_name}</h4>
                      {v.vendor_code && <p className="text-[10px] text-muted-foreground font-mono">{v.vendor_code}</p>}
                      {v.gstin && <p className="text-[10px] text-muted-foreground">GSTIN: {v.gstin}</p>}
                    </div>
                  </div>
                  <div className="mt-3 space-y-1">
                    {v.contact_phone && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {v.contact_phone}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>Credit: {v.credit_days} days</span>
                    <span>•</span>
                    <span className={scoreColor(v.performance_score)}>Score: {v.performance_score}/100</span>
                  </div>
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="col-span-3 text-center py-12 text-muted-foreground text-sm">No vendors found.</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT — Vendor Scorecard */}
      {selected && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-shrink-0 bg-card border-b border-border px-4 py-3 flex items-center gap-3">
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 md:hidden" onClick={() => setSelected(null)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold flex-shrink-0">
              {selected.vendor_name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-foreground">{selected.vendor_name}</p>
              <p className="text-[10px] text-muted-foreground">{selected.vendor_code || "No code"} • GSTIN: {selected.gstin || "—"}</p>
            </div>
            {selected.contact_phone && (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 text-green-600 border-green-200 hover:bg-green-50" onClick={() => contactVendorWhatsApp(selected)}>
                <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
              </Button>
            )}
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-4">
            {/* Contact Info */}
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs font-semibold text-foreground mb-2">Contact Details</p>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                {selected.contact_name && <p>{selected.contact_name}</p>}
                {selected.contact_phone && (
                  <a href={`tel:${selected.contact_phone}`} className="flex items-center gap-1.5 text-primary"><Phone className="h-3 w-3" /> {selected.contact_phone}</a>
                )}
                {selected.contact_email && (
                  <a href={`mailto:${selected.contact_email}`} className="flex items-center gap-1.5 text-primary"><Mail className="h-3 w-3" /> {selected.contact_email}</a>
                )}
                {selected.address && <p>{selected.address}</p>}
                <p>Credit Terms: {selected.credit_days} days</p>
              </div>
            </div>

            {/* Performance Score */}
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-foreground">Performance Scorecard</p>
                <div className="flex items-center gap-2">
                  <div className="flex gap-0.5">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className={cn("h-3.5 w-3.5", i < Math.round(selected.performance_score / 20) ? "text-amber-400 fill-amber-400" : "text-muted")} />
                    ))}
                  </div>
                  <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1 px-2" onClick={syncVendorScore} disabled={syncingScore || !metrics || metrics.grnCount === 0}>
                    <RefreshCw className={cn("h-2.5 w-2.5", syncingScore && "animate-spin")} />
                    {syncingScore ? "..." : "Sync"}
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/30 rounded-lg p-3 flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary shrink-0" />
                  <div>
                    <p className={cn("text-xl font-bold", scoreColor(selected.performance_score))}>{selected.performance_score}<span className="text-xs text-muted-foreground font-normal">/100</span></p>
                    <p className="text-[10px] text-muted-foreground">Overall Score</p>
                  </div>
                </div>
                <div className="bg-muted/30 rounded-lg p-3 flex items-center gap-2">
                  <Truck className="h-5 w-5 text-blue-500 shrink-0" />
                  <div>
                    <p className={cn("text-xl font-bold", metrics?.onTimePct === -1 ? "text-muted-foreground" : metrics && metrics.onTimePct >= 80 ? "text-emerald-600" : "text-amber-600")}>
                      {metrics?.onTimePct === undefined ? "—" : metrics.onTimePct === -1 ? "N/A" : `${metrics.onTimePct}%`}
                    </p>
                    <p className="text-[10px] text-muted-foreground">On-Time Delivery</p>
                  </div>
                </div>
                <div className="bg-muted/30 rounded-lg p-3 flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-emerald-500 shrink-0" />
                  <div>
                    <p className={cn("text-xl font-bold", metrics?.qualityPassPct === -1 ? "text-muted-foreground" : metrics && metrics.qualityPassPct >= 90 ? "text-emerald-600" : "text-amber-600")}>
                      {metrics?.qualityPassPct === undefined ? "—" : metrics.qualityPassPct === -1 ? "N/A" : `${metrics.qualityPassPct}%`}
                    </p>
                    <p className="text-[10px] text-muted-foreground">Quality Pass Rate</p>
                  </div>
                </div>
                <div className="bg-muted/30 rounded-lg p-3 flex items-center gap-2">
                  <Phone className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xl font-bold text-foreground">{metrics?.totalOrders ?? "—"}</p>
                    <p className="text-[10px] text-muted-foreground">Total Orders</p>
                  </div>
                </div>
              </div>
              {metrics && metrics.totalSpend > 0 && (
                <p className="text-xs text-muted-foreground mt-2">Total spend: <strong>₹{metrics.totalSpend.toLocaleString("en-IN")}</strong></p>
              )}
            </div>

            {/* Recent Orders */}
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs font-semibold text-foreground mb-2">Recent Orders</p>
              {vendorPOs.length > 0 ? (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-1.5 font-medium text-muted-foreground">PO #</th>
                      <th className="text-left py-1.5 font-medium text-muted-foreground">Date</th>
                      <th className="text-right py-1.5 font-medium text-muted-foreground">Amount</th>
                      <th className="text-left py-1.5 font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendorPOs.map((po: any, idx: number) => (
                      <tr key={idx} className="border-b border-border/50">
                        <td className="py-1.5 font-mono">{po.po_number}</td>
                        <td className="py-1.5 text-muted-foreground">{po.po_date}</td>
                        <td className="py-1.5 text-right">₹{(po.net_amount || 0).toLocaleString("en-IN")}</td>
                        <td className="py-1.5 capitalize text-muted-foreground">{po.status?.replace("_", " ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-xs text-muted-foreground">No orders yet.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Vendor Modal */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Add Vendor</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Vendor Name *" value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} className="h-8 text-xs" />
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Vendor Code" value={form.vendor_code} onChange={(e) => setForm({ ...form, vendor_code: e.target.value })} className="h-8 text-xs" />
              <Input placeholder="GSTIN" value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} className="h-8 text-xs" />
            </div>
            <Input placeholder="Contact Person" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} className="h-8 text-xs" />
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Phone" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} className="h-8 text-xs" />
              <Input placeholder="Email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} className="h-8 text-xs" />
            </div>
            <Input placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="h-8 text-xs" />
            <Input placeholder="Credit Days" type="number" value={form.credit_days} onChange={(e) => setForm({ ...form, credit_days: e.target.value })} className="h-8 text-xs" />
          </div>
          <div className="flex gap-2 justify-end mt-2">
            <Button variant="outline" size="sm" onClick={() => setShowAdd(false)} className="text-xs">Cancel</Button>
            <Button size="sm" onClick={handleAdd} className="text-xs">Add Vendor</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default VendorsPanel;
