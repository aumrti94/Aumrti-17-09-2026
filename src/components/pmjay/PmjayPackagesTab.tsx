import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, Plus, Package } from "lucide-react";

interface PmjayPackage {
  id: string;
  package_code: string;
  package_name: string;
  specialty: string;
  procedure_group: string | null;
  rate_inr: number;
  pre_auth_required: boolean;
  is_active: boolean;
}

const PmjayPackagesTab: React.FC = () => {
  const [packages, setPackages] = useState<PmjayPackage[]>([]);
  const [search, setSearch] = useState("");
  const [specialtyFilter, setSpecialtyFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ package_code: "", package_name: "", specialty: "", procedure_group: "", rate_inr: "" });
  const { toast } = useToast();

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const { data } = await supabase.from("pmjay_packages").select("*").order("specialty").order("package_code");
    setPackages((data || []) as PmjayPackage[]);
    setLoading(false);
  };

  const specialties = [...new Set(packages.map(p => p.specialty))].sort();

  const filtered = packages.filter(p => {
    const matchSearch = !search || p.package_code.toLowerCase().includes(search.toLowerCase()) || p.package_name.toLowerCase().includes(search.toLowerCase());
    const matchSpec = specialtyFilter === "all" || p.specialty === specialtyFilter;
    return matchSearch && matchSpec;
  });

  const handleAdd = async () => {
    if (!form.package_code || !form.package_name || !form.specialty || !form.rate_inr) {
      toast({ title: "Fill all required fields", variant: "destructive" }); return;
    }
    const { data: userData } = await supabase.from("users").select("hospital_id").eq("auth_user_id", (await supabase.auth.getUser()).data.user?.id || "").maybeSingle();
    if (!userData?.hospital_id) return;

    const { error } = await supabase.from("pmjay_packages").insert({
      hospital_id: userData.hospital_id,
      package_code: form.package_code,
      package_name: form.package_name,
      specialty: form.specialty,
      procedure_group: form.procedure_group || null,
      rate_inr: Number(form.rate_inr),
      pre_auth_required: true,
      is_active: true,
    });

    if (error) { toast({ title: "Error adding package", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Package added" });
    setShowAdd(false);
    setForm({ package_code: "", package_name: "", specialty: "", procedure_group: "", rate_inr: "" });
    loadData();
  };

  if (loading) return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading...</div>;

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground flex items-start gap-2">
        <Package size={14} className="mt-0.5 shrink-0 text-primary" />
        <span>
          Showing <strong>{packages.length}</strong> packages (system + hospital-custom). The full PMJAY HBP catalog (1,929 packages) can be bulk-imported via{" "}
          <strong>Settings → Data Migration → PMJAY Packages</strong>.
        </span>
      </div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input className="pl-8 w-64 h-9" placeholder="Search code or name..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={specialtyFilter} onValueChange={setSpecialtyFilter}>
            <SelectTrigger className="w-48 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Specialties</SelectItem>
              {specialties.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)} className="gap-1">
          <Plus size={14} /> Add Custom Package
        </Button>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted-foreground">Code</th>
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted-foreground">Package Name</th>
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted-foreground">Specialty</th>
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted-foreground">Group</th>
              <th className="text-right px-3 py-2 text-[11px] font-semibold text-muted-foreground">Rate ₹</th>
              <th className="text-center px-3 py-2 text-[11px] font-semibold text-muted-foreground">Pre-Auth</th>
              <th className="text-center px-3 py-2 text-[11px] font-semibold text-muted-foreground">Active</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No packages found</td></tr>
            ) : filtered.map(p => (
              <tr key={p.id} className="border-t border-border hover:bg-muted/30">
                <td className="px-3 py-2 font-mono text-[12px] font-medium">{p.package_code}</td>
                <td className="px-3 py-2">{p.package_name}</td>
                <td className="px-3 py-2 text-[12px]">{p.specialty}</td>
                <td className="px-3 py-2 text-[12px] text-muted-foreground">{p.procedure_group || "—"}</td>
                <td className="px-3 py-2 text-right font-mono">₹{p.rate_inr.toLocaleString("en-IN")}</td>
                <td className="px-3 py-2 text-center">
                  {p.pre_auth_required ? <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-700">Required</Badge> : "—"}
                </td>
                <td className="px-3 py-2 text-center">
                  <Badge variant="outline" className={p.is_active ? "text-[9px] bg-emerald-50 text-emerald-700" : "text-[9px] bg-red-50 text-red-700"}>
                    {p.is_active ? "Active" : "Inactive"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[11px] text-muted-foreground mt-2">{filtered.length} packages</div>

      {/* Add Package Modal */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Custom Package</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-[11px]">Package Code *</Label>
              <Input className="mt-1" value={form.package_code} onChange={e => setForm({ ...form, package_code: e.target.value })} placeholder="e.g., HBP_CUSTOM_01" />
            </div>
            <div>
              <Label className="text-[11px]">Package Name *</Label>
              <Input className="mt-1" value={form.package_name} onChange={e => setForm({ ...form, package_name: e.target.value })} />
            </div>
            <div>
              <Label className="text-[11px]">Specialty *</Label>
              <Input className="mt-1" value={form.specialty} onChange={e => setForm({ ...form, specialty: e.target.value })} />
            </div>
            <div>
              <Label className="text-[11px]">Procedure Group</Label>
              <Input className="mt-1" value={form.procedure_group} onChange={e => setForm({ ...form, procedure_group: e.target.value })} />
            </div>
            <div>
              <Label className="text-[11px]">Rate (₹) *</Label>
              <Input className="mt-1" type="number" value={form.rate_inr} onChange={e => setForm({ ...form, rate_inr: e.target.value })} />
            </div>
            <Button onClick={handleAdd} className="w-full">Add Package</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PmjayPackagesTab;
