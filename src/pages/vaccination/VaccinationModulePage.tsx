import React, { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import ImmunizationScheduleTab from "@/components/vaccination/ImmunizationScheduleTab";
import CampsTab from "@/components/vaccination/CampsTab";
import ColdChainTab from "@/components/vaccination/ColdChainTab";
import AEFIReportingTab from "@/components/vaccination/AEFIReportingTab";
import { useHospitalId } from "@/hooks/useHospitalId";
import { supabase } from "@/integrations/supabase/client";

const VaccinationModulePage = () => {
    const { hospitalId, loading } = useHospitalId();
    const [userId, setUserId] = useState<string | null>(null);

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
                    <h1 className="text-2xl font-bold text-hms-teal tracking-tight">Vaccination & Immunization</h1>
                    <span className="text-[14px] text-muted-foreground mt-1 block">
                        National Immunization Schedule, Camp Mode, Cold Chain & AEFI
                    </span>
                </div>
            </div>

            <Card className="flex-1 p-4 overflow-hidden flex flex-col shadow-sm border-border">
                <Tabs defaultValue="schedule" className="w-full flex-1 flex flex-col">
                    <TabsList className="w-fit mb-4 grid grid-cols-4 h-auto p-1">
                        <TabsTrigger value="schedule" className="text-[14px] py-2">NIS Schedule</TabsTrigger>
                        <TabsTrigger value="camp" className="text-[14px] py-2">Camp Mode</TabsTrigger>
                        <TabsTrigger value="cold-chain" className="text-[14px] py-2">Cold Chain</TabsTrigger>
                        <TabsTrigger value="aefi" className="text-[14px] py-2">AEFI Reporting</TabsTrigger>
                    </TabsList>

                    <TabsContent value="schedule" className="flex-1 overflow-hidden m-0">
                        <ImmunizationScheduleTab patientId="" dob="" hospitalId={hospitalId} userId={userId || ""} />
                    </TabsContent>

                    <TabsContent value="camp" className="flex-1 overflow-auto m-0">
                        <CampsTab hospitalId={hospitalId} />
                    </TabsContent>

                    <TabsContent value="cold-chain" className="flex-1 overflow-auto m-0">
                        <ColdChainTab hospitalId={hospitalId} onLogged={() => {}} />
                    </TabsContent>

                    <TabsContent value="aefi" className="flex-1 overflow-auto m-0">
                        <AEFIReportingTab hospitalId={hospitalId} />
                    </TabsContent>
                </Tabs>
            </Card>
        </div>
    );
};

export default VaccinationModulePage;
