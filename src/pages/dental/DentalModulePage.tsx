import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import ToothChartTab from "@/components/dental/ToothChartTab";
import PeriodontalTab from "@/components/dental/PeriodontalTab";
import TreatmentPlanTab from "@/components/dental/TreatmentPlanTab";
import LabOrdersTab from "@/components/dental/LabOrdersTab";
import { type ChartData } from "@/components/dental/FDIToothChart";
import { Card } from "@/components/ui/card";
import { UserSearch } from "lucide-react";
import { useHospitalId as useHospitalIdHook } from "@/hooks/useHospitalId";
import { supabase } from "@/integrations/supabase/client";

const DentalModulePage = () => {
    const { hospitalId } = useHospitalIdHook();
    const [userId, setUserId] = useState<string | null>(null);
    const [searchParams] = useSearchParams();
    const patientId = searchParams.get("patientId") ?? "";

    React.useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            if (user) setUserId(user.id);
        });
    }, []);

    // State for Tooth Chart Tab maintained at page level to allow saving/syncing
    const [chartData, setChartData] = useState<ChartData>({});
    const [oralHygiene, setOralHygiene] = useState<string>("fair");
    const [calculus, setCalculus] = useState<string>("none");
    const [softTissueNotes, setSoftTissueNotes] = useState<string>("");

    if (!patientId) return (
        <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
            <UserSearch className="h-10 w-10" />
            <p className="text-[14px]">No patient selected. Open this module from a patient's record.</p>
        </div>
    );

    return (
        <div className="container py-6 h-screen max-h-screen overflow-hidden flex flex-col bg-background">
            <div className="flex items-center justify-between mb-4">
                <h1 className="text-2xl font-bold text-hms-teal tracking-tight">Dental Clinic Workspace</h1>
            </div>

            <Card className="flex-1 p-4 overflow-hidden flex flex-col shadow-sm border-border">
                <Tabs defaultValue="fdi-chart" className="w-full flex-1 flex flex-col">
                    <TabsList className="w-fit mb-4 grid grid-cols-4 h-auto p-1">
                        <TabsTrigger value="fdi-chart" className="text-[14px] py-2">FDI Tooth Chart</TabsTrigger>
                        <TabsTrigger value="periodontal" className="text-[14px] py-2">Periodontal Chart</TabsTrigger>
                        <TabsTrigger value="treatment-plan" className="text-[14px] py-2">Treatment Plan</TabsTrigger>
                        <TabsTrigger value="lab-orders" className="text-[14px] py-2">Lab Orders</TabsTrigger>
                    </TabsList>

                    <TabsContent value="fdi-chart" className="flex-1 overflow-hidden m-0">
                        <ToothChartTab
                            patientId={patientId}
                            hospitalId={hospitalId || ""}
                            userId={userId}
                            chartId={null}
                            chartData={chartData}
                            setChartData={setChartData}
                            oralHygiene={oralHygiene}
                            setOralHygiene={setOralHygiene}
                            calculus={calculus}
                            setCalculus={setCalculus}
                            softTissueNotes={softTissueNotes}
                            setSoftTissueNotes={setSoftTissueNotes}
                        />
                    </TabsContent>

                    <TabsContent value="periodontal" className="flex-1 overflow-hidden m-0">
                        <PeriodontalTab
                            patientId={patientId}
                            hospitalId={hospitalId || ""}
                            userId={userId}
                        />
                    </TabsContent>

                    <TabsContent value="treatment-plan" className="flex-1 overflow-hidden m-0">
                        <TreatmentPlanTab
                            patientId={patientId}
                            hospitalId={hospitalId || ""}
                            userId={userId}
                        />
                    </TabsContent>

                    <TabsContent value="lab-orders" className="flex-1 overflow-auto m-0">
                        <LabOrdersTab patientId={patientId} hospitalId={hospitalId || ""} userId={userId} />
                    </TabsContent>
                </Tabs>
            </Card>
        </div>
    );
};

export default DentalModulePage;