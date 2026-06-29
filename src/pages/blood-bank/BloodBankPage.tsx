import React, { useState, useEffect } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Package, Droplets, Microscope, User, ClipboardList, BarChart3, UserPlus, FileText, FlaskConical, Megaphone, Loader2 } from "lucide-react";
import { formatBloodGroup } from "@/lib/bloodCompatibility";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import InventoryTab from "@/components/blood-bank/InventoryTab";
import RequestsTab from "@/components/blood-bank/RequestsTab";
import CrossMatchTab from "@/components/blood-bank/CrossMatchTab";
import DonorsTab from "@/components/blood-bank/DonorsTab";
import IssueLogTab from "@/components/blood-bank/IssueLogTab";
import ReportsTab from "@/components/blood-bank/ReportsTab";
import TTITestingTab from "@/components/blood-bank/TTITestingTab";

const BLOOD_GROUPS = ['A', 'B', 'AB', 'O'] as const;
const RH_FACTORS = ['positive', 'negative'] as const;

interface GroupCount { group: string; rh: string; count: number }

const BloodBankPage: React.FC = () => {
  const [tab, setTab] = useState("inventory");
  const [groupCounts, setGroupCounts] = useState<GroupCount[]>([]);
  const [showDonorModal, setShowDonorModal] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [campaignLoading, setCampaignLoading] = useState(false);
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();

  const fetchCounts = async () => {
    const { data } = await supabase
      .from("blood_units")
      .select("blood_group, rh_factor")
      .eq("status", "available")
      .eq("component", "rbc");

    if (data) {
      const counts: GroupCount[] = [];
      for (const g of BLOOD_GROUPS) {
        for (const r of RH_FACTORS) {
          counts.push({
            group: g,
            rh: r,
            count: data.filter((d: any) => d.blood_group === g && d.rh_factor === r).length,
          });
        }
      }
      setGroupCounts(counts);
    }
  };

  useEffect(() => { fetchCounts(); }, []);

  const getPillStyle = (count: number) => {
    if (count < 2) return "bg-red-100 text-red-700 border-red-200";
    if (count < 5) return "bg-amber-100 text-amber-700 border-amber-200";
    return "bg-green-100 text-green-700 border-green-200";
  };

  const hasLowStock = groupCounts.some((gc) => gc.count < 2);

  const runDonorCampaign = async () => {
    if (!hospitalId) return;
    setCampaignLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("donor-reengagement", {
        body: { hospital_id: hospitalId },
      });
      if (error) throw error;
      if (data.status === "no_action") {
        toast({ title: "No campaign needed", description: "All blood groups are adequately stocked." });
      } else if (!data.hospital_whatsapp_configured) {
        toast({
          title: `Campaign logged — WhatsApp not configured`,
          description: `Found ${data.eligible_donors_found} eligible donor(s) for ${data.low_groups.join(", ")} — configure WhatsApp in Settings to send messages.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: `Campaign sent ✓`,
          description: `${data.messages_sent} message(s) sent to donors for ${data.low_groups.join(", ")}.`,
        });
      }
    } catch (e: any) {
      toast({ title: "Campaign failed", description: e?.message || "Unknown error", variant: "destructive" });
    } finally {
      setCampaignLoading(false);
    }
  };

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      {/* Header */}
      <div className="h-[52px] bg-background border-b border-border px-5 flex items-center justify-between shrink-0">
        <span className="text-base font-bold text-foreground">🩸 Blood Bank</span>
        <div className="flex items-center gap-1.5">
          {groupCounts.map((gc) => (
            <span
              key={gc.group + gc.rh}
              className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${getPillStyle(gc.count)}`}
            >
              {formatBloodGroup(gc.group, gc.rh)}: {gc.count}
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={hasLowStock ? "destructive" : "outline"}
            onClick={runDonorCampaign}
            disabled={campaignLoading}
            title="Send WhatsApp re-engagement to eligible donors for low-stock blood groups"
          >
            {campaignLoading
              ? <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              : <Megaphone className="w-4 h-4 mr-1" />}
            {hasLowStock ? "📣 Low Stock Campaign" : "Donor Campaign"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setShowDonorModal(true); setTab("donors"); }}>
            <UserPlus className="w-4 h-4 mr-1" /> Register Donor
          </Button>
          <Button size="sm" onClick={() => { setShowRequestModal(true); setTab("requests"); }}>
            <FileText className="w-4 h-4 mr-1" /> Blood Request
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="h-11 w-full justify-start rounded-none border-b border-border bg-muted/30 px-4 shrink-0">
          <TabsTrigger value="inventory" className="gap-1.5"><Package className="w-4 h-4" /> Inventory</TabsTrigger>
          <TabsTrigger value="requests" className="gap-1.5"><Droplets className="w-4 h-4" /> Requests</TabsTrigger>
          <TabsTrigger value="crossmatch" className="gap-1.5"><Microscope className="w-4 h-4" /> Cross-Match</TabsTrigger>
          <TabsTrigger value="donors" className="gap-1.5"><User className="w-4 h-4" /> Donors</TabsTrigger>
          <TabsTrigger value="issuelog" className="gap-1.5"><ClipboardList className="w-4 h-4" /> Issue Log</TabsTrigger>
          <TabsTrigger value="tti" className="gap-1.5"><FlaskConical className="w-4 h-4" /> TTI Testing</TabsTrigger>
          <TabsTrigger value="reports" className="gap-1.5"><BarChart3 className="w-4 h-4" /> Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="inventory" className="flex-1 overflow-hidden m-0">
          <InventoryTab onRefresh={fetchCounts} />
        </TabsContent>
        <TabsContent value="requests" className="flex-1 overflow-hidden m-0">
          <RequestsTab showModal={showRequestModal} onCloseModal={() => setShowRequestModal(false)} onRefresh={fetchCounts} />
        </TabsContent>
        <TabsContent value="crossmatch" className="flex-1 overflow-hidden m-0">
          <CrossMatchTab onRefresh={fetchCounts} />
        </TabsContent>
        <TabsContent value="donors" className="flex-1 overflow-hidden m-0">
          <DonorsTab showModal={showDonorModal} onCloseModal={() => setShowDonorModal(false)} />
        </TabsContent>
        <TabsContent value="issuelog" className="flex-1 overflow-hidden m-0">
          <IssueLogTab />
        </TabsContent>
        <TabsContent value="tti" className="flex-1 overflow-y-auto m-0">
          <TTITestingTab />
        </TabsContent>
        <TabsContent value="reports" className="flex-1 overflow-hidden m-0">
          <ReportsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default BloodBankPage;
