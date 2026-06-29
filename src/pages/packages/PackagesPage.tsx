import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { toast } from "sonner";
import { CalendarCheck, Activity, CheckCircle2, IndianRupee, Plus, Loader2, ExternalLink } from "lucide-react";
import PackageCatalogueTab from "@/components/packages/PackageCatalogueTab";
import TodaysCheckupsTab from "@/components/packages/TodaysCheckupsTab";
import ProgressTrackerTab from "@/components/packages/ProgressTrackerTab";
import CorporateTab from "@/components/packages/CorporateTab";
import PackageAnalyticsTab from "@/components/packages/PackageAnalyticsTab";
import BookPackageModal from "@/components/packages/BookPackageModal";
import CreatePackageModal from "@/components/packages/CreatePackageModal";

export default function PackagesPage() {
  const { hospitalId, loading: hospitalLoading } = useHospitalId();
  const [tab, setTab] = useState("checkups");
  const [showBook, setShowBook] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [kpis, setKpis] = useState({ booked: 0, inProgress: 0, completed: 0, revenue: 0 });

  const loadKPIs = async () => {
    const today = new Date().toISOString().split("T")[0];
    const [booked, inProgress, completed] = await Promise.all([
      supabase.from("package_bookings").select("id", { count: "exact", head: true })
        .eq("hospital_id", hospitalId).eq("scheduled_date", today),
      supabase.from("package_bookings").select("id", { count: "exact", head: true })
        .eq("hospital_id", hospitalId).eq("status", "in_progress"),
      supabase.from("package_bookings").select("id", { count: "exact", head: true })
        .eq("hospital_id", hospitalId).eq("status", "completed").gte("completed_at", today + "T00:00:00"),
    ]);
    setKpis({
      booked: booked.count || 0,
      inProgress: inProgress.count || 0,
      completed: completed.count || 0,
      revenue: 0,
    });
  };

  useEffect(() => { loadKPIs(); }, []);

  const kpiCards = [
    { label: "Booked Today", value: kpis.booked, icon: CalendarCheck, color: "text-blue-600" },
    { label: "In Progress", value: kpis.inProgress, icon: Activity, color: "text-amber-600" },
    { label: "Completed Today", value: kpis.completed, icon: CheckCircle2, color: "text-emerald-600" },
    { label: "Revenue Today", value: `₹${kpis.revenue.toLocaleString("en-IN")}`, icon: IndianRupee, color: "text-primary" },
  ];

  if (hospitalLoading || !hospitalId) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  return (
    <div className="flex flex-col h-[calc(100vh-56px)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-[52px] border-b bg-background shrink-0">
        <h1 className="text-base font-bold">📋 Health Packages & Checkups</h1>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => window.open("/packages/book", "_blank")}>
            <ExternalLink className="h-4 w-4 mr-1" /> Patient Booking Link
          </Button>
          <Button size="sm" onClick={() => setShowBook(true)}>
            <Plus className="h-4 w-4 mr-1" /> Book Package
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" /> Create Package
          </Button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-3 px-4 py-2 shrink-0">
        {kpiCards.map((k) => (
          <Card key={k.label} className="p-0">
            <CardContent className="flex items-center gap-3 p-3">
              <k.icon className={`h-8 w-8 ${k.color}`} />
              <div>
                <p className="text-xs text-muted-foreground">{k.label}</p>
                <p className="text-lg font-bold">{k.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden px-4">
        <TabsList className="shrink-0 w-fit">
          <TabsTrigger value="catalogue">📦 Packages</TabsTrigger>
          <TabsTrigger value="checkups">📅 Today's Checkups</TabsTrigger>
          <TabsTrigger value="progress">📊 Progress Tracker</TabsTrigger>
          <TabsTrigger value="corporate">🏢 Corporate</TabsTrigger>
          <TabsTrigger value="analytics">📈 Analytics</TabsTrigger>
        </TabsList>
        <TabsContent value="catalogue" className="flex-1 overflow-auto mt-2">
          <PackageCatalogueTab onBook={() => setShowBook(true)} onCreate={() => setShowCreate(true)} />
        </TabsContent>
        <TabsContent value="checkups" className="flex-1 overflow-auto mt-2">
          <TodaysCheckupsTab onRefreshKPIs={loadKPIs} />
        </TabsContent>
        <TabsContent value="progress" className="flex-1 overflow-auto mt-2">
          <ProgressTrackerTab />
        </TabsContent>
        <TabsContent value="corporate" className="flex-1 overflow-auto mt-2">
          <CorporateTab />
        </TabsContent>
        <TabsContent value="analytics" className="flex-1 overflow-auto mt-2">
          <PackageAnalyticsTab />
        </TabsContent>
      </Tabs>

      {showBook && <BookPackageModal open={showBook} onClose={() => { setShowBook(false); loadKPIs(); }} />}
      {showCreate && <CreatePackageModal open={showCreate} onClose={() => setShowCreate(false)} />}
    </div>
  );
}
