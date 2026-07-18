import React from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { GatedTabsTrigger, GatedAction } from "@/components/access/GatedTabsTrigger";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Loader2, Plus } from "lucide-react";
import PmjayPreAuthTab from "@/components/pmjay/PmjayPreAuthTab";
import PmjayBeneficiariesTab from "@/components/pmjay/PmjayBeneficiariesTab";
import PmjayClaimsTab from "@/components/pmjay/PmjayClaimsTab";
import PmjayPackagesTab from "@/components/pmjay/PmjayPackagesTab";
import PmjayAnalyticsTab from "@/components/pmjay/PmjayAnalyticsTab";
import { useHospitalId } from "@/hooks/useHospitalId";

// Tabs that support an external "+ New" trigger (showNewForm/onFormClosed).
const NEW_FORM_LABEL: Record<string, string> = {
  preauth: "New Pre-Auth",
  beneficiaries: "Register Beneficiary",
};

const PMJAYPage = () => {
  const { hospitalId, loading } = useHospitalId();
  const [activeTab, setActiveTab] = React.useState("preauth");
  const [showNewForm, setShowNewForm] = React.useState(false);

  if (loading || !hospitalId) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );

  const newFormLabel = NEW_FORM_LABEL[activeTab];

  return (
    <div className="container py-6 h-screen max-h-screen overflow-hidden flex flex-col bg-background">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-hms-teal tracking-tight flex items-center gap-2">
            <ShieldCheck className="w-7 h-7" />
            PMJAY & Govt Schemes
          </h1>
          <span className="text-[14px] text-muted-foreground mt-1 block">
            Pre-authorization, cashless claims, beneficiaries, and HBP package catalog
          </span>
        </div>
        {newFormLabel && (
          <GatedAction module="pmjay" action="new_form">
            <Button size="sm" className="gap-1.5" onClick={() => setShowNewForm(true)}>
              <Plus size={14} /> {newFormLabel}
            </Button>
          </GatedAction>
        )}
      </div>

      <Card className="flex-1 p-4 overflow-hidden flex flex-col shadow-sm border-border">
        <Tabs
          value={activeTab}
          onValueChange={(v) => { setActiveTab(v); setShowNewForm(false); }}
          className="w-full flex-1 flex flex-col"
        >
          <TabsList className="w-fit mb-4 grid grid-cols-5 h-auto p-1">
            <GatedTabsTrigger module="pmjay" value="preauth" className="text-[14px] py-2">Pre-Authorization</GatedTabsTrigger>
            <GatedTabsTrigger module="pmjay" value="beneficiaries" className="text-[14px] py-2">Beneficiaries</GatedTabsTrigger>
            <GatedTabsTrigger module="pmjay" value="claims" className="text-[14px] py-2">Cashless Claims</GatedTabsTrigger>
            <GatedTabsTrigger module="pmjay" value="catalog" className="text-[14px] py-2">HBP Catalog</GatedTabsTrigger>
            <GatedTabsTrigger module="pmjay" value="analytics" className="text-[14px] py-2">Analytics</GatedTabsTrigger>
          </TabsList>

          <TabsContent value="preauth" className="flex-1 overflow-hidden m-0">
            <PmjayPreAuthTab showNewForm={showNewForm} onFormClosed={() => setShowNewForm(false)} />
          </TabsContent>

          <TabsContent value="beneficiaries" className="flex-1 overflow-hidden m-0">
            <PmjayBeneficiariesTab showNewForm={showNewForm} onFormClosed={() => setShowNewForm(false)} />
          </TabsContent>

          <TabsContent value="claims" className="flex-1 overflow-auto m-0">
            <PmjayClaimsTab />
          </TabsContent>

          <TabsContent value="catalog" className="flex-1 overflow-auto m-0">
            <PmjayPackagesTab />
          </TabsContent>

          <TabsContent value="analytics" className="flex-1 overflow-auto m-0">
            <PmjayAnalyticsTab />
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
};

export default PMJAYPage;
