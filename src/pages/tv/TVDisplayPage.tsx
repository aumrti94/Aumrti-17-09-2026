import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { useHospitalId } from "@/hooks/useHospitalId";

const REFRESH_MS = 30_000;
const TIP_ROTATE_MS = 8_000;

const HEALTH_TIPS = [
  { emoji: "💧", text: "Drink 8 glasses of water daily" },
  { emoji: "🚶", text: "30 minutes of walking improves heart health" },
  { emoji: "🩺", text: "Regular health checkups prevent 80% of diseases" },
  { emoji: "🧴", text: "Wash hands for 20 seconds to prevent infections" },
  { emoji: "😴", text: "7-8 hours of sleep boosts immunity" },
  { emoji: "🥦", text: "Eat 5 servings of fruits & vegetables daily" },
];

interface Token {
  id: string;
  token_number: string;
  token_prefix: string;
  status: string;
  patient_name?: string;
  doctor_name?: string;
}

interface DeptStatus {
  name: string;
  currentToken: string;
}

const TVDisplayPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const deptId = searchParams.get("dept");
  const { hospitalId } = useHospitalId();

  const [now, setNow] = useState(new Date());
  const [tipIndex, setTipIndex] = useState(0);
  const [tipFade, setTipFade] = useState(true);
  const [hospital, setHospital] = useState<any>(null);
  const [callingToken, setCallingToken] = useState<Token | null>(null);
  const [nextTokens, setNextTokens] = useState<Token[]>([]);
  const [deptStatuses, setDeptStatuses] = useState<DeptStatus[]>([]);

  const today = format(new Date(), "yyyy-MM-dd");

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Tip carousel
  useEffect(() => {
    const t = setInterval(() => {
      setTipFade(false);
      setTimeout(() => {
        setTipIndex(i => (i + 1) % HEALTH_TIPS.length);
        setTipFade(true);
      }, 400);
    }, TIP_ROTATE_MS);
    return () => clearInterval(t);
  }, []);

  // Fetch hospital info
  useEffect(() => {
    if (!hospitalId) return;
    supabase.from("hospitals").select("name, address, logo_url, announcement_text, phone:razorpay_key_id").eq("id", hospitalId).maybeSingle().then(({ data }) => {
      setHospital(data);
    });
  }, [hospitalId]);

  const fetchTokens = useCallback(async () => {
    if (!hospitalId) return;
    let query = supabase
      .from("opd_tokens")
      .select("id, token_number, token_prefix, status, patients(full_name), users:doctor_id(full_name)")
      .eq("hospital_id", hospitalId)
      .eq("visit_date", today)
      .order("token_number", { ascending: true });

    if (deptId) query = query.eq("department_id", deptId);

    const { data } = await query;
    if (!data) return;

    const mapped = data.map((t: any) => {
      const fullName = t.patients?.full_name || "";
      const parts = fullName.trim().split(/\s+/);
      const masked = parts.length > 1
        ? `${parts[0][0]}. ${parts.slice(1).join(" ")}`
        : parts[0] ? `${parts[0][0]}.` : "";
      return {
        id: t.id,
        token_number: t.token_number,
        token_prefix: t.token_prefix || "",
        status: t.status,
        patient_name: masked,
        doctor_name: t.users?.full_name || "",
      };
    });

    const calling = mapped.find(t => t.status === "in_consultation") || mapped.find(t => t.status === "called") || null;
    const waiting = mapped.filter(t => t.status === "waiting").slice(0, 3);

    setCallingToken(calling);
    setNextTokens(waiting);

    // Dept statuses
    const { data: depts } = await supabase.from("departments").select("id, name").eq("hospital_id", hospitalId).eq("is_active", true).eq("type", "clinical").order("name", { ascending: true });
    if (depts) {
      const statuses: DeptStatus[] = [];
      for (const dept of depts.slice(0, 6)) {
        const { data: tok } = await supabase.from("opd_tokens").select("token_number, token_prefix").eq("hospital_id", hospitalId).eq("visit_date", today).eq("department_id", dept.id).in("status", ["in_consultation", "called"]).limit(1).maybeSingle();
        statuses.push({
          name: dept.name,
          currentToken: tok ? `${tok.token_prefix || ""}${tok.token_number}` : "—",
        });
      }
      setDeptStatuses(statuses);
    }
  }, [today, deptId, hospitalId]);

  useEffect(() => {
    fetchTokens();
    const iv = setInterval(fetchTokens, REFRESH_MS);
    return () => clearInterval(iv);
  }, [fetchTokens]);

  // Realtime subscription for live token updates
  useEffect(() => {
    const channel = supabase
      .channel("tv-tokens")
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "opd_tokens",
        ...(hospitalId ? { filter: `hospital_id=eq.${hospitalId}` } : {}),
      }, () => {
        fetchTokens();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchTokens, hospitalId]);

  const tip = HEALTH_TIPS[tipIndex];
  const announcement = hospital?.announcement_text || `Welcome to ${hospital?.name || "our hospital"} — Your health is our priority`;
  const tokenDisplay = callingToken ? `${callingToken.token_prefix}${callingToken.token_number}` : "—";

  return (
    <div className="h-screen flex bg-[#0F172A] text-white overflow-hidden select-none cursor-none">
      {/* LEFT — Token Queue */}
      <div className="w-[60%] flex flex-col p-8">
        {/* Header */}
        <div className="text-center mb-6">
          {hospital?.logo_url && <img src={hospital.logo_url} alt="Logo" className="h-16 mx-auto mb-3 brightness-0 invert" />}
          <h1 className="text-2xl font-bold tracking-wide">OPD Token Queue</h1>
          <p className="text-xl text-white/70 font-mono mt-1">{format(now, "hh:mm:ss a")}</p>
        </div>

        {/* Now Calling */}
        <div className="bg-[#1A2F5A] rounded-2xl p-8 text-center my-4">
          <p className="text-sm font-bold text-white/50 uppercase tracking-[0.15em]">Now Calling</p>
          <p className="text-7xl font-bold mt-3 mb-4">{tokenDisplay}</p>
          {callingToken && (
            <>
              <p className="text-base text-white/50">Please proceed to:</p>
              <p className="text-2xl font-bold text-emerald-400 mt-1">
                {callingToken.doctor_name ? `Dr. ${callingToken.doctor_name}` : "Counter"}
              </p>
            </>
          )}
        </div>

        {/* Next tokens */}
        {nextTokens.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-bold uppercase text-white/40 tracking-wider mb-3">Next</p>
            <div className="space-y-3">
              {nextTokens.map(t => (
                <div key={t.id} className="flex items-center gap-4 bg-white/5 rounded-xl px-6 py-4">
                  <span className="text-3xl font-bold">{t.token_prefix}{t.token_number}</span>
                  <span className="text-lg text-white/50">· {t.patient_name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* RIGHT — Info + Announcements */}
      <div className="w-[40%] bg-[#111827] flex flex-col p-8">
        {/* Ticker */}
        <div className="bg-[#1A2F5A] rounded-xl px-5 py-4 mb-6">
          <p className="text-base">
            <span className="mr-2">📢</span>
            <span className="text-white/90">{announcement}</span>
          </p>
        </div>

        {/* Department Status */}
        <div className="flex-1">
          <h2 className="text-base font-bold mb-4">Departments Open Today</h2>
          <div className="space-y-3">
            {deptStatuses.map((d, i) => (
              <div key={i} className="flex items-center justify-between bg-white/5 rounded-lg px-4 py-3">
                <span className="text-base">{d.name}</span>
                <span className="text-sm text-emerald-400 font-medium">
                  {d.currentToken !== "—" ? `Seeing ${d.currentToken}` : "Waiting"}
                </span>
              </div>
            ))}
            {deptStatuses.length === 0 && (
              <p className="text-white/40 text-sm text-center py-8">No departments active</p>
            )}
          </div>
        </div>

        {/* Health Tips */}
        <div className={`text-center py-8 transition-opacity duration-400 ${tipFade ? "opacity-100" : "opacity-0"}`}>
          <span className="text-5xl block mb-3">{tip.emoji}</span>
          <p className="text-xl text-white/80">{tip.text}</p>
        </div>

        {/* Footer */}
        <div className="text-center pt-4 border-t border-white/10">
          <p className="text-base text-white/70">{hospital?.name}</p>
          {hospital?.address && <p className="text-sm text-white/40 mt-1">{hospital.address}</p>}
        </div>
      </div>
    </div>
  );
};

export default TVDisplayPage;
