import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Clock, User, ArrowRight, CheckCircle2, FlaskConical, Activity, ActivitySquare, Stethoscope, HeartPulse } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface PipelineTabProps {
    hospitalId: string;
    userId: string | null;
}

type Station = "Registration" | "Vitals" | "Laboratory" | "ECG" | "Radiology" | "Consultation" | "Completed";

const STATIONS: { name: Station; icon: React.ReactNode; color: string }[] = [
    { name: "Registration", icon: <User className="w-4 h-4" />, color: "bg-slate-100 border-slate-200 text-slate-700" },
    { name: "Vitals", icon: <Activity className="w-4 h-4" />, color: "bg-blue-50 border-blue-200 text-blue-700" },
    { name: "Laboratory", icon: <FlaskConical className="w-4 h-4" />, color: "bg-violet-50 border-violet-200 text-violet-700" },
    { name: "ECG", icon: <ActivitySquare className="w-4 h-4" />, color: "bg-pink-50 border-pink-200 text-pink-700" },
    { name: "Radiology", icon: <HeartPulse className="w-4 h-4" />, color: "bg-amber-50 border-amber-200 text-amber-700" },
    { name: "Consultation", icon: <Stethoscope className="w-4 h-4" />, color: "bg-indigo-50 border-indigo-200 text-indigo-700" },
    { name: "Completed", icon: <CheckCircle2 className="w-4 h-4" />, color: "bg-emerald-50 border-emerald-200 text-emerald-700" },
];

interface Booking {
    id: string;
    patientName: string;
    patientId: string;
    packageName: string;
    corporate?: string;
    currentStation: Station;
    waitTimeMins: number;
}

// Mock Data to demonstrate pipeline flow
const INITIAL_BOOKINGS: Booking[] = [
    { id: "BKG-001", patientName: "Aarav Sharma", patientId: "PT-1001", packageName: "Executive Male Checkup", currentStation: "Vitals", waitTimeMins: 12 },
    { id: "BKG-002", patientName: "Priya Desai", patientId: "PT-1002", packageName: "Comprehensive Female", currentStation: "Laboratory", waitTimeMins: 5 },
    { id: "BKG-003", patientName: "Rohan Gupta", patientId: "PT-1003", packageName: "Corporate Annual (TCS)", corporate: "TCS", currentStation: "ECG", waitTimeMins: 18 },
    { id: "BKG-004", patientName: "Neha Verma", patientId: "PT-1004", packageName: "Senior Citizen Health", currentStation: "Radiology", waitTimeMins: 22 },
    { id: "BKG-005", patientName: "Amit Kumar", patientId: "PT-1005", packageName: "Executive Male Checkup", currentStation: "Consultation", waitTimeMins: 8 },
    { id: "BKG-006", patientName: "Kavita Singh", patientId: "PT-1006", packageName: "Pre-Marital Checkup", currentStation: "Registration", waitTimeMins: 2 },
];

const PipelineTab: React.FC<PipelineTabProps> = ({ hospitalId, userId }) => {
    const { toast } = useToast();
    const [bookings, setBookings] = useState<Booking[]>(INITIAL_BOOKINGS);
    const [filterPackage, setFilterPackage] = useState("all");

    const getNextStation = (current: Station): Station => {
        const idx = STATIONS.findIndex(s => s.name === current);
        if (idx >= 0 && idx < STATIONS.length - 1) {
            return STATIONS[idx + 1].name;
        }
        return "Completed";
    };

    const movePatient = (bookingId: string, currentStation: Station) => {
        const nextStation = getNextStation(currentStation);

        setBookings(prev =>
            prev.map(b => b.id === bookingId ? { ...b, currentStation: nextStation, waitTimeMins: 0 } : b)
        );

        toast({
            title: "Patient Moved",
            description: `Patient routed to ${nextStation} station successfully.`,
        });
    };

    const filteredBookings = bookings.filter(b => filterPackage === "all" || b.packageName.includes(filterPackage));

    return (
        <div className="flex flex-col h-full space-y-4">
            {/* Toolbar */}
            <div className="flex justify-between items-center bg-card p-3 border rounded-lg shadow-sm">
                <div className="flex gap-4 items-center">
                    <span className="text-[14px] font-semibold text-foreground">Filter by Package:</span>
                    <Select value={filterPackage} onValueChange={setFilterPackage}>
                        <SelectTrigger className="w-[250px] h-8 text-[14px]">
                            <SelectValue placeholder="All Packages" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Packages</SelectItem>
                            <SelectItem value="Executive">Executive Checkups</SelectItem>
                            <SelectItem value="Corporate">Corporate Group (TCS)</SelectItem>
                            <SelectItem value="Senior">Senior Citizen</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="text-[14px] text-muted-foreground font-medium">
                    Total Active: <span className="text-foreground font-bold">{filteredBookings.filter(b => b.currentStation !== "Completed").length}</span> Patients
                </div>
            </div>

            {/* Kanban Board Area (Zero Scroll compliant - horizontal scroll only) */}
            <div className="flex-1 overflow-x-auto overflow-y-hidden flex gap-4 pb-2">
                {STATIONS.map((station) => {
                    const stationBookings = filteredBookings.filter(b => b.currentStation === station.name);

                    return (
                        <div key={station.name} className="flex flex-col w-[320px] shrink-0 h-full border rounded-xl bg-muted/20">

                            {/* Column Header */}
                            <div className={`p-3 border-b flex justify-between items-center rounded-t-xl ${station.color}`}>
                                <div className="flex items-center gap-2">
                                    {station.icon}
                                    <h3 className="font-bold text-[14px]">{station.name}</h3>
                                </div>
                                <Badge variant="outline" className="bg-background text-[12px] font-bold px-2">
                                    {stationBookings.length}
                                </Badge>
                            </div>

                            {/* Column Body */}
                            <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
                                {stationBookings.length === 0 ? (
                                    <div className="text-center text-muted-foreground/50 text-[13px] mt-10 border-2 border-dashed border-muted-foreground/20 p-4 rounded-lg">
                                        No patients waiting
                                    </div>
                                ) : (
                                    stationBookings.sort((a, b) => b.waitTimeMins - a.waitTimeMins).map(booking => (
                                        <div key={booking.id} className="bg-card border shadow-sm rounded-lg p-3 hover:shadow-md transition-shadow relative overflow-hidden group">
                                            {/* Wait Time Indicator Top Line */}
                                            <div className={`absolute top-0 left-0 right-0 h-1 ${booking.waitTimeMins > 15 ? 'bg-red-500' : booking.waitTimeMins > 10 ? 'bg-amber-500' : 'bg-emerald-500'}`} />

                                            <div className="flex justify-between items-start mb-2 mt-1">
                                                <div>
                                                    <h4 className="text-[14px] font-bold text-foreground leading-tight">{booking.patientName}</h4>
                                                    <span className="text-[11px] font-mono text-muted-foreground">{booking.patientId}</span>
                                                </div>
                                                <div className={`flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-md ${booking.waitTimeMins > 15 ? 'bg-red-50 text-red-700' : 'bg-muted/50 text-muted-foreground'}`}>
                                                    <Clock className="w-3 h-3" />
                                                    {booking.waitTimeMins}m
                                                </div>
                                            </div>

                                            <p className="text-[12px] text-foreground mb-1 line-clamp-1" title={booking.packageName}>
                                                📦 {booking.packageName}
                                            </p>

                                            {booking.corporate && (
                                                <Badge variant="secondary" className="text-[10px] mb-3 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-none">
                                                    🏢 {booking.corporate}
                                                </Badge>
                                            )}

                                            {/* Actions */}
                                            <div className="mt-3 pt-3 border-t flex justify-between items-center">
                                                {station.name === "Completed" ? (
                                                    <Button variant="outline" size="sm" className="w-full text-[12px] h-7 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200">
                                                        View Consolidated Report
                                                    </Button>
                                                ) : (
                                                    <>
                                                        <Button variant="ghost" size="sm" className="h-7 text-[12px] px-2 text-muted-foreground hover:text-primary">
                                                            Details
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            className="h-7 text-[12px] px-3 bg-primary/10 text-primary hover:bg-primary hover:text-white"
                                                            onClick={() => movePatient(booking.id, station.name)}
                                                        >
                                                            Next <ArrowRight className="w-3 h-3 ml-1" />
                                                        </Button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Global CSS for the scrollbar to make it sleek */}
            <style dangerouslySetInnerHTML={{
                __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #cbd5e1;
          border-radius: 10px;
        }
      `}} />
        </div>
    );
};

export default PipelineTab;