import React, { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { ActivitySquare, HeartPulse, Loader2 } from "lucide-react";
import PipelineTab from "@/components/packages/PipelineTab";
import ReportsTab from "@/components/packages/ReportsTab";
import PackageCatalogueTab from "@/components/packages/PackageCatalogueTab";
import CorporateTab from "@/components/packages/CorporateTab";
import { useHospitalId } from "@/hooks/useHospitalId";
import { supabase } from "@/integrations/supabase/client";

const HealthPackagesPage = () => {
    const { hospitalId, loading } = useHospitalId();
    const [userId, setUserId] = useState<string | null>(null);

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            if (user) setUserId(user.id);
        });
    }, []);

    if (loading) return (
        <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
    );

    return (
        <div className="container py-6 h-screen max-h-screen overflow-hidden flex flex-col bg-background">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h1 className="text-2xl font-bold text-hms-teal tracking-tight flex items-center gap-2">
                        <HeartPulse className="w-7 h-7" />
                        Health Packages & Checkups
                    </h1>
                    <span className="text-[14px] text-muted-foreground mt-1 block">
                        Live patient routing and executive checkup pipeline
                    </span>
                </div>
            </div>

            <Card className="flex-1 p-4 overflow-hidden flex flex-col shadow-sm border-border">
                <Tabs defaultValue="pipeline" className="w-full flex-1 flex flex-col">
                    <TabsList className="w-fit mb-4 grid grid-cols-4 h-auto p-1">
                        <TabsTrigger value="pipeline" className="text-[14px] py-2 flex items-center gap-2">
                            <ActivitySquare className="w-4 h-4" /> Live Pipeline
                        </TabsTrigger>
                        <TabsTrigger value="catalog" className="text-[14px] py-2">Package Catalog</TabsTrigger>
                        <TabsTrigger value="corporate" className="text-[14px] py-2">Corporate Bulk</TabsTrigger>
                        <TabsTrigger value="reports" className="text-[14px] py-2">Consolidated Reports</TabsTrigger>
                    </TabsList>

                    <TabsContent value="pipeline" className="flex-1 overflow-hidden m-0">
                        <PipelineTab hospitalId={hospitalId || ""} userId={userId} />
                    </TabsContent>

                    <TabsContent value="catalog" className="flex-1 overflow-auto m-0">
                        <PackageCatalogueTab onBook={() => {}} onCreate={() => {}} />
                    </TabsContent>

                    <TabsContent value="corporate" className="flex-1 overflow-auto m-0">
                        <CorporateTab />
                    </TabsContent>

                    <TabsContent value="reports" className="flex-1 overflow-auto m-0">
                        <ReportsTab hospitalId={hospitalId || ""} userId={userId} />
                    </TabsContent>
                </Tabs>
            </Card>
        </div>
    );
};

export default HealthPackagesPage;
