import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, Clock, Syringe, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { autoPostJournalEntry } from "@/lib/accounting";
import { recalculateBillTotalsSafe } from "@/lib/billTotals";
import { useToast } from "@/hooks/use-toast";

interface Vaccine {
    id: string;
    name: string;
    type: string;
    status: "pending" | "given" | "overdue";
    dueDate?: string;
    givenDate?: string;
}

interface ScheduleGroup {
    ageGroup: string;
    vaccines: Vaccine[];
}

interface ImmunizationScheduleTabProps {
    patientId: string;
    dob: string;
    hospitalId: string;
    userId: string;
}

// Mock National Immunization Schedule (NIS) Data
const INITIAL_SCHEDULE: ScheduleGroup[] = [
    {
        ageGroup: "At Birth",
        vaccines: [
            { id: "v1", name: "BCG", type: "Intradermal", status: "given", givenDate: "2026-06-16" },
            { id: "v2", name: "OPV 0", type: "Oral", status: "given", givenDate: "2026-06-16" },
            { id: "v3", name: "Hepatitis B (Birth Dose)", type: "Intramuscular", status: "given", givenDate: "2026-06-16" },
        ],
    },
    {
        ageGroup: "6 Weeks",
        vaccines: [
            { id: "v4", name: "OPV 1", type: "Oral", status: "overdue", dueDate: "2026-07-27" },
            { id: "v5", name: "Pentavalent 1", type: "Intramuscular", status: "overdue", dueDate: "2026-07-27" },
            { id: "v6", name: "Rotavirus 1", type: "Oral", status: "overdue", dueDate: "2026-07-27" },
            { id: "v7", name: "fIPV 1", type: "Intradermal", status: "overdue", dueDate: "2026-07-27" },
            { id: "v8", name: "PCV 1", type: "Intramuscular", status: "overdue", dueDate: "2026-07-27" },
        ],
    },
    {
        ageGroup: "10 Weeks",
        vaccines: [
            { id: "v9", name: "OPV 2", type: "Oral", status: "pending", dueDate: "2026-08-24" },
            { id: "v10", name: "Pentavalent 2", type: "Intramuscular", status: "pending", dueDate: "2026-08-24" },
            { id: "v11", name: "Rotavirus 2", type: "Oral", status: "pending", dueDate: "2026-08-24" },
        ],
    },
    {
        ageGroup: "14 Weeks",
        vaccines: [
            { id: "v12", name: "OPV 3", type: "Oral", status: "pending", dueDate: "2026-09-21" },
            { id: "v13", name: "Pentavalent 3", type: "Intramuscular", status: "pending", dueDate: "2026-09-21" },
            { id: "v14", name: "fIPV 2", type: "Intradermal", status: "pending", dueDate: "2026-09-21" },
            { id: "v15", name: "Rotavirus 3", type: "Oral", status: "pending", dueDate: "2026-09-21" },
            { id: "v16", name: "PCV 2", type: "Intramuscular", status: "pending", dueDate: "2026-09-21" },
        ],
    },
    {
        ageGroup: "9-12 Months",
        vaccines: [
            { id: "v17", name: "Measles & Rubella (MR) 1", type: "Subcutaneous", status: "pending", dueDate: "2027-03-15" },
            { id: "v18", name: "JE 1", type: "Subcutaneous", status: "pending", dueDate: "2027-03-15" },
            { id: "v19", name: "PCV Booster", type: "Intramuscular", status: "pending", dueDate: "2027-03-15" },
        ],
    },
];

const ImmunizationScheduleTab: React.FC<ImmunizationScheduleTabProps> = ({ patientId, dob, hospitalId, userId }) => {
    const { toast } = useToast();
    const [schedule, setSchedule] = useState<ScheduleGroup[]>(INITIAL_SCHEDULE);
    const [selectedVaccine, setSelectedVaccine] = useState<Vaccine | null>(null);

    // Admin Form State
    const [batchNo, setBatchNo] = useState("");
    const [brandName, setBrandName] = useState("");
    const [site, setSite] = useState("");
    const [cost, setCost] = useState("");
    const [saving, setSaving] = useState(false);

    const handleSelectVaccine = (vaccine: Vaccine) => {
        setSelectedVaccine(vaccine);
        setBatchNo("");
        setBrandName("");
        setSite("");
        setCost("");
    };

    const handleAdminister = async () => {
        if (!selectedVaccine) return;

        setSaving(true);
        const costNum = Number(cost) || 0;

        if (costNum > 0) {
            try {
                const today = new Date().toISOString().split("T")[0];
                const billNum = await generateBillNumber(hospitalId, "VACC");

                const { data: newBill, error: billErr } = await supabase.from("bills").insert({
                    hospital_id: hospitalId,
                    patient_id: patientId,
                    bill_number: billNum,
                    bill_type: "opd",
                    bill_date: today,
                    bill_status: "final",
                    payment_status: "unpaid",
                    total_amount: costNum,
                    balance_due: costNum,
                    subtotal: costNum,
                    gst_amount: 0,
                    taxable_amount: costNum,
                    patient_payable: costNum,
                }).select("id").maybeSingle();

                if (billErr || !newBill) throw billErr || new Error("Failed to create bill");

                await supabase.from("bill_line_items").insert({
                    hospital_id: hospitalId,
                    bill_id: newBill.id,
                    item_type: "vaccine",
                    description: `Vaccine: ${selectedVaccine.name} (Batch: ${batchNo})`,
                    quantity: 1,
                    unit_rate: costNum,
                    taxable_amount: costNum,
                    gst_percent: 0,
                    gst_amount: 0,
                    total_amount: costNum,
                    source_module: "vaccination"
                });

                await recalculateBillTotalsSafe(newBill.id);

                await autoPostJournalEntry({
                    triggerEvent: "bill_finalized_vaccination",
                    sourceModule: "vaccination",
                    sourceId: newBill.id,
                    amount: costNum,
                    description: `Vaccination Revenue - ${selectedVaccine.name}`,
                    hospitalId,
                    postedBy: userId || "",
                });

                toast({ title: `Vaccine administered & ₹${costNum.toLocaleString("en-IN")} billed to patient` });
            } catch (err: any) {
                toast({ title: "Billing Failed", description: err.message, variant: "destructive" });
                setSaving(false);
                return; // Stop the flow so they can retry
            }
        } else {
            toast({ title: "Vaccine administered successfully" });
        }

        const updatedSchedule = schedule.map((group) => ({
            ...group,
            vaccines: group.vaccines.map((v) =>
                v.id === selectedVaccine.id
                    ? { ...v, status: "given" as const, givenDate: new Date().toISOString().split("T")[0] }
                    : v
            ),
        }));

        setSchedule(updatedSchedule);
        setSelectedVaccine(null);
        setSaving(false);
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case "given": return <CheckCircle2 className="text-emerald-500 w-5 h-5" />;
            case "overdue": return <Clock className="text-destructive w-5 h-5" />;
            default: return <Circle className="text-muted-foreground/50 w-5 h-5" />;
        }
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case "given": return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-none font-medium">Given</Badge>;
            case "overdue": return <Badge variant="destructive" className="font-medium">Overdue</Badge>;
            default: return <Badge variant="outline" className="text-muted-foreground font-medium">Due</Badge>;
        }
    };

    return (
        <div className="flex h-full gap-6">
            {/* Left Pane: NIS Timeline (Scrollable) */}
            <div className="w-2/3 border rounded-lg bg-card overflow-y-auto relative h-full flex flex-col shadow-sm">
                <div className="sticky top-0 bg-muted/50 p-3 border-b backdrop-blur-sm z-10">
                    <h3 className="font-semibold text-[15px] flex items-center">
                        <Syringe className="w-4 h-4 mr-2 text-hms-teal" />
                        National Immunization Schedule (NIS)
                    </h3>
                </div>

                <div className="p-4 space-y-6">
                    {schedule.map((group, gIdx) => (
                        <div key={gIdx} className="relative">
                            <h4 className="text-[14px] font-bold text-foreground mb-3 sticky top-12 bg-card py-1 z-10">{group.ageGroup}</h4>
                            <div className="space-y-2 pl-2">
                                {group.vaccines.map((vaccine) => (
                                    <div
                                        key={vaccine.id}
                                        onClick={() => vaccine.status !== "given" && handleSelectVaccine(vaccine)}
                                        className={`flex items-center justify-between p-3 rounded-md border transition-all duration-200 ${vaccine.status === "given"
                                            ? "bg-muted/30 border-muted opacity-70 cursor-default"
                                            : selectedVaccine?.id === vaccine.id
                                                ? "bg-primary/5 border-primary shadow-sm cursor-pointer"
                                                : "bg-background hover:bg-accent cursor-pointer"
                                            }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            {getStatusIcon(vaccine.status)}
                                            <div>
                                                <p className="text-[14px] font-medium text-foreground">{vaccine.name}</p>
                                                <p className="text-[12px] text-muted-foreground">Route: {vaccine.type}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <span className="text-[13px] font-mono text-muted-foreground">
                                                {vaccine.status === "given" ? `Given: ${vaccine.givenDate}` : `Due: ${vaccine.dueDate}`}
                                            </span>
                                            <div className="w-20 text-right">{getStatusBadge(vaccine.status)}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {/* Timeline Connector Line */}
                            {gIdx !== schedule.length - 1 && (
                                <div className="absolute left-6 top-10 bottom-[-24px] w-0.5 bg-border/50" />
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Right Pane: Administration Form (Fixed) */}
            <div className="w-1/3 border rounded-lg bg-muted/10 h-full flex flex-col shadow-sm">
                <div className="p-3 border-b bg-card">
                    <h3 className="font-semibold text-[15px]">Administration Details</h3>
                </div>

                <div className="p-4 flex-1 overflow-y-auto">
                    {!selectedVaccine ? (
                        <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-center px-4">
                            <Syringe className="w-12 h-12 mb-3 opacity-20" />
                            <p className="text-[14px]">Select a pending or overdue vaccine from the timeline to administer.</p>
                        </div>
                    ) : (
                        <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
                            <div className="bg-primary/10 p-3 rounded-md border border-primary/20">
                                <p className="text-[14px] font-semibold text-primary">{selectedVaccine.name}</p>
                                <p className="text-[13px] text-muted-foreground">Route: {selectedVaccine.type}</p>
                            </div>

                            <div className="space-y-3">
                                <div>
                                    <label className="text-[14px] text-muted-foreground font-medium mb-1.5 block">Brand Name</label>
                                    <Input
                                        placeholder="e.g. Rotasiil, Bio-Polio"
                                        value={brandName}
                                        onChange={(e) => setBrandName(e.target.value)}
                                    />
                                </div>

                                <div className="flex gap-3">
                                    <div className="flex-1">
                                        <label className="text-[14px] text-muted-foreground font-medium mb-1.5 block">Batch No / VVM</label>
                                        <Input
                                            placeholder="Scan or enter"
                                            value={batchNo}
                                            onChange={(e) => setBatchNo(e.target.value)}
                                            className="font-mono text-[14px]"
                                        />
                                    </div>
                                    <div className="w-1/3">
                                        <label className="text-[14px] text-muted-foreground font-medium mb-1.5 block">Site</label>
                                        <Select value={site} onValueChange={setSite}>
                                            <SelectTrigger><SelectValue placeholder="Site" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="Left Thigh">Left Thigh</SelectItem>
                                                <SelectItem value="Right Thigh">Right Thigh</SelectItem>
                                                <SelectItem value="Left Arm">Left Arm</SelectItem>
                                                <SelectItem value="Right Arm">Right Arm</SelectItem>
                                                <SelectItem value="Oral">Oral</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-[14px] text-muted-foreground font-medium mb-1.5 block">Billing Cost (₹)</label>
                                    <Input type="number" placeholder="0" value={cost} onChange={(e) => setCost(e.target.value)} />
                                </div>
                            </div>

                            <Button className="w-full mt-4" onClick={handleAdminister} disabled={!batchNo || saving}>
                                <Save className="w-4 h-4 mr-2" /> {saving ? "Saving..." : "Administer & Save"}
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ImmunizationScheduleTab;