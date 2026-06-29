import React from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { ShieldCheck, Loader2 } from "lucide-react";
import PreAuthTab from "@/components/pmjay/PreAuthTab";
import PmjayClaimsTab from "@/components/pmjay/PmjayClaimsTab";
import PmjayPackagesTab from "@/components/pmjay/PmjayPackagesTab";
import { useHospitalId } from "@/hooks/useHospitalId";
import { supabase } from "@/integrations/supabase/client";

const PMJAYPage = () => {
  const { hospitalId, loading } = useHospitalId();
  const [userId, setUserId] = React.useState<string | null>(null);

  React.useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
  }, []);

  if (loading || !hospitalId) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );

  return (
    <div className="container py-6 h-screen max-h-screen overflow-hidden flex flex-col bg-background">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-hms-teal tracking-tight flex items-center gap-2">
            <ShieldCheck className="w-7 h-7" />
            PMJAY & Govt Schemes
          </h1>
          <span className="text-[14px] text-muted-foreground mt-1 block">
            Pre-authorization, cashless claims, and HBP package catalog
          </span>
        </div>
      </div>

      <Card className="flex-1 p-4 overflow-hidden flex flex-col shadow-sm border-border">
        <Tabs defaultValue="preauth" className="w-full flex-1 flex flex-col">
          <TabsList className="w-fit mb-4 grid grid-cols-3 h-auto p-1">
            <TabsTrigger value="preauth" className="text-[14px] py-2">Auto Pre-Authorization</TabsTrigger>
            <TabsTrigger value="claims" className="text-[14px] py-2">Cashless Claims</TabsTrigger>
            <TabsTrigger value="catalog" className="text-[14px] py-2">HBP Catalog</TabsTrigger>
          </TabsList>

          <TabsContent value="preauth" className="flex-1 overflow-hidden m-0">
            <PreAuthTab patientId="" hospitalId={hospitalId} userId={userId} />
          </TabsContent>

          <TabsContent value="claims" className="flex-1 overflow-auto m-0">
            <PmjayClaimsTab />
          </TabsContent>

          <TabsContent value="catalog" className="flex-1 overflow-auto m-0">
            <PmjayPackagesTab />
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
};

export default PMJAYPage;
