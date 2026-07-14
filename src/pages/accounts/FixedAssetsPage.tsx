import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { formatCurrency } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wrench, Plus, Download, Loader2, TrendingDown, ShieldCheck, Trash2, PlayCircle } from "lucide-react";
import { postMultiLineJournal } from "@/lib/accounting";
import { assetAccountFor, buildAcquisitionLines, buildOpeningLines } from "@/lib/assetPosting";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { format, differenceInYears } from "date-fns";
import InsuranceTab from "@/components/accounts/fixed-assets/InsuranceTab";
import DisposalTab from "@/components/accounts/fixed-assets/DisposalTab";

const CATEGORIES = [
  { value: "medical_equipment", label: "Medical Equipment" },
  { value: "furniture",         label: "Furniture & Fixtures" },
  { value: "it_equipment",      label: "IT Equipment" },
  { value: "vehicle",           label: "Vehicle" },
  { value: "building",          label: "Building" },
  { value: "land",              label: "Land" },
  { value: "other",             label: "Other" },
];

// How the asset was funded → credit account for the acquisition entry.
const FUNDING_SOURCES = [
  { value: "1002", label: "Bank" },
  { value: "2001", label: "Accounts Payable (Vendor)" },
  { value: "3001", label: "Capital / Owner Funds" },
];

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-50 text-green-700 border-green-200",
  under_maintenance: "bg-amber-50 text-amber-700 border-amber-200",
  disposed: "bg-muted text-muted-foreground border-border",
  fully_depreciated: "bg-slate-50 text-slate-600 border-slate-200",
};

const TABS = [
  { key: "register",    label: "Asset Register",  icon: Wrench },
  { key: "depreciation",label: "Depreciation",    icon: TrendingDown },
  { key: "insurance",   label: "Insurance",       icon: ShieldCheck },
  { key: "disposal",    label: "Disposal",        icon: Trash2 },
] as const;

type TabKey = typeof TABS[number]["key"];

const DEFAULT_FORM = {
  asset_code: "", asset_name: "", category: "medical_equipment", location: "",
  purchase_date: format(new Date(), "yyyy-MM-dd"), purchase_cost: "", useful_life_years: "5",
  depreciation_method: "straight_line", salvage_value: "0", funding_source: "1002",
  vendor: "", serial_number: "", warranty_expiry: "", amc_expiry: "", invoice_number: "", notes: "",
  insurance_policy_no: "", insurance_provider: "", insurance_expiry: "", insurance_premium: "",
};

function calcBookValue(purchaseCost: number, salvageValue: number, usefulLifeYears: number, purchaseDate: string) {
  const years = differenceInYears(new Date(), new Date(purchaseDate));
  const annualDep = (purchaseCost - salvageValue) / usefulLifeYears;
  const accDep = Math.min(annualDep * years, purchaseCost - salvageValue);
  return { bookValue: Math.max(purchaseCost - accDep, salvageValue), accDep };
}

export default function FixedAssetsPage() {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [tab, setTab] = useState<TabKey>("register");
  const [assets, setAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [refreshKey, setRefreshKey] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [depRunning, setDepRunning] = useState(false);
  const [isOpening, setIsOpening] = useState(false);

  useEffect(() => {
    // Resolve the app users.id (journal posted_by is a FK to users) — not the auth user id.
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle();
      setUserId((data as any)?.id ?? null);
    });
  }, []);

  const fetchAssets = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    let q = (supabase as any).from("fixed_assets").select("*").eq("hospital_id", hospitalId).neq("status", "disposed").order("asset_code");
    if (categoryFilter !== "all") q = q.eq("category", categoryFilter);
    const { data } = await q;
    setAssets(data || []);
    setLoading(false);
  }, [hospitalId, categoryFilter]);

  useEffect(() => { fetchAssets(); }, [fetchAssets]);

  const refresh = () => { fetchAssets(); setRefreshKey(k => k + 1); };

  // Post this month's depreciation to the GL (Dr Depreciation / Cr Accumulated
  // Depreciation) and age the register. Idempotent — safe to click more than once.
  const runDepreciation = async () => {
    if (!hospitalId) return;
    setDepRunning(true);
    const { data, error } = await (supabase as any).rpc("run_monthly_depreciation", { p_hospital_id: hospitalId });
    setDepRunning(false);
    if (error) {
      toast({ title: "Depreciation run failed", description: error.message, variant: "destructive" });
      return;
    }
    const n = Number(data ?? 0);
    toast({ title: n > 0 ? `Depreciation posted for ${n} asset${n === 1 ? "" : "s"}` : "Already up to date for this month" });
    refresh();
  };

  const addAsset = async () => {
    if (!hospitalId || !form.asset_code || !form.asset_name || !form.purchase_cost) return;
    setSaving(true);
    const cost = parseFloat(form.purchase_cost);
    const salvage = parseFloat(form.salvage_value) || 0;
    const life = parseInt(form.useful_life_years) || 5;
    // A fresh purchase starts fully un-depreciated; the monthly job accrues from here.
    // An opening (pre-existing) asset carries its already-accumulated depreciation.
    const { bookValue, accDep } = isOpening
      ? calcBookValue(cost, salvage, life, form.purchase_date)
      : { bookValue: cost, accDep: 0 };

    const { data: inserted } = await (supabase as any).from("fixed_assets").insert({
      hospital_id: hospitalId,
      asset_code: form.asset_code,
      asset_name: form.asset_name,
      category: form.category,
      location: form.location || null,
      purchase_date: form.purchase_date,
      purchase_cost: cost,
      useful_life_years: life,
      depreciation_method: form.depreciation_method,
      salvage_value: salvage,
      current_book_value: bookValue,
      accumulated_dep: accDep,
      vendor: form.vendor || null,
      serial_number: form.serial_number || null,
      warranty_expiry: form.warranty_expiry || null,
      amc_expiry: form.amc_expiry || null,
      invoice_number: form.invoice_number || null,
      notes: form.notes || null,
      insurance_policy_no: form.insurance_policy_no || null,
      insurance_provider: form.insurance_provider || null,
      insurance_expiry: form.insurance_expiry || null,
      insurance_premium: form.insurance_premium ? parseFloat(form.insurance_premium) : null,
    }).select("id").maybeSingle();

    // Book the asset into the GL so it shows on the balance sheet.
    const assetAccount = assetAccountFor(form.category);
    if (inserted?.id) {
      const lines = isOpening
        ? buildOpeningLines(assetAccount, cost, accDep, form.asset_name)
        : buildAcquisitionLines(assetAccount, cost, form.funding_source, form.asset_name);
      await postMultiLineJournal({
        hospitalId, postedBy: userId || "", sourceModule: "fixed_assets", sourceId: inserted.id,
        description: `${isOpening ? "Opening asset" : "Asset acquisition"} — ${form.asset_name}`,
        triggerEvent: isOpening ? "asset_opening" : "asset_acquisition",
        entryDate: form.purchase_date, lines,
      });
    }

    setSaving(false);
    setShowForm(false);
    setForm(DEFAULT_FORM);
    setIsOpening(false);
    refresh();
    toast({ title: "Asset added to register" });
  };

  const exportCSV = () => {
    const rows = [
      ["Code","Name","Category","Purchase Date","Cost","Book Value","Acc. Dep","Status"],
      ...assets.map(a => [a.asset_code, a.asset_name, a.category, a.purchase_date, a.purchase_cost, a.current_book_value, a.accumulated_dep, a.status])
    ];
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `Fixed_Assets_${format(new Date(), "yyyyMMdd")}.csv`; a.click();
  };

  const totalCost = assets.reduce((s, a) => s + Number(a.purchase_cost || 0), 0);
  const totalBookValue = assets.reduce((s, a) => s + Number(a.current_book_value || 0), 0);
  const totalAccDep = assets.reduce((s, a) => s + Number(a.accumulated_dep || 0), 0);
  const insuranceExpiring = assets.filter(a => a.insurance_expiry && new Date(a.insurance_expiry) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)).length;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex-shrink-0 h-14 border-b border-border px-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wrench size={18} className="text-primary" />
          <h1 className="text-[16px] font-bold text-foreground">Fixed Assets Register</h1>
        </div>
        <div className="flex items-center gap-2">
          {tab === "register" && (
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-8 w-44 text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" variant="outline" onClick={runDepreciation} disabled={depRunning} className="gap-1.5 h-8" title="Post this month's depreciation to the ledger">
            {depRunning ? <Loader2 size={12} className="animate-spin" /> : <PlayCircle size={12} />} Run Depreciation
          </Button>
          <Button size="sm" variant="outline" onClick={exportCSV} className="gap-1.5 h-8"><Download size={12} /> Export</Button>
          <Button size="sm" onClick={() => setShowForm(true)} className="gap-1.5 h-8"><Plus size={12} /> Add Asset</Button>
        </div>
      </div>

      {/* KPI bar */}
      <div className="flex-shrink-0 grid grid-cols-5 gap-3 p-4 bg-muted/20 border-b border-border">
        {[
          { l: "Total Assets",             v: assets.length,      fmt: false, c: "text-foreground" },
          { l: "Gross Block",              v: totalCost,          fmt: true,  c: "text-foreground" },
          { l: "Net Block (Book Value)",   v: totalBookValue,     fmt: true,  c: "text-blue-600" },
          { l: "Accumulated Depreciation", v: totalAccDep,        fmt: true,  c: "text-amber-600" },
          { l: "Insurance Expiring (30d)", v: insuranceExpiring,  fmt: false, c: insuranceExpiring > 0 ? "text-red-600" : "text-foreground" },
        ].map(s => (
          <div key={s.l} className="bg-card border border-border rounded-xl p-3">
            <p className="text-[11px] text-muted-foreground">{s.l}</p>
            <p className={cn("text-[20px] font-bold mt-0.5", s.c)}>
              {s.fmt ? formatCurrency(s.v as number) : s.v}
            </p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex-shrink-0 flex gap-0 border-b border-border px-6 bg-background">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors",
                tab === t.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon size={13} />{t.label}
            </button>
          );
        })}
      </div>

      {/* Add form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-2xl shadow-xl overflow-auto max-h-[90vh]">
            <h2 className="text-[15px] font-bold text-foreground mb-4">Add Fixed Asset</h2>
            <div className="grid grid-cols-3 gap-3">
              {[
                { key: "asset_code",        label: "Asset Code *",        type: "text",   span: 1 },
                { key: "asset_name",        label: "Asset Name *",        type: "text",   span: 2 },
                { key: "purchase_date",     label: "Purchase Date *",     type: "date",   span: 1 },
                { key: "purchase_cost",     label: "Purchase Cost (₹) *", type: "number", span: 1 },
                { key: "salvage_value",     label: "Salvage Value (₹)",   type: "number", span: 1 },
                { key: "useful_life_years", label: "Useful Life (years)",  type: "number", span: 1 },
                { key: "location",          label: "Location",             type: "text",   span: 1 },
                { key: "vendor",            label: "Vendor",               type: "text",   span: 1 },
                { key: "serial_number",     label: "Serial No.",           type: "text",   span: 1 },
                { key: "warranty_expiry",   label: "Warranty Expiry",      type: "date",   span: 1 },
                { key: "amc_expiry",        label: "AMC Expiry",           type: "date",   span: 1 },
                { key: "invoice_number",    label: "Invoice No.",          type: "text",   span: 1 },
                { key: "insurance_policy_no",  label: "Insurance Policy No.", type: "text",   span: 1 },
                { key: "insurance_provider",   label: "Insurance Provider",   type: "text",   span: 1 },
                { key: "insurance_expiry",     label: "Insurance Expiry",     type: "date",   span: 1 },
                { key: "insurance_premium",    label: "Insurance Premium (₹)", type: "number", span: 1 },
              ].map(f => (
                <div key={f.key} className={cn(f.span === 2 ? "col-span-2" : "col-span-1")}>
                  <label className="text-[11px] text-muted-foreground">{f.label}</label>
                  <Input type={f.type} value={(form as any)[f.key]}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    className="h-9 mt-1 text-[12px]" />
                </div>
              ))}
              <div>
                <label className="text-[11px] text-muted-foreground">Category *</label>
                <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v }))}>
                  <SelectTrigger className="h-9 mt-1 text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">Depreciation Method</label>
                <Select value={form.depreciation_method} onValueChange={v => setForm(p => ({ ...p, depreciation_method: v }))}>
                  <SelectTrigger className="h-9 mt-1 text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="straight_line">Straight Line (SLM)</SelectItem>
                    <SelectItem value="wdv">Written Down Value (WDV)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">Funding Source (GL credit)</label>
                <Select value={form.funding_source} onValueChange={v => setForm(p => ({ ...p, funding_source: v }))} disabled={isOpening}>
                  <SelectTrigger className="h-9 mt-1 text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FUNDING_SOURCES.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <label className="flex items-center gap-2 mt-3 text-[12px] text-foreground cursor-pointer">
              <input type="checkbox" checked={isOpening} onChange={e => setIsOpening(e.target.checked)} className="h-3.5 w-3.5" />
              Pre-existing asset (opening balance) — books cost + accumulated depreciation against Capital, no cash/P&L impact
            </label>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" onClick={addAsset} disabled={saving || !form.asset_code || !form.asset_name || !form.purchase_cost} className="gap-1.5">
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}Add Asset
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {tab === "register" && (
          loading ? (
            <div className="flex items-center justify-center h-32"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
          ) : assets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <Wrench size={28} className="opacity-20 mb-2" />
              <p className="text-[13px]">No assets registered. Add your first asset.</p>
            </div>
          ) : (
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-muted/50 border-b border-border">
                <tr>
                  {["Code","Name","Category","Purchase Date","Cost","Book Value","Acc. Dep","Status","Warranty"].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 font-medium text-muted-foreground text-[11px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {assets.map(a => {
                  const depPct = a.purchase_cost > 0 ? Math.round(Number(a.accumulated_dep) / Number(a.purchase_cost) * 100) : 0;
                  const isWarrantyExpiring = a.warranty_expiry && new Date(a.warranty_expiry) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                  return (
                    <tr key={a.id} className="border-b border-border hover:bg-muted/20">
                      <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground">{a.asset_code}</td>
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-foreground">{a.asset_name}</p>
                        {a.serial_number && <p className="text-[10px] text-muted-foreground">S/N: {a.serial_number}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground capitalize">{a.category.replace(/_/g, " ")}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{format(new Date(a.purchase_date), "dd/MM/yyyy")}</td>
                      <td className="px-3 py-2.5 tabular-nums">{formatCurrency(a.purchase_cost)}</td>
                      <td className="px-3 py-2.5 tabular-nums text-blue-600 font-medium">{formatCurrency(a.current_book_value || 0)}</td>
                      <td className="px-3 py-2.5">
                        <p className="tabular-nums text-amber-600">{formatCurrency(a.accumulated_dep || 0)}</p>
                        <div className="h-1.5 bg-muted rounded-full mt-1 w-16">
                          <div className="h-full bg-amber-400 rounded-full" style={{ width: `${depPct}%` }} />
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border font-medium", STATUS_STYLES[a.status] || STATUS_STYLES.active)}>
                          {(a.status || "active").replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        {a.warranty_expiry ? (
                          <span className={cn("text-[11px]", isWarrantyExpiring ? "text-red-600 font-semibold" : "text-muted-foreground")}>
                            {format(new Date(a.warranty_expiry), "dd/MM/yy")}
                            {isWarrantyExpiring && " ⚠"}
                          </span>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}

        {tab === "depreciation" && (
          loading ? (
            <div className="flex items-center justify-center h-32"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
          ) : assets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <TrendingDown size={28} className="opacity-20 mb-2" />
              <p className="text-[13px]">No assets registered yet.</p>
            </div>
          ) : (
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-muted/50 border-b border-border">
                <tr>
                  {["Code","Name","Category","Purchase Date","Cost","Salvage","Life (yrs)","Method","Acc. Dep","Book Value","Dep %"].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 font-medium text-muted-foreground text-[11px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {assets.map(a => {
                  const depPct = a.purchase_cost > 0 ? Math.round(Number(a.accumulated_dep) / Number(a.purchase_cost) * 100) : 0;
                  return (
                    <tr key={a.id} className="border-b border-border hover:bg-muted/20">
                      <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground">{a.asset_code}</td>
                      <td className="px-3 py-2.5 font-medium text-foreground">{a.asset_name}</td>
                      <td className="px-3 py-2.5 text-muted-foreground capitalize">{a.category.replace(/_/g, " ")}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{format(new Date(a.purchase_date), "dd/MM/yyyy")}</td>
                      <td className="px-3 py-2.5 tabular-nums">{formatCurrency(a.purchase_cost)}</td>
                      <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{formatCurrency(a.salvage_value || 0)}</td>
                      <td className="px-3 py-2.5 text-center">{a.useful_life_years}</td>
                      <td className="px-3 py-2.5 text-muted-foreground capitalize">{(a.depreciation_method || "straight_line").replace(/_/g, " ")}</td>
                      <td className="px-3 py-2.5 tabular-nums text-amber-600">{formatCurrency(a.accumulated_dep || 0)}</td>
                      <td className="px-3 py-2.5 tabular-nums text-blue-600 font-medium">{formatCurrency(a.current_book_value || 0)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <div className="h-1.5 bg-muted rounded-full w-16">
                            <div className="h-full bg-amber-400 rounded-full" style={{ width: `${depPct}%` }} />
                          </div>
                          <span className="text-[10px] text-muted-foreground">{depPct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}

        {tab === "insurance" && hospitalId && (
          <div className="p-4">
            <InsuranceTab hospitalId={hospitalId} refreshKey={refreshKey} />
          </div>
        )}

        {tab === "disposal" && hospitalId && (
          <div className="p-4">
            <DisposalTab hospitalId={hospitalId} refreshKey={refreshKey} userId={(userId as string) ?? null} onRefresh={refresh} />
          </div>
        )}
      </div>
    </div>
  );
}
