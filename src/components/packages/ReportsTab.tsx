import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Download, Search, CheckCircle2, User, Activity, HeartPulse, Send, Printer } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

interface ReportsTabProps {
    hospitalId: string;
    userId: string | null;
}

interface CompletedCheckup {
    id: string;
    patientName: string;
    patientId: string;
    packageName: string;
    completionDate: string;
    corporate?: string;
    reportStatus: "pending" | "generated" | "sent";
    summary: {
        vitals: { bp: string; hr: string; bmi: string };
        labAlerts: number;
        physicianRemarks: string;
    };
}

// Mock Data for completed pipeline packages
const COMPLETED_CHECKUPS: CompletedCheckup[] = [
    {
        id: "BKG-001",
        patientName: "Aarav Sharma",
        patientId: "PT-1001",
        packageName: "Executive Male Checkup",
        completionDate: new Date().toISOString().split("T")[0],
        reportStatus: "pending",
        summary: {
            vitals: { bp: "120/80", hr: "72", bmi: "24.5" },
            labAlerts: 1,
            physicianRemarks: "Overall healthy. Mild Vitamin D deficiency. Suggested supplements and 30 mins daily walk.",
        },
    },
    {
        id: "BKG-003",
        patientName: "Rohan Gupta",
        patientId: "PT-1003",
        packageName: "Corporate Annual (TCS)",
        corporate: "TCS",
        completionDate: new Date().toISOString().split("T")[0],
        reportStatus: "generated",
        summary: {
            vitals: { bp: "135/85", hr: "78", bmi: "27.1" },
            labAlerts: 3,
            physicianRemarks: "Elevated lipid profile. Advised dietary modifications and follow-up lipid panel in 3 months.",
        },
    },
];

const ReportsTab: React.FC<ReportsTabProps> = ({ hospitalId, userId }) => {
    const { toast } = useToast();
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [generating, setGenerating] = useState(false);

    const filteredCheckups = COMPLETED_CHECKUPS.filter(
        (c) =>
            c.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            c.patientId.toLowerCase().includes(searchTerm.toLowerCase()) ||
            c.packageName.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const selectedCheckup = COMPLETED_CHECKUPS.find((c) => c.id === selectedId);

    const handleGeneratePDF = () => {
        setGenerating(true);
        // Simulate PDF compilation time
        setTimeout(() => {
            setGenerating(false);
            toast({
                title: "Report Generated",
                description: "Consolidated Health Checkup PDF has been compiled successfully.",
            });
            // In the real app, this would use src/lib/printUtils.ts -> printDocument()
        }, 1500);
    };

    const handleSendWhatsApp = () => {
        toast({
            title: "Dispatched via WhatsApp",
            description: `Report link sent securely to ${selectedCheckup?.patientName}'s registered mobile number.`,
        });
    };

    return (
        <div className="flex h-full gap-6">
            {/* Left Pane: List of Completed Checkups */}
            <div className="w-1/3 border rounded-lg bg-card h-full flex flex-col shadow-sm">
                <div className="p-3 border-b bg-muted/30">
                    <h3 className="font-semibold text-[15px] mb-3 flex items-center">
                        <CheckCircle2 className="w-4 h-4 mr-2 text-emerald-600" />
                        Completed Checkups
                    </h3>
                    <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
                        <Input
                            placeholder="Search patient, ID, or package..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-9 h-9 text-[14px]"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {filteredCheckups.length === 0 ? (
                        <div className="text-center text-muted-foreground text-[13px] mt-10">No completed checkups found.</div>
                    ) : (
                        filteredCheckups.map((checkup) => (
                            <div
                                key={checkup.id}
                                onClick={() => setSelectedId(checkup.id)}
                                className={`p-3 rounded-md border cursor-pointer transition-all ${selectedId === checkup.id ? "bg-primary/5 border-primary shadow-sm" : "hover:bg-muted/50"
                                    }`}
                            >
                                <div className="flex justify-between items-start mb-1">
                                    <h4 className="text-[14px] font-bold text-foreground">{checkup.patientName}</h4>
                                    {checkup.reportStatus === "pending" ? (
                                        <Badge variant="outline" className="text-[10px] text-amber-600 bg-amber-50 border-amber-200">
                                            Pending
                                        </Badge>
                                    ) : (
                                        <Badge variant="outline" className="text-[10px] text-emerald-600 bg-emerald-50 border-emerald-200">
                                            {checkup.reportStatus === "sent" ? "Sent" : "Ready"}
                                        </Badge>
                                    )}
                                </div>
                                <p className="text-[12px] text-muted-foreground font-mono mb-1">{checkup.patientId}</p>
                                <p className="text-[12px] text-foreground line-clamp-1">{checkup.packageName}</p>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Right Pane: Report Preview and Actions */}
            <div className="w-2/3 border rounded-lg bg-muted/10 h-full flex flex-col shadow-sm">
                <div className="p-3 border-b bg-card flex justify-between items-center">
                    <h3 className="font-semibold text-[15px] flex items-center">
                        <FileText className="w-4 h-4 mr-2 text-hms-teal" />
                        Consolidated Report Preview
                    </h3>
                    {selectedCheckup && (
                        <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={handleSendWhatsApp}>
                                <Send className="w-4 h-4 mr-2" /> WhatsApp
                            </Button>
                            <Button size="sm" onClick={handleGeneratePDF} disabled={generating}>
                                {generating ? "Generating..." : <><Printer className="w-4 h-4 mr-2" /> Export PDF</>}
                            </Button>
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto p-4 flex justify-center bg-slate-50/50">
                    {!selectedCheckup ? (
                        <div className="flex flex-col items-center justify-center text-muted-foreground h-full opacity-60">
                            <FileText className="w-16 h-16 mb-4" />
                            <p className="text-[14px]">Select a completed checkup to preview and generate the report.</p>
                        </div>
                    ) : (
                        <div className="bg-white border shadow-md w-full max-w-2xl p-8 rounded-sm">
                            {/* Mock PDF Document Layout */}
                            <div className="border-b-2 border-hms-teal pb-4 mb-6 flex justify-between items-end">
                                <div>
                                    <h1 className="text-2xl font-bold text-hms-teal">Aumrti Executive Health Report</h1>
                                    <p className="text-sm text-muted-foreground mt-1">Generated: {selectedCheckup.completionDate}</p>
                                </div>
                                <div className="text-right">
                                    <h2 className="text-lg font-bold">{selectedCheckup.patientName}</h2>
                                    <p className="text-sm font-mono text-muted-foreground">ID: {selectedCheckup.patientId}</p>
                                </div>
                            </div>

                            <div className="space-y-6">
                                <section>
                                    <h3 className="text-lg font-semibold border-b pb-1 mb-3 flex items-center"><Activity className="w-4 h-4 mr-2" /> Clinical Vitals</h3>
                                    <div className="grid grid-cols-3 gap-4">
                                        <div className="bg-slate-50 p-3 rounded"><p className="text-xs text-muted-foreground uppercase">Blood Pressure</p><p className="font-bold text-lg">{selectedCheckup.summary.vitals.bp}</p></div>
                                        <div className="bg-slate-50 p-3 rounded"><p className="text-xs text-muted-foreground uppercase">Heart Rate</p><p className="font-bold text-lg">{selectedCheckup.summary.vitals.hr} bpm</p></div>
                                        <div className="bg-slate-50 p-3 rounded"><p className="text-xs text-muted-foreground uppercase">BMI</p><p className="font-bold text-lg">{selectedCheckup.summary.vitals.bmi}</p></div>
                                    </div>
                                </section>

                                <section>
                                    <h3 className="text-lg font-semibold border-b pb-1 mb-3 flex items-center"><HeartPulse className="w-4 h-4 mr-2" /> Laboratory Highlights</h3>
                                    <p className="text-sm">
                                        {selectedCheckup.summary.labAlerts > 0
                                            ? <span className="text-red-600 font-medium">⚠️ {selectedCheckup.summary.labAlerts} parameters out of normal range. Refer to the attached detailed LIS report.</span>
                                            : <span className="text-emerald-600 font-medium">✅ All tested parameters are within normal biological reference ranges.</span>
                                        }
                                    </p>
                                </section>

                                <section>
                                    <h3 className="text-lg font-semibold border-b pb-1 mb-3 flex items-center"><User className="w-4 h-4 mr-2" /> Physician's Remarks</h3>
                                    <p className="text-sm leading-relaxed">{selectedCheckup.summary.physicianRemarks}</p>
                                </section>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ReportsTab;