import React, { useState, useEffect } from "react";
import { Plus, Check, X, Package, Search, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

const statusColors: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  issued: "bg-sky-100 text-sky-700",
  partially_issued: "bg-amber-100 text-amber-700",
  rejected: "bg-red-100 text-red-700",
  cancelled: "bg-muted text-muted-foreground",
};

const IndentsPanel: React.FC = () => {
  const { toast } = useToast();
  const [indents, setIndents] = useState<any[]>([]);
  const [filter, setFilter] = useState("pending");
  const [selected, setSelected] = useState<any>(null);
  const [indentItems, setIndentItems] = useState<any[]>([]);
  const [issueQtys, setIssueQtys] = useState<Record<string, number>>({});
  const [showNew, setShowNew] = useState(false);
  const [departments, setDepartments] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  const [newIndent, setNewIndent] = useState({ department_id: "", required_date: "", notes: "" });
  const [newItems, setNewItems] = useState<{ item_id: string; quantity: number; remarks: string }[]>([]);
  const [itemSearch, setItemSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const loadIndents = async () => {
    const { data } = await (supabase as any)
      .from("department_indents")
      .select("*, departments(name), users!department_indents_requested_by_fkey(full_name)")
      .order("created_at", { ascending: false });
    setIndents(data || []);
  };

  const loadMaster = async () => {
    const [deptRes, itemRes, stockRes] = await Promise.all([
      supabase.from("departments").select("id, name").eq("is_active", true).order("name", { ascending: true }),
      (supabase as any).from("inventory_items").select("id, item_name, category").eq("is_active", true),
      (supabase as any).from("inventory_stock").select("item_id, quantity_available"),
    ]);
    setDepartments(deptRes.data || []);
    setItems(itemRes.data || []);
    const sm: Record<string, number> = {};
    (stockRes.data || []).forEach((s: any) => { sm[s.item_id] = (sm[s.item_id] || 0) + (s.quantity_available || 0); });
    setStockMap(sm);
  };

  useEffect(() => { loadIndents(); loadMaster(); }, []);

  const loadIndentItems = async (indentId: string) => {
    const { data } = await (supabase as any)
      .from("indent_items")
      .select("*, inventory_items(item_name, category)")
      .eq("indent_id", indentId);
    setIndentItems(data || []);
    const qtys: Record<string, number> = {};
    (data || []).forEach((i: any) => { qtys[i.id] = i.quantity_issued || 0; });
    setIssueQtys(qtys);
  };

  const selectIndent = (indent: any) => {
    setSelected(indent);
    loadIndentItems(indent.id);
  };

  const filtered = filter === "all" ? indents : indents.filter((i) => i.status === filter);

  const updateStatus = async (id: string, status: string) => {
    setSaving(true);
    // Optimistic UI update
    setIndents((prev) => prev.map((i) => i.id === id ? { ...i, status } : i));
    if (selected?.id === id) setSelected((prev: any) => prev ? { ...prev, status } : prev);

    const { data: userData } = await supabase.from("users").select("id").limit(1).maybeSingle();
    await (supabase as any).from("department_indents").update({
      status,
      approved_by: userData?.id,
      approved_at: new Date().toISOString(),
    }).eq("id", id);

    toast({ title: `Indent ${status}` });
    setFilter(status); // Auto-switch to the new status tab
    setSaving(false);
  };

  const issueItems = async () => {
    if (!selected) return;
    setSaving(true);
    const { data: userData } = await supabase.from("users").select("id, hospital_id").limit(1).maybeSingle();
    if (!userData) { setSaving(false); return; }

    const validItems = indentItems.filter((item) => (issueQtys[item.id] || 0) > 0);
    let allIssued = validItems.length === indentItems.length;
    for (const item of indentItems) {
      const qty = issueQtys[item.id] || 0;
      if (qty <= 0 || qty < item.quantity_requested) allIssued = false;
    }

    // Batch update indent_items quantities
    await Promise.all(validItems.map((item) =>
      (supabase as any).from("indent_items").update({ quantity_issued: issueQtys[item.id] }).eq("id", item.id)
    ));

    // Parallel: stock deduction + transaction logging
    await Promise.all(validItems.map(async (item) => {
      const qty = issueQtys[item.id];
      const { data: stockRows } = await (supabase as any)
        .from("inventory_stock")
        .select("id, quantity_available")
        .eq("item_id", item.item_id)
        .gt("quantity_available", 0)
        .order("expiry_date", { ascending: true })
        .limit(1);

      const stockUpdate = stockRows?.[0]
        ? (supabase as any).from("inventory_stock").update({
            quantity_available: Math.max(0, stockRows[0].quantity_available - qty),
          }).eq("id", stockRows[0].id)
        : Promise.resolve();

      const txInsert = (supabase as any).from("stock_transactions").insert({
        hospital_id: userData.hospital_id,
        item_id: item.item_id,
        transaction_type: "indent_issue",
        quantity: -qty,
        reference_id: selected.id,
        reference_type: "indent",
        department_id: selected.department_id,
        created_by: userData.id,
        notes: `Issued against indent ${selected.indent_number}`,
      });

      await Promise.all([stockUpdate, txInsert]);
    }));

    const newStatus = allIssued ? "issued" : "partially_issued";
    await (supabase as any).from("department_indents").update({ status: newStatus }).eq("id", selected.id);

    toast({ title: `Items issued to ${selected.departments?.name} ✓` });
    setFilter(newStatus === "issued" ? "issued" : "approved"); // Auto-switch
    setSelected({ ...selected, status: newStatus });
    loadIndents();
    loadMaster();
    loadIndentItems(selected.id);
    setSaving(false);
  };

  const submitNewIndent = async () => {
    if (!newIndent.department_id || newItems.length === 0) {
      toast({ title: "Select department and add items", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data: userData } = await supabase.from("users").select("id, hospital_id").limit(1).maybeSingle();
    if (!userData) { setSaving(false); return; }

    const indentNumber = `IND-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 900 + 100)}`;
    const { data: indent, error } = await (supabase as any).from("department_indents").insert({
      hospital_id: userData.hospital_id,
      indent_number: indentNumber,
      department_id: newIndent.department_id,
      requested_by: userData.id,
      required_date: newIndent.required_date || null,
      notes: newIndent.notes || null,
      status: "pending",
    }).select().maybeSingle();

    if (error || !indent) { toast({ title: "Failed to create indent", variant: "destructive" }); setSaving(false); return; }

    // Bulk insert all items at once
    await (supabase as any).from("indent_items").insert(
      newItems.map((ni) => ({
        hospital_id: userData.hospital_id,
        indent_id: indent.id,
        item_id: ni.item_id,
        quantity_requested: ni.quantity,
        remarks: ni.remarks || null,
      }))
    );

    toast({ title: `Indent ${indentNumber} submitted` });
    setShowNew(false);
    setNewIndent({ department_id: "", required_date: "", notes: "" });
    setNewItems([]);
    setFilter("pending");
    loadIndents();
    setSaving(false);
  };

  const addItemRow = (itemId: string) => {
    if (newItems.find((n) => n.item_id === itemId)) return;
    setNewItems([...newItems, { item_id: itemId, quantity: 1, remarks: "" }]);
    setItemSearch("");
  };

  const tabs = ["pending", "approved", "issued", "rejected", "all"];

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* LEFT — Indent List */}
      <div className="w-[380px] flex-shrink-0 border-r border-border flex flex-col overflow-hidden">
        <div className="flex-shrink-0 bg-card border-b border-border px-3 py-2 flex items-center gap-1.5 flex-wrap">
          {tabs.map((t) => (
            <button key={t} onClick={() => setFilter(t)} className={cn("px-2.5 py-1 rounded-full text-[10px] font-medium capitalize transition-colors", filter === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
              {t.replace("_", " ")} {t !== "all" && `(${indents.filter((i) => i.status === t).length})`}
            </button>
          ))}
          <Button size="sm" variant="outline" className="ml-auto text-[10px] h-6 gap-1" onClick={() => setShowNew(true)}>
            <Plus className="h-3 w-3" /> New Indent
          </Button>
        </div>

        <div className="flex-1 overflow-auto">
          {filtered.map((indent) => (
            <div
              key={indent.id}
              onClick={() => selectIndent(indent)}
              className={cn(
                "px-4 py-3 border-b border-border/50 cursor-pointer transition-colors",
                selected?.id === indent.id ? "bg-primary/5 border-l-2 border-l-primary" : "hover:bg-muted/30"
              )}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-mono text-muted-foreground">{indent.indent_number}</p>
                  <p className="text-xs font-semibold text-foreground">{indent.departments?.name || "—"}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    By: {indent.users?.full_name || "—"} • {indent.required_date ? `Due: ${indent.required_date}` : "No deadline"}
                  </p>
                </div>
                <span className={cn("text-[9px] px-2 py-0.5 rounded-full capitalize font-medium", statusColors[indent.status] || "bg-muted text-muted-foreground")}>
                  {indent.status?.replace("_", " ")}
                </span>
              </div>
              {indent.status === "pending" && (
                <div className="flex gap-1 mt-2" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="sm" className="h-5 px-2 text-[9px] text-emerald-600" disabled={saving} onClick={() => updateStatus(indent.id, "approved")}>
                    <Check className="h-2.5 w-2.5 mr-0.5" /> Approve
                  </Button>
                  <Button variant="ghost" size="sm" className="h-5 px-2 text-[9px] text-destructive" disabled={saving} onClick={() => updateStatus(indent.id, "rejected")}>
                    <X className="h-2.5 w-2.5 mr-0.5" /> Reject
                  </Button>
                </div>
              )}
              {indent.created_at && (
                <p className="text-[9px] text-muted-foreground mt-1">
                  {formatDistanceToNow(new Date(indent.created_at), { addSuffix: true })}
                </p>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-xs">No indents found.</div>
          )}
        </div>
      </div>

      {/* RIGHT — Indent Detail */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selected ? (
          <>
            <div className="flex-shrink-0 bg-card border-b border-border px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-foreground">{selected.indent_number}</p>
                <p className="text-[10px] text-muted-foreground">{selected.departments?.name} • {selected.required_date || "No deadline"}</p>
              </div>
              <span className={cn("text-[10px] px-2.5 py-0.5 rounded-full capitalize font-medium", statusColors[selected.status])}>
                {selected.status?.replace("_", " ")}
              </span>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Item</th>
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Category</th>
                    <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Requested</th>
                    <th className="text-right px-3 py-2 font-semibold text-muted-foreground">In Stock</th>
                    <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Issue Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {indentItems.map((item) => {
                    const stock = stockMap[item.item_id] || 0;
                    const enough = stock >= item.quantity_requested;
                    return (
                      <tr key={item.id} className="border-b border-border/50">
                        <td className="px-4 py-2 font-medium text-foreground">{item.inventory_items?.item_name || "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground capitalize">{item.inventory_items?.category || "—"}</td>
                        <td className="px-3 py-2 text-right font-semibold">{item.quantity_requested}</td>
                        <td className={cn("px-3 py-2 text-right font-semibold", enough ? "text-emerald-600" : "text-destructive")}>{stock}</td>
                        <td className="px-3 py-2 text-right">
                          {(selected.status === "approved" || selected.status === "partially_issued") ? (
                            <Input
                              type="number"
                              min={0}
                              max={Math.min(item.quantity_requested, stock)}
                              value={issueQtys[item.id] || 0}
                              onChange={(e) => setIssueQtys({ ...issueQtys, [item.id]: parseInt(e.target.value) || 0 })}
                              className="h-7 w-16 text-xs text-right ml-auto"
                            />
                          ) : (
                            <span className="text-muted-foreground">{item.quantity_issued || 0}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {indentItems.length === 0 && (
                    <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">No items in this indent.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {(selected.status === "approved" || selected.status === "partially_issued") && indentItems.length > 0 && (
              <div className="flex-shrink-0 border-t border-border bg-card px-4 py-2.5">
                <Button size="sm" className="text-xs gap-1.5" onClick={issueItems} disabled={saving}>
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Package className="h-3 w-3" />} Issue Selected Items
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">
            Select an indent to view details
          </div>
        )}
      </div>

      {/* New Indent Modal */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-auto">
          <DialogHeader><DialogTitle className="text-sm">New Indent Request</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Select value={newIndent.department_id} onValueChange={(v) => setNewIndent({ ...newIndent, department_id: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select Department" /></SelectTrigger>
              <SelectContent>
                {departments.map((d) => <SelectItem key={d.id} value={d.id} className="text-xs">{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-2">
              <Input type="date" placeholder="Required Date" value={newIndent.required_date} onChange={(e) => setNewIndent({ ...newIndent, required_date: e.target.value })} className="h-8 text-xs" />
              <Input placeholder="Notes" value={newIndent.notes} onChange={(e) => setNewIndent({ ...newIndent, notes: e.target.value })} className="h-8 text-xs" />
            </div>

            <div className="border border-border rounded-lg p-3">
              <p className="text-[10px] font-semibold text-foreground mb-2">Items</p>
              <div className="relative mb-2">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="Search items to add..." value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} className="pl-8 h-8 text-xs" />
              </div>
              {itemSearch && (
                <div className="max-h-28 overflow-auto border border-border rounded mb-2">
                  {items.filter((i) => i.item_name.toLowerCase().includes(itemSearch.toLowerCase()) && !newItems.find((n) => n.item_id === i.id)).map((i) => (
                    <div key={i.id} onClick={() => addItemRow(i.id)} className="px-3 py-1.5 text-xs hover:bg-muted/50 cursor-pointer flex justify-between">
                      <span>{i.item_name}</span>
                      <span className="text-[10px] text-muted-foreground capitalize">{i.category}</span>
                    </div>
                  ))}
                </div>
              )}
              {newItems.map((ni, idx) => {
                const item = items.find((i) => i.id === ni.item_id);
                return (
                  <div key={ni.item_id} className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs flex-1 truncate">{item?.item_name || "—"}</span>
                    <Input type="number" min={1} value={ni.quantity} onChange={(e) => {
                      const copy = [...newItems]; copy[idx].quantity = parseInt(e.target.value) || 1; setNewItems(copy);
                    }} className="h-7 w-16 text-xs" placeholder="Qty" />
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => setNewItems(newItems.filter((_, i) => i !== idx))}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                );
              })}
              {newItems.length === 0 && <p className="text-[10px] text-muted-foreground text-center py-2">Search and add items above</p>}
            </div>
          </div>
          <div className="flex gap-2 justify-end mt-2">
            <Button variant="outline" size="sm" onClick={() => setShowNew(false)} className="text-xs">Cancel</Button>
            <Button size="sm" onClick={submitNewIndent} disabled={saving} className="text-xs gap-1.5">
              {saving && <Loader2 className="h-3 w-3 animate-spin" />} Submit Indent
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default IndentsPanel;
