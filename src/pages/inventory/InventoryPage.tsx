import React, { useState, useEffect } from "react";
import { Package, ClipboardList, FileText, PackageCheck, Building2, BarChart3, Brain, Warehouse, PieChart } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import StockOverview from "@/components/inventory/StockOverview";
import IndentsPanel from "@/components/inventory/IndentsPanel";
import PurchaseOrdersPanel from "@/components/inventory/PurchaseOrdersPanel";
import GRNPanel from "@/components/inventory/GRNPanel";
import VendorsPanel from "@/components/inventory/VendorsPanel";
import ReportsPanel from "@/components/inventory/ReportsPanel";
import InventoryDemandReview from "@/components/inventory/InventoryDemandReview";
import WardStorePanel from "@/components/inventory/WardStorePanel";
import InventoryMISPanel from "@/components/inventory/InventoryMISPanel";

const navTabs = [
  { id: "stock", label: "Stock Overview", icon: Package },
  { id: "indents", label: "Indents", icon: ClipboardList },
  { id: "ward_store", label: "Ward Store", icon: Warehouse },
  { id: "po", label: "Purchase Orders", icon: FileText },
  { id: "grn", label: "GRN / Receipts", icon: PackageCheck },
  { id: "vendors", label: "Vendors", icon: Building2 },
  { id: "mis", label: "MIS Dashboard", icon: PieChart },
  { id: "reports", label: "Reports", icon: BarChart3 },
];

const InventoryPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState("stock");
  const [showDemandReview, setShowDemandReview] = useState(false);
  const [hospitalId, setHospitalId] = useState("");
  const [kpis, setKpis] = useState({ totalItems: 0, lowStock: 0, expiring: 0, pendingIndents: 0 });

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from("users").select("hospital_id").eq("auth_user_id", user.id).maybeSingle()
        .then(({ data }) => { if (data) setHospitalId(data.hospital_id); });
    });
  }, []);

  useEffect(() => {
    const loadKpis = async () => {
      const [itemsRes, stockRes, indentsRes] = await Promise.all([
        (supabase as any).from("inventory_items").select("id, reorder_level, max_stock_level").eq("is_active", true),
        (supabase as any).from("inventory_stock").select("item_id, quantity_available, expiry_date"),
        (supabase as any).from("department_indents").select("id").eq("status", "pending"),
      ]);

      const items = itemsRes.data || [];
      const stock = stockRes.data || [];
      const totalItems = items.length;

      const stockByItem: Record<string, number> = {};
      let expiringCount = 0;
      stock.forEach((s: any) => {
        stockByItem[s.item_id] = (stockByItem[s.item_id] || 0) + (s.quantity_available || 0);
        if (s.expiry_date) {
          const days = Math.ceil((new Date(s.expiry_date).getTime() - Date.now()) / 86400000);
          if (days <= 30 && days > 0) expiringCount++;
        }
      });

      const lowStock = items.filter((i: any) => {
        const qty = stockByItem[i.id] || 0;
        return qty > 0 && qty <= i.reorder_level;
      }).length;

      setKpis({
        totalItems,
        lowStock,
        expiring: expiringCount,
        pendingIndents: indentsRes.data?.length || 0,
      });
    };
    loadKpis();
  }, [activeTab]);

  const renderContent = () => {
    switch (activeTab) {
      case "stock": return <StockOverview />;
      case "indents": return <IndentsPanel />;
      case "ward_store": return hospitalId ? <WardStorePanel hospitalId={hospitalId} /> : null;
      case "po": return <PurchaseOrdersPanel />;
      case "grn": return <GRNPanel />;
      case "vendors": return <VendorsPanel />;
      case "mis": return hospitalId ? <InventoryMISPanel hospitalId={hospitalId} /> : null;
      case "reports": return <ReportsPanel />;
      default: return <StockOverview />;
    }
  };

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      <div className="h-[52px] flex-shrink-0 bg-card border-b border-border flex items-center justify-between px-5">
        <h1 className="text-base font-bold text-foreground">Inventory & Stores</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium">📦 {kpis.totalItems} Items</span>
          <span className={cn("text-xs px-2.5 py-1 rounded-full font-medium", kpis.lowStock > 0 ? "bg-destructive/10 text-destructive" : "bg-emerald-100 text-emerald-700")}>
            🔴 {kpis.lowStock} Low Stock
          </span>
          <span className={cn("text-xs px-2.5 py-1 rounded-full font-medium", kpis.expiring > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700")}>
            ⚠️ {kpis.expiring} Expiring
          </span>
          <span className="text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground font-medium">📋 {kpis.pendingIndents} Pending</span>
          {hospitalId && (
            <Button size="sm" variant="outline" className="text-xs h-7 gap-1.5" onClick={() => setShowDemandReview(true)}>
              <Brain className="h-3 w-3" /> AI Demand Review
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-[200px] flex-shrink-0 bg-card border-r border-border flex flex-col py-2">
          {navTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-2.5 h-11 px-4 text-xs font-medium transition-colors text-left",
                  activeTab === tab.id
                    ? "bg-primary/10 text-primary border-r-2 border-primary"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                <Icon size={16} className="shrink-0" />
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          {renderContent()}
        </div>
      </div>
      {showDemandReview && hospitalId && (
        <InventoryDemandReview hospitalId={hospitalId} onClose={() => setShowDemandReview(false)} />
      )}
    </div>
  );
};

export default InventoryPage;
