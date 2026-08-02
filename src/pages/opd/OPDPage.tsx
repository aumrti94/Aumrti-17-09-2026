import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useRealtimeRefetch } from "@/hooks/useRealtimeRefetch";
import { useIsMobile } from "@/hooks/use-mobile";
import { ChevronLeft } from "lucide-react";
import OnboardingTour from "@/components/onboarding/OnboardingTour";
import TokenQueue from "@/components/opd/TokenQueue";
import ConsultationWorkspace from "@/components/opd/ConsultationWorkspace";
import PatientSummary from "@/components/opd/PatientSummary";
import CollapsiblePanel from "@/components/layout/CollapsiblePanel";

export interface OpdToken {
  id: string;
  token_number: string;
  token_prefix: string;
  status: string;
  priority: string;
  visit_date: string;
  visit_mode?: string | null;
  visit_type?: string | null;
  is_mlc?: boolean | null;
  payer_type?: string | null;
  payer_id?: string | null;
  called_at: string | null;
  consultation_start_at: string | null;
  consultation_end_at: string | null;
  created_at: string;
  patient_id: string;
  doctor_id: string | null;
  department_id: string | null;
  hospital_id: string;
  appointment_id?: string | null;
  appointment?: { slot_time: string } | null;
  patient?: { full_name: string; phone: string | null; uhid: string; gender: string | null; dob: string | null; blood_group: string | null; allergies: string | null; chronic_conditions: string[] | null; insurance_id: string | null; address: string | null; abha_id?: string | null };
  doctor?: { full_name: string } | null;
  department?: { name: string } | null;
}

const OPDPage: React.FC = () => {
  const [tokens, setTokens] = useState<OpdToken[]>([]);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [showPatientDetails, setShowPatientDetails] = useState(false);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>(() => new Date().toISOString().split("T")[0]);
  const { toast } = useToast();

  const fetchTokens = useCallback(async (date?: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: userData, error: userErr } = await supabase.from("users").select("id, hospital_id, role").eq("auth_user_id", user.id).maybeSingle();
    if (userErr || !userData) { console.error("OPD user fetch error:", userErr?.message); setLoading(false); return; }
    setUserId(userData.id);
    setHospitalId(userData.hospital_id);
    setUserRole(userData.role);

    const visitDate = date ?? new Date().toISOString().split("T")[0];
    let query = supabase
      .from("opd_tokens")
      .select("*, patient:patients(full_name, phone, uhid, gender, dob, blood_group, allergies, chronic_conditions, insurance_id, address, abha_id), doctor:users!opd_tokens_doctor_id_fkey(full_name), department:departments(name), appointment:appointments(slot_time)")
      .eq("hospital_id", userData.hospital_id)
      .eq("visit_date", visitDate)
      .order("created_at", { ascending: true });

    if (userData.role === "doctor") {
      query = query.eq("doctor_id", userData.id);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching tokens:", error);
      toast({ title: "Failed to load OPD queue", description: "Please try again.", variant: "destructive" });
      setLoading(false);
      return;
    }
    setTokens((data as unknown as OpdToken[]) || []);
    setLoading(false);
  }, [toast]);

  const handleDateChange = useCallback((date: string) => {
    setSelectedDate(date);
    setLoading(true);
    fetchTokens(date);
  }, [fetchTokens]);

  // Optimistic in-place token update. Lets the workspace reflect a status change
  // (e.g. Start Consultation) immediately instead of blanking through a full refetch —
  // the realtime subscription below still reconciles with the server right after.
  const patchToken = useCallback((tokenId: string, patch: Partial<OpdToken>) => {
    setTokens((prev) => prev.map((t) => (t.id === tokenId ? { ...t, ...patch } : t)));
  }, []);

  useEffect(() => { fetchTokens(); }, [fetchTokens]);

  // Live updates: refetch the currently-viewed day's queue on any opd_tokens change,
  // plus on tab focus / reconnect (fallback handled inside the hook).
  useRealtimeRefetch({
    tables: ["opd_tokens"],
    hospitalId,
    onChange: () => fetchTokens(selectedDate),
    channelName: "opd-tokens",
  });

  const isMobile = useIsMobile();
  const selectedToken = tokens.find((t) => t.id === selectedTokenId) || null;

  // Mobile: show queue OR workspace, never both at once
  const showQueue = !isMobile || !selectedTokenId;
  const showWorkspace = !isMobile || !!selectedTokenId;

  return (
    <div className="flex h-full overflow-hidden">
      {userRole === "receptionist" && <OnboardingTour tourKey="receptionist_intro" />}
      {showQueue && !isMobile && (
        <CollapsiblePanel panelKey="opd_queue" title="OPD Queue" side="left" expandedWidth="w-[280px]">
          <TokenQueue
            tokens={tokens}
            selectedTokenId={selectedTokenId}
            onSelectToken={(id) => { setSelectedTokenId(id); setShowPatientDetails(false); }}
            hospitalId={hospitalId}
            loading={loading}
            selectedDate={selectedDate}
            onDateChange={handleDateChange}
            onTokenCreated={fetchTokens}
          />
        </CollapsiblePanel>
      )}
      {/* Mobile: show queue without collapse wrapper */}
      {showQueue && isMobile && (
        <TokenQueue
          tokens={tokens}
          selectedTokenId={selectedTokenId}
          onSelectToken={(id) => { setSelectedTokenId(id); setShowPatientDetails(false); }}
          hospitalId={hospitalId}
          loading={loading}
          onTokenCreated={fetchTokens}
          selectedDate={selectedDate}
          onDateChange={handleDateChange}
        />
      )}
      {showWorkspace && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {isMobile && selectedTokenId && (
            <button
              onClick={() => { setSelectedTokenId(null); setShowPatientDetails(false); }}
              className="flex-shrink-0 flex items-center gap-1.5 h-11 px-4 bg-card border-b border-border text-sm font-medium text-primary hover:bg-muted/30 w-full text-left"
            >
              <ChevronLeft size={16} /> Back to Queue
            </button>
          )}
          <div className="flex-1 flex overflow-hidden">
            <ConsultationWorkspace
              token={selectedToken}
              hospitalId={hospitalId}
              userId={userId}
              onTokenUpdate={() => fetchTokens(selectedDate)}
              onTokenPatch={patchToken}
              showPatientDetails={showPatientDetails}
              onTogglePatientDetails={() => setShowPatientDetails((p) => !p)}
            />
            {!isMobile && showPatientDetails && (
              <CollapsiblePanel panelKey="opd_patient_details" title="Patient Details" side="right" expandedWidth="w-[340px]">
                <PatientSummary token={selectedToken} hospitalId={hospitalId} onClose={() => setShowPatientDetails(false)} />
              </CollapsiblePanel>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default OPDPage;
