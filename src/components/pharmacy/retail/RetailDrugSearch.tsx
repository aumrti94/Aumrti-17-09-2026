import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search } from "lucide-react";

export interface DrugSearchResult {
  drug_id: string;
  drug_name: string;
  generic_name: string | null;
  category: string | null;
  is_ndps: boolean;
  drug_schedule: string | null;
  gst_percent: number;
  best_batch: {
    id: string;
    batch_number: string;
    expiry_date: string;
    quantity_available: number;
    mrp: number;
    sale_price: number;
    gst_percent: number;
    is_expiring: boolean;
  } | null;
  total_stock: number;
}

const CATEGORIES = ["All", "Antibiotics", "Painkillers", "Antacids", "Vitamins", "Diabetic", "Cardiac", "OTC Packs"];

interface Props {
  hospitalId: string;
  onAddToCart: (drug: DrugSearchResult) => void;
}

const RetailDrugSearch: React.FC<Props> = ({ hospitalId, onAddToCart }) => {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [results, setResults] = useState<DrugSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const search = useCallback(async (q: string, cat: string) => {
    setLoading(true);
    let qb = supabase
      .from("drug_master")
      .select("id, drug_name, generic_name, category, is_ndps, drug_schedule, gst_percent")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .order("drug_name")
      .limit(20);

    if (q.trim()) {
      qb = qb.or(`drug_name.ilike.%${q}%,generic_name.ilike.%${q}%`);
    }
    if (cat !== "All") {
      qb = qb.ilike("category", `%${cat}%`);
    }

    const { data: drugs } = await qb;

    const mapped: DrugSearchResult[] = [];
    for (const d of drugs || []) {
      const { data: batches } = await supabase
        .from("drug_batches")
        .select("id, batch_number, expiry_date, quantity_available, mrp, sale_price, gst_percent")
        .eq("drug_id", d.id)
        .eq("hospital_id", hospitalId)
        .eq("is_active", true)
        .gt("quantity_available", 0)
        .gt("expiry_date", new Date().toISOString().split("T")[0])
        .order("expiry_date", { ascending: true });

      const totalStock = (batches || []).reduce((s, b) => s + b.quantity_available, 0);
      if (totalStock === 0 && q.trim() === "") continue; // hide out-of-stock in browse mode

      const best = batches?.[0] || null;
      mapped.push({
        drug_id: d.id,
        drug_name: d.drug_name,
        generic_name: d.generic_name,
        category: d.category,
        is_ndps: d.is_ndps || false,
        drug_schedule: d.drug_schedule,
        gst_percent: Number(d.gst_percent || 12),
        best_batch: best
          ? {
              ...best,
              mrp: Number(best.mrp),
              sale_price: Number(best.sale_price),
              gst_percent: Number(best.gst_percent || 12),
              is_expiring: new Date(best.expiry_date) <= new Date(Date.now() + 30 * 86400000),
            }
          : null,
        total_stock: totalStock,
      });
    }
    // Merge duplicate drug_master entries with same name
    const mergedMap = new Map<string, DrugSearchResult>();
    for (const item of mapped) {
      const key = item.drug_name.toLowerCase();
      if (mergedMap.has(key)) {
        const existing = mergedMap.get(key)!;
        existing.total_stock += item.total_stock;
        // Keep the best batch with earliest expiry
        if (item.best_batch && (!existing.best_batch ||
          new Date(item.best_batch.expiry_date) < new Date(existing.best_batch.expiry_date))) {
          existing.best_batch = item.best_batch;
        }
      } else {
        mergedMap.set(key, { ...item });
      }
    }

    setResults(Array.from(mergedMap.values()));
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => {
    const timer = setTimeout(() => search(query, category), 300);
    return () => clearTimeout(timer);
  }, [query, category, search]);

  return (
    <div className="w-[320px] flex-shrink-0 bg-card border-r border-border flex flex-col overflow-hidden">
      {/* Search */}
      <div className="h-[56px] flex-shrink-0 px-3.5 flex items-center border-b border-border/50">
        <div className="relative w-full">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search drug or scan barcode..."
            className="pl-9 h-[44px] text-sm bg-muted/30 border-input"
          />
        </div>
      </div>

      {/* Categories */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-border/50 flex flex-wrap gap-1.5">
        {CATEGORIES.map(c => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={cn(
              "px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors active:scale-[0.97]",
              category === c
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >{c}</button>
        ))}
      </div>

      {/* Results */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1.5">
          {loading && <p className="text-center text-xs text-muted-foreground py-6">Searching…</p>}
          {!loading && results.length === 0 && (
            <p className="text-center text-xs text-muted-foreground py-6">
              {query ? "No drugs found" : "Type to search drugs"}
            </p>
          )}
          {results.map(drug => (
            <button
              key={drug.drug_id}
              onClick={() => drug.total_stock > 0 && onAddToCart(drug)}
              disabled={drug.total_stock === 0}
              className={cn(
                "w-full text-left p-2.5 rounded-lg border border-border/50 transition-all active:scale-[0.97]",
                drug.total_stock > 0
                  ? "hover:bg-muted/50 hover:border-border cursor-pointer"
                  : "opacity-50 cursor-not-allowed"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-bold text-foreground truncate">{drug.drug_name}</span>
                {drug.best_batch && (
                  <span className="text-[13px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                    ₹{drug.best_batch.sale_price}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[11px] text-muted-foreground truncate">{drug.generic_name || "—"}</span>
                <div className="flex items-center gap-2">
                  {(drug.drug_schedule === "H" || drug.drug_schedule === "H1") && (
                    <span className="text-[9px] px-1.5 rounded bg-amber-100 text-amber-700 font-bold">{drug.drug_schedule}</span>
                  )}
                  {drug.is_ndps && (
                    <span className="text-[9px] px-1.5 rounded bg-destructive/10 text-destructive font-bold">NDPS</span>
                  )}
                  <span className={cn(
                    "text-[11px] font-medium",
                    drug.total_stock > 20 ? "text-green-600" : drug.total_stock >= 5 ? "text-amber-600" : "text-destructive"
                  )}>
                    {drug.total_stock > 0 ? `${drug.total_stock}u` : "Out"}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};

export default RetailDrugSearch;
