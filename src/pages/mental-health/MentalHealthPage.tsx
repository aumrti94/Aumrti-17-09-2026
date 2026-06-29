import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Brain, User, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import MHConsultationTab from "@/components/mental-health/MHConsultationTab";
import MHPsychometricTab from "@/components/mental-health/MHPsychometricTab";
import MHTherapyTab from "@/components/mental-health/MHTherapyTab";

interface Patient {
  id: string;
  full_name: string;
  uhid: string;
  gender: string | null;
  dob: string | null;
  phone: string | null;
}

function calcAge(dob: string | null): string {
  if (!dob) return "—";
  return `${Math.floor((Date.now() - new Date(dob).getTime()) / 31557600000)}y`;
}

const MentalHealthPage: React.FC = () => {
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selected, setSelected] = useState<Patient | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("consultation");
  const [currentEncounterId, setCurrentEncounterId] = useState<string | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      (supabase as any).from("users").select("hospital_id").eq("auth_user_id", user.id).maybeSingle()
        .then(({ data }: any) => { if (data?.hospital_id) setHospitalId(data.hospital_id); });
    });
  }, []);

  const fetchPatients = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("mental_health_encounters")
      .select("patient_id, patients(id, full_name, uhid, gender, dob, phone)")
      .eq("hospital_id", hospitalId)
      .order("created_at", { ascending: false })
      .limit(200);

    const seen = new Set<string>();
    const unique: Patient[] = [];
    (data || []).forEach((row: any) => {
      const p = row.patients;
      if (p && !seen.has(p.id)) { seen.add(p.id); unique.push(p); }
    });
    setPatients(unique);
    setLoading(false);
  }, [hospitalId]);

  const searchPatients = useCallback(async () => {
    if (!hospitalId || search.trim().length < 2) { fetchPatients(); return; }
    setLoading(true);
    const { data } = await (supabase as any)
      .from("patients")
      .select("id, full_name, uhid, gender, dob, phone")
      .eq("hospital_id", hospitalId)
      .or(`full_name.ilike.%${search}%,uhid.ilike.%${search}%`)
      .limit(20);
    setPatients(data || []);
    setLoading(false);
  }, [hospitalId, search]);

  useEffect(() => { if (hospitalId) fetchPatients(); }, [hospitalId, fetchPatients]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* LEFT PANEL — patient list */}
      <div className="w-[260px] flex flex-col border-r bg-card">
        <div className="p-3 border-b space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              <span className="text-sm font-bold">Mental Health</span>
            </div>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => hospitalId && fetchPatients()}>
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search patient..."
              className="pl-8 h-8 text-xs"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === "Enter" && searchPatients()}
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          {patients.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              {loading ? "Loading..." : "No patients found"}
            </p>
          ) : patients.map(p => (
            <button
              key={p.id}
              onClick={() => { setSelected(p); setCurrentEncounterId(undefined); setActiveTab("consultation"); }}
              className={cn(
                "w-full text-left px-3 py-2.5 border-b hover:bg-muted/50 transition-colors",
                selected?.id === p.id && "bg-muted"
              )}
            >
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <User className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate">{p.full_name}</p>
                  <p className="text-[10px] text-muted-foreground">{p.uhid} · {calcAge(p.dob)} {p.gender || ""}</p>
                </div>
              </div>
            </button>
          ))}
        </ScrollArea>
      </div>

      {/* RIGHT PANEL — workspace */}
      {!selected ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center space-y-2">
            <Brain className="h-12 w-12 mx-auto text-muted-foreground/30" />
            <p className="text-sm font-medium">Select a patient or search to begin</p>
            <p className="text-xs">Mental health consultations, psychometric assessments & therapy plans</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Patient header */}
          <div className="shrink-0 px-5 py-3 border-b bg-card flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-bold">{selected.full_name}</p>
              <p className="text-xs text-muted-foreground">{selected.uhid} · {calcAge(selected.dob)} · {selected.gender || "—"}</p>
            </div>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="shrink-0 w-full justify-start rounded-none border-b bg-card h-10 px-5">
              <TabsTrigger value="consultation" className="text-xs">Consultation</TabsTrigger>
              <TabsTrigger value="psychometric" className="text-xs">Psychometric Scales</TabsTrigger>
              <TabsTrigger value="therapy" className="text-xs">Therapy Plans</TabsTrigger>
            </TabsList>

            <TabsContent value="consultation" className="flex-1 overflow-hidden mt-0 p-3">
              <MHConsultationTab
                patientId={selected.id}
                hospitalId={hospitalId!}
                onEncounterCreated={id => setCurrentEncounterId(id)}
              />
            </TabsContent>

            <TabsContent value="psychometric" className="flex-1 overflow-hidden mt-0 p-3">
              <MHPsychometricTab
                patientId={selected.id}
                hospitalId={hospitalId!}
                encounterId={currentEncounterId}
              />
            </TabsContent>

            <TabsContent value="therapy" className="flex-1 overflow-hidden mt-0 p-3">
              <MHTherapyTab
                patientId={selected.id}
                hospitalId={hospitalId!}
              />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
};

export default MentalHealthPage;
