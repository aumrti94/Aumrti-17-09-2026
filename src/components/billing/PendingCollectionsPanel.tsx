import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { markItemPaid } from "@/lib/chargePosting";
import { Loader2, RefreshCw, Search, CheckCircle2, AlertCircle, IndianRupee } from "lucide-react";

interface PendingItem {
  id: string;
  bill_id: string;
  bill_number: string;
  patient_name: string;
  uhid: string;
  description: string;
  item_type: string;
  source_module: string;
  total_amount: number;
  payment_status: string;
  created_at: string;
  service_date: string;
}

const MODULE_LABELS: Record<string, string> = {
  lab: "Lab", radiology: "Radiology", dialysis: "Dialysis",
  physio: "Physiotherapy", ot: "OT", blood_bank: "Blood Bank",
  nursing: "Nursing", pharmacy: "Pharmacy",
};

export default function PendingCollectionsPanel() {
  const { hospitalId } = useHospitalId();
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [paying, setPaying] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id || null));
  }, []);

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("bill_line_items")
        .select(`
          id, bill_id, description, item_type, source_module,
          total_amount, payment_status, created_at, service_date,
          bills!inner(bill_number, payment_status, patients!inner(full_name, uhid))
        `)
        .eq("hospital_id", hospitalId)
        .eq("payment_status", "pending_payment")
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;

      const mapped = (data || [])
        .filter((r: any) => r.bills?.payment_status !== "paid")
        .map((r: any) => ({
        id: r.id,
        bill_id: r.bill_id,
        bill_number: r.bills?.bill_number || "",
        patient_name: r.bills?.patients?.full_name || "Unknown",
        uhid: r.bills?.patients?.uhid || "",
        description: r.description,
        item_type: r.item_type,
        source_module: r.source_module || "other",
        total_amount: Number(r.total_amount) || 0,
        payment_status: r.payment_status,
        created_at: r.created_at,
        service_date: r.service_date,
      }));
      setItems(mapped);
    } finally {
      setLoading(false);
    }
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const collectPayment = async (item: PendingItem) => {
    if (!userId) return;
    setPaying(item.id);
    try {
      const ok = await markItemPaid({ billItemId: item.id, collectedBy: userId });
      if (ok) {
        toast.success(`Payment collected for ${item.description}`);
        setItems(prev => prev.filter(i => i.id !== item.id));
      } else {
        toast.error("Failed to mark payment");
      }
    } finally {
      setPaying(null);
    }
  };

  const collectAllForBill = async (billId: string) => {
    if (!userId) return;
    const billItems = items.filter(i => i.bill_id === billId);
    for (const item of billItems) {
      setPaying(item.id);
      await markItemPaid({ billItemId: item.id, collectedBy: userId });
    }
    toast.success(`All payments collected for bill`);
    setItems(prev => prev.filter(i => i.bill_id !== billId));
    setPaying(null);
  };

  const filtered = items.filter(i => {
    const matchSearch = !search.trim() ||
      i.patient_name.toLowerCase().includes(search.toLowerCase()) ||
      i.uhid.toLowerCase().includes(search.toLowerCase()) ||
      i.description.toLowerCase().includes(search.toLowerCase());
    const matchModule = moduleFilter === "all" || i.source_module === moduleFilter;
    return matchSearch && matchModule;
  });

  // Group by patient (bill_id)
  const byBill = filtered.reduce((acc, item) => {
    if (!acc[item.bill_id]) acc[item.bill_id] = [];
    acc[item.bill_id].push(item);
    return acc;
  }, {} as Record<string, PendingItem[]>);

  const totalPending = filtered.reduce((s, i) => s + i.total_amount, 0);
  const modules = [...new Set(items.map(i => i.source_module))];

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Summary bar */}
      <div className="flex items-center gap-4 p-3 rounded-lg bg-red-50 border border-red-200">
        <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-red-700">{filtered.length} pending charges</p>
          <p className="text-xs text-red-600">Total pending: ₹{totalPending.toLocaleString("en-IN")}</p>
        </div>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search patient, UHID, description..."
            className="pl-9 h-9"
          />
        </div>
        <Select value={moduleFilter} onValueChange={setModuleFilter}>
          <SelectTrigger className="w-40 h-9">
            <SelectValue placeholder="All modules" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Modules</SelectItem>
            {modules.map(m => (
              <SelectItem key={m} value={m}>{MODULE_LABELS[m] || m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto space-y-3">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && Object.keys(byBill).length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <CheckCircle2 className="h-10 w-10 mx-auto mb-2 text-emerald-400" />
            <p className="text-sm">All charges collected. Nothing pending.</p>
          </div>
        )}

        {!loading && Object.entries(byBill).map(([billId, billItems]) => {
          const first = billItems[0];
          const billTotal = billItems.reduce((s, i) => s + i.total_amount, 0);
          return (
            <Card key={billId} className="border-orange-200">
              <CardContent className="p-3">
                {/* Patient header */}
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="font-semibold text-sm">{first.patient_name}</span>
                    <span className="text-xs text-muted-foreground ml-2">UHID: {first.uhid}</span>
                    <span className="text-xs text-muted-foreground ml-2">Bill: {first.bill_number}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-orange-700">
                      ₹{billTotal.toLocaleString("en-IN")}
                    </span>
                    {billItems.length > 1 && (
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-xs"
                        onClick={() => collectAllForBill(billId)}
                        disabled={paying !== null}
                      >
                        <IndianRupee className="h-3 w-3 mr-1" />
                        Collect All
                      </Button>
                    )}
                  </div>
                </div>

                {/* Individual items */}
                <div className="space-y-1.5">
                  {billItems.map(item => (
                    <div key={item.id} className="flex items-center gap-2 text-sm bg-muted/40 rounded px-2 py-1.5">
                      <Badge variant="outline" className="text-xs shrink-0">
                        {MODULE_LABELS[item.source_module] || item.source_module}
                      </Badge>
                      <span className="flex-1 truncate">{item.description}</span>
                      <span className="font-medium text-orange-700 shrink-0">
                        ₹{item.total_amount.toLocaleString("en-IN")}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs shrink-0 border-emerald-400 text-emerald-700 hover:bg-emerald-50"
                        onClick={() => collectPayment(item)}
                        disabled={paying === item.id}
                      >
                        {paying === item.id
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <><CheckCircle2 className="h-3 w-3 mr-0.5" /> Paid</>
                        }
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
