import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Search, Sparkles, Send, CheckCircle2, AlertCircle, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface PreAuthTabProps {
    patientId: string;
    hospitalId: string;
    userId: string | null;
}

const PreAuthTab: React.FC<PreAuthTabProps> = ({ patientId, hospitalId, userId }) => {
    const { toast } = useToast();

    const [pmjayId, setPmjayId] = useState("");
    const [checking, setChecking] = useState(false);
    const [beneficiary, setBeneficiary] = useState<any>(null);

    const [icdCode, setIcdCode] = useState("");
    const [matching, setMatching] = useState(false);
    const [matchedPackage, setMatchedPackage] = useState<any>(null);

    const [clinicalNotes, setClinicalNotes] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const handleEligibilityCheck = async () => {
        if (!pmjayId) return;
        setChecking(true);

        // Simulate NHA Beneficiary Identification System API call
        setTimeout(() => {
            setBeneficiary({
                name: "Aarav Sharma",
                urn: `URN-${Math.floor(Math.random() * 100000000)}`,
                state: "Maharashtra",
                balance: 500000,
                status: "Active"
            });
            setChecking(false);
            toast({ title: "Beneficiary Verified", description: "PMJAY card is active and eligible." });
        }, 1500);
    };

    const handleAutoMatch = () => {
        if (!icdCode) return;
        setMatching(true);
        setMatchedPackage(null);

        // Simulate AI / XGBoost Package matching
        setTimeout(() => {
            let pkg = null;
            if (icdCode === "J18.9") {
                pkg = { code: "MG034", name: "Medical Management of Pneumonia", amount: 15000, confidence: 96 };
            } else if (icdCode === "O82") {
                pkg = { code: "MC012", name: "Caesarean Delivery (LSCS)", amount: 24000, confidence: 99 };
            } else {
                pkg = { code: "SU001", name: "General Surgical Package - Level 1", amount: 10000, confidence: 78 };
            }

            setMatchedPackage(pkg);
            setMatching(false);
            toast({ title: "AI Match Complete", description: `Mapped to HBP Package: ${pkg.code}` });
        }, 1800);
    };

    const handleSubmit = async () => {
        if (!beneficiary || !matchedPackage) return;
        setSubmitting(true);

        // Simulate Pre-Auth Submission to NHA Portal
        setTimeout(() => {
            setSubmitting(false);
            toast({
                title: "Pre-Auth Submitted Successfully",
                description: `Reference Number: PRE-${Date.now().toString().slice(-6)}`,
            });
            // In reality, we would INSERT into pmjay_preauth_requests here
        }, 2000);
    };

    return (
        <div className="flex h-full gap-6">
            {/* Left Pane: Eligibility & Clinical Inputs */}
            <div className="w-1/2 flex flex-col gap-4 overflow-y-auto pr-2 pb-10">

                {/* Step 1: Beneficiary Verification */}
                <div className="border rounded-lg bg-card shadow-sm p-4">
                    <h3 className="font-semibold text-[15px] mb-3 text-foreground border-b pb-2">1. Beneficiary Verification</h3>
                    <div className="flex gap-2 mb-4">
                        <Input
                            placeholder="Enter PMJAY ID / ABHA Number"
                            value={pmjayId}
                            onChange={(e) => setPmjayId(e.target.value)}
                            className="font-mono text-[14px]"
                        />
                        <Button onClick={handleEligibilityCheck} disabled={checking || !pmjayId}>
                            {checking ? "Checking..." : <><Search className="w-4 h-4 mr-2" /> Verify</>}
                        </Button>
                    </div>

                    {beneficiary && (
                        <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3 space-y-2 animate-in fade-in">
                            <div className="flex justify-between items-center">
                                <span className="text-[14px] font-semibold text-emerald-800">{beneficiary.name}</span>
                                <Badge className="bg-emerald-500 hover:bg-emerald-600">Eligible</Badge>
                            </div>
                            <div className="grid grid-cols-2 gap-2 mt-2 text-[13px] text-emerald-700">
                                <div><span className="opacity-70">URN:</span> <span className="font-mono font-medium">{beneficiary.urn}</span></div>
                                <div><span className="opacity-70">State:</span> <span className="font-medium">{beneficiary.state}</span></div>
                                <div className="col-span-2">
                                    <span className="opacity-70">Wallet Balance:</span>
                                    <span className="font-mono font-bold ml-1">₹{beneficiary.balance.toLocaleString("en-IN")}</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Step 2: Clinical Details */}
                <div className={`border rounded-lg bg-card shadow-sm p-4 transition-opacity ${!beneficiary ? 'opacity-50 pointer-events-none' : ''}`}>
                    <h3 className="font-semibold text-[15px] mb-3 text-foreground border-b pb-2">2. Clinical Diagnosis</h3>
                    <div className="space-y-4">
                        <div>
                            <label className="text-[14px] text-muted-foreground font-medium mb-1.5 block">Principal Diagnosis (ICD-10)</label>
                            <Select value={icdCode} onValueChange={setIcdCode}>
                                <SelectTrigger className="text-[14px]">
                                    <SelectValue placeholder="Select ICD-10 Code" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="J18.9">J18.9 - Pneumonia, unspecified organism</SelectItem>
                                    <SelectItem value="O82">O82 - Single delivery by caesarean section</SelectItem>
                                    <SelectItem value="K35.8">K35.8 - Acute appendicitis</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <label className="text-[14px] text-muted-foreground font-medium mb-1.5 block">Justification / Clinical Notes</label>
                            <Textarea
                                placeholder="Enter patient history, vitals, and surgical necessity..."
                                value={clinicalNotes}
                                onChange={(e) => setClinicalNotes(e.target.value)}
                                className="h-24 text-[14px]"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Right Pane: AI Matching & Submission */}
            <div className="w-1/2 border rounded-lg bg-muted/10 h-full flex flex-col shadow-sm">
                <div className="p-3 border-b bg-card flex justify-between items-center">
                    <h3 className="font-semibold text-[15px] flex items-center text-primary">
                        <Sparkles className="w-4 h-4 mr-2" /> AI Package Match Engine
                    </h3>
                    <Button size="sm" variant="secondary" onClick={handleAutoMatch} disabled={matching || !icdCode || !beneficiary}>
                        {matching ? "Matching..." : "Run AI Match"}
                    </Button>
                </div>

                <div className="p-4 flex-1 overflow-y-auto">
                    {!matchedPackage ? (
                        <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-center px-4">
                            <Sparkles className="w-12 h-12 mb-3 opacity-20" />
                            <p className="text-[14px]">Select an ICD-10 code and run the AI Match engine to find the closest HBP package.</p>
                        </div>
                    ) : (
                        <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
                            <div className="bg-primary/10 border border-primary/20 rounded-md p-4">
                                <div className="flex justify-between items-start mb-2">
                                    <Badge className="bg-primary/20 text-primary hover:bg-primary/30 border-none">Top Match</Badge>
                                    <span className="text-[12px] font-bold text-primary flex items-center">
                                        <CheckCircle2 className="w-3 h-3 mr-1" /> {matchedPackage.confidence}% Confidence
                                    </span>
                                </div>
                                <h4 className="text-[16px] font-bold text-foreground mb-1">{matchedPackage.name}</h4>
                                <p className="text-[14px] text-muted-foreground font-mono">Package Code: {matchedPackage.code}</p>

                                <div className="mt-4 pt-3 border-t border-primary/10 flex justify-between items-center">
                                    <span className="text-[14px] font-medium text-foreground">Package Rate:</span>
                                    <span className="text-[18px] font-bold font-mono text-foreground">₹{matchedPackage.amount.toLocaleString("en-IN")}</span>
                                </div>
                            </div>

                            <div className="bg-amber-50 border border-amber-200 rounded-md p-3 flex gap-3 text-amber-800">
                                <AlertCircle className="w-5 h-5 shrink-0" />
                                <p className="text-[13px]">
                                    <strong>Strict Compliance Block:</strong> If this pre-auth is approved, you cannot bill the patient for any amount covered by this package rate.
                                </p>
                            </div>

                            <Button className="w-full h-12 text-[15px] mt-4" onClick={handleSubmit} disabled={submitting}>
                                <Send className="w-4 h-4 mr-2" />
                                {submitting ? "Transmitting to NHA..." : "Submit Pre-Authorization"}
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PreAuthTab;