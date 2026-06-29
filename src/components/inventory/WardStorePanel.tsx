import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Plus, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";
import RaiseIndentModal from "./RaiseIndentModal";
import StoreIndentDetailModal from "./StoreIndentDetailModal";

interface StoreLocation {
  id: string;
  name: string;
  type: string;
}

interface StoreIndent {
  id: string;
  indent_number: string;
  status: string;
  requested_at: string;
  approved_at: string | null;
  from_store: { name: string } | null;
  to_store: { name: string } | null;
  requested_by_user: { full_name: string } | null;
  _item_count?: number;
}

interface Props {
  hospitalId: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  partially_issued: "bg-sky-100 text-sky-600",
  issued: "bg-blue-100 text-blue-700",
  received: "bg-purple-100 text-purple-700",
  rejected: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

const FILTER_TABS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "issued", label: "Issued" },
  { key: "received", label: "Received" },
  { key: "rejected", label: "Rejected" },
];

const WardStorePanel: React.FC<Props> = ({ hospitalId }) => {
  const { toast } = useToast();
  const [stores, setStores] = useState<StoreLocation[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>("");
  const [viewMode, setViewMode] = useState<"my_indents" | "issue_stock">("my_indents");
  const [filterTab, setFilterTab] = useState("all");
  const [indents, setIndents] = useState<StoreIndent[]>([]);
  const [loading, setLoading] = useState(false);
  const [showRaise, setShowRaise] = useState(false);
  const [selectedIndentId, setSelectedIndentId] = useState<string | null>(null);

  const fetchStores = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("store_locations")
      .select("id, name, type")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .order("type")
      .order("name");
    const list: StoreLocation[] = data || [];
    setStores(list);
    if (list.length > 0 && !selectedStoreId) {
      const ward = list.find((s) => s.type === "ward" || s.type === "icu" || s.type === "ot");
      setSelectedStoreId((ward || list[0]).id);
    }
  }, [hospitalId, selectedStoreId]);

  const fetchIndents = useCallback(async () => {
    if (!selectedStoreId) return;
    setLoading(true);
    let query = (supabase as any)
      .from("store_indents")
      .select("id, indent_number, status, requested_at, approved_at, from_store:store_locations!store_indents_from_store_id_fkey(name), to_store:store_locations!store_indents_to_store_id_fkey(name), requested_by_user:users!store_indents_requested_by_fkey(full_name)")
      .eq("hospital_id", hospitalId)
      .order("requested_at", { ascending: false });

    if (viewMode === "my_indents") {
      query = query.eq("from_store_id", selectedStoreId);
    } else {
      query = query.eq("to_store_id", selectedStoreId);
    }

    if (filterTab !== "all") {
      if (filterTab === "issued") {
        query = query.in("status", ["issued", "partially_issued"]);
      } else {
        query = query.eq("status", filterTab);
      }
    }

    const { data } = await query;
    setIndents(data || []);
    setLoading(false);
  }, [hospitalId, selectedStoreId, viewMode, filterTab]);

  useEffect(() => { fetchStores(); }, [fetchStores]);
  useEffect(() => { if (selectedStoreId) fetchIndents(); }, [fetchIndents, selectedStoreId]);

  const pendingCount = indents.filter((i) => i.status === "pending").length;
  const selectedStore = stores.find((s) => s.id === selectedStoreId) || null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex-shrink-0 bg-card border-b border-border px-5 py-3 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Store</span>
          <select
            className="text-sm border border-border rounded-lg px-3 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary min-w-[200px]"
            value={selectedStoreId}
            onChange={(e) => setSelectedStoreId(e.target.value)}
          >
            {stores.length === 0 && <option value="">No stores configured</option>}
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div className="flex rounded-lg border border-border overflow-hidden">
          {[
            { key: "my_indents", label: "My Indents" },
            { key: "issue_stock", label: "Issue Stock" },
          ].map((m) => (
            <button
              key={m.key}
              onClick={() => setViewMode(m.key as any)}
              className={cn(
                "text-xs px-3 py-1.5 font-medium transition-colors",
                viewMode === m.key ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-accent"
              )}
            >
              {m.label}
              {m.key === "issue_stock" && pendingCount > 0 && (
                <span className="ml-1.5 bg-amber-500 text-white text-[9px] rounded-full px-1.5 py-0.5 font-bold">{pendingCount}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex gap-1 ml-2">
          {FILTER_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilterTab(t.key)}
              className={cn(
                "text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors",
                filterTab === t.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={fetchIndents} className="text-muted-foreground hover:text-primary transition-colors" title="Refresh">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          {viewMode === "my_indents" && (
            <button
              onClick={() => setShowRaise(true)}
              disabled={stores.length === 0}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary text-white font-semibold hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-50"
            >
              <Plus size={13} /> Raise Indent
            </button>
          )}
        </div>
      </div>

      {/* Indent list */}
      <div className="flex-1 overflow-y-auto">
        {stores.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <p className="text-sm font-medium text-foreground">No store locations configured</p>
            <p className="text-xs text-muted-foreground">Go to Settings › Inventory to create store locations first.</p>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : indents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <p className="text-sm text-muted-foreground">
              {viewMode === "my_indents"
                ? "No indents raised from this store"
                : "No pending indents for this store"}
            </p>
            {viewMode === "my_indents" && (
              <button
                onClick={() => setShowRaise(true)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary text-white font-semibold hover:bg-primary/90 transition-all mt-1"
              >
                <Plus size={13} /> Raise First Indent
              </button>
            )}
          </div>
        ) : (
          <div className="p-4 space-y-2">
            {indents.map((indent) => (
              <button
                key={indent.id}
                onClick={() => setSelectedIndentId(indent.id)}
                className="w-full text-left bg-card border border-border rounded-xl p-4 hover:shadow-sm hover:border-primary/30 transition-all active:scale-[0.99]"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-foreground font-mono">{indent.indent_number}</span>
                    <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize", STATUS_COLORS[indent.status] || "bg-muted")}>
                      {indent.status.replace("_", " ")}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {formatDistanceToNow(new Date(indent.requested_at), { addSuffix: true })}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    {viewMode === "my_indents"
                      ? <>→ <span className="font-medium text-foreground">{indent.to_store?.name || "?"}</span></>
                      : <><span className="font-medium text-foreground">{indent.from_store?.name || "?"}</span> requesting</>
                    }
                  </span>
                  {indent.requested_by_user && <span>· {indent.requested_by_user.full_name}</span>}
                  <span>· {format(new Date(indent.requested_at), "dd MMM yyyy")}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {showRaise && selectedStore && (
        <RaiseIndentModal
          hospitalId={hospitalId}
          fromStore={selectedStore}
          onClose={() => setShowRaise(false)}
          onCreated={fetchIndents}
        />
      )}

      {selectedIndentId && (
        <StoreIndentDetailModal
          indentId={selectedIndentId}
          userRole={viewMode === "issue_stock" ? "store_manager" : "requester"}
          onClose={() => setSelectedIndentId(null)}
          onUpdated={fetchIndents}
        />
      )}
    </div>
  );
};

export default WardStorePanel;
