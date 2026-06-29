import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Star, ExternalLink } from "lucide-react";
import type { PortalSession } from "./PortalLogin";

const LABELS = ["", "Very Poor", "Poor", "Average", "Good", "Excellent"];

const PortalFeedback: React.FC<{ session: PortalSession }> = ({ session }) => {
  const [visits, setVisits] = useState<any[]>([]);
  const [selectedVisit, setSelectedVisit] = useState<string>("general");
  const [overall, setOverall] = useState(0);
  const [doctor, setDoctor] = useState(0);
  const [nursing, setNursing] = useState(0);
  const [facility, setFacility] = useState(0);
  const [comments, setComments] = useState("");
  const [recommend, setRecommend] = useState<boolean | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  // Load recent visits
  useEffect(() => {
    (async () => {
      const recentVisits: any[] = [];

      const { data: opd } = await supabase
        .from("opd_encounters")
        .select("id, created_at, doctor_id")
        .eq("patient_id", session.patientId)
        .eq("hospital_id", session.hospitalId)
        .order("created_at", { ascending: false })
        .limit(3);

      if (opd?.length) {
        const docIds = [...new Set(opd.map((o) => o.doctor_id))];
        const { data: docs } = await supabase.from("users").select("id, full_name").in("id", docIds);
        const docMap = Object.fromEntries((docs || []).map((d) => [d.id, d.full_name]));

        for (const o of opd) {
          recentVisits.push({
            id: o.id,
            type: "opd",
            label: `OPD — Dr. ${docMap[o.doctor_id] || "Doctor"} (${new Date(o.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })})`,
          });
        }
      }

      const { data: ipd } = await supabase
        .from("admissions")
        .select("id, admitted_at, ward_id")
        .eq("patient_id", session.patientId)
        .eq("hospital_id", session.hospitalId)
        .order("admitted_at", { ascending: false })
        .limit(3);

      if (ipd?.length) {
        const wardIds = [...new Set(ipd.map((a) => a.ward_id))];
        const { data: wards } = await supabase.from("wards").select("id, name").in("id", wardIds);
        const wardMap = Object.fromEntries((wards || []).map((w) => [w.id, w.name]));

        for (const a of ipd) {
          recentVisits.push({
            id: a.id,
            type: "ipd",
            label: `IPD — ${wardMap[a.ward_id] || "Ward"} (${new Date(a.admitted_at!).toLocaleDateString("en-IN", { day: "numeric", month: "short" })})`,
          });
        }
      }

      setVisits(recentVisits);
    })();
  }, [session]);

  const handleSubmit = async () => {
    if (overall === 0) return;
    setLoading(true);

    const selected = visits.find((v) => v.id === selectedVisit);

    await supabase.from("patient_feedback").insert({
      hospital_id: session.hospitalId,
      patient_id: session.patientId,
      overall_rating: overall,
      doctor_rating: doctor || null,
      nursing_rating: nursing || null,
      facility_rating: facility || null,
      comments: comments.trim() || null,
      would_recommend: recommend,
      encounter_id: selected?.type === "opd" ? selected.id : null,
      admission_id: selected?.type === "ipd" ? selected.id : null,
    } as any);

    setSubmitted(true);
    setLoading(false);
  };

  if (submitted) {
    return (
      <div className="px-4 py-16 text-center">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "#DCFCE7" }}>
          <span className="text-3xl">✅</span>
        </div>
        <h2 className="text-lg font-bold" style={{ color: "#0F172A" }}>Thank you for your feedback!</h2>
        <p className="text-sm mt-2" style={{ color: "#64748B" }}>
          Your response helps us improve care for everyone.
        </p>

        <div className="mt-4 flex justify-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star key={n} size={28} fill={n <= overall ? "#F59E0B" : "none"} color={n <= overall ? "#F59E0B" : "#CBD5E1"} />
          ))}
        </div>
        <p className="text-sm font-bold mt-1" style={{ color: "#0F172A" }}>{overall} Stars — {LABELS[overall]}</p>

        {overall >= 4 && (
          <div className="mt-6 p-4 rounded-xl" style={{ background: "#F0FDF4", border: "1px solid #BBF7D0" }}>
            <p className="text-xs font-medium mb-2" style={{ color: "#15803D" }}>
              Happy with your experience? Share it online!
            </p>
            <button
              onClick={() => window.open("https://g.page/review", "_blank", "noopener,noreferrer")}
              className="flex items-center justify-center gap-2 mx-auto px-4 py-2 rounded-lg text-xs font-bold text-white"
              style={{ background: "#15803D" }}
            >
              <Star size={14} fill="white" />
              Write a Google Review
              <ExternalLink size={12} />
            </button>
          </div>
        )}

        <Link to="/portal/dashboard" className="inline-block mt-6 text-sm font-bold" style={{ color: "#0E7B7B" }}>
          ← Back to Home
        </Link>
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      <h2 className="text-lg font-bold text-center" style={{ color: "#0F172A" }}>
        How was your experience?
      </h2>
      <p className="text-[13px] text-center mb-4" style={{ color: "#64748B" }}>{session.hospitalName}</p>

      <div className="space-y-3">
        {/* Visit selector */}
        {visits.length > 0 && (
          <div className="bg-white rounded-xl p-3.5" style={{ border: "1px solid #E2E8F0" }}>
            <p className="text-xs font-bold mb-2" style={{ color: "#0F172A" }}>For which visit?</p>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: "#374151" }}>
                <input
                  type="radio"
                  name="visit"
                  checked={selectedVisit === "general"}
                  onChange={() => setSelectedVisit("general")}
                  style={{ accentColor: "#0E7B7B" }}
                />
                General Feedback
              </label>
              {visits.map((v) => (
                <label key={v.id} className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: "#374151" }}>
                  <input
                    type="radio"
                    name="visit"
                    checked={selectedVisit === v.id}
                    onChange={() => setSelectedVisit(v.id)}
                    style={{ accentColor: "#0E7B7B" }}
                  />
                  {v.label}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Overall rating - prominent */}
        <div className="bg-white rounded-xl p-4 text-center" style={{ border: "1px solid #E2E8F0" }}>
          <p className="text-xs font-bold mb-3" style={{ color: "#0F172A" }}>Overall Experience *</p>
          <div className="flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => setOverall(n)} className="p-0.5 transition-transform active:scale-110">
                <Star size={40} fill={n <= overall ? "#0E7B7B" : "none"} color={n <= overall ? "#0E7B7B" : "#CBD5E1"} strokeWidth={1.5} />
              </button>
            ))}
          </div>
          {overall > 0 && (
            <p className="text-xs mt-2 font-medium" style={{ color: "#0E7B7B" }}>{LABELS[overall]}</p>
          )}
        </div>

        {/* Specific ratings */}
        <div className="bg-white rounded-xl p-3.5 space-y-3" style={{ border: "1px solid #E2E8F0" }}>
          <MiniRating label="Doctor" value={doctor} onChange={setDoctor} />
          <MiniRating label="Nursing Staff" value={nursing} onChange={setNursing} />
          <MiniRating label="Facilities" value={facility} onChange={setFacility} />
        </div>

        {/* Would recommend */}
        <div className="bg-white rounded-xl p-3.5" style={{ border: "1px solid #E2E8F0" }}>
          <p className="text-xs font-bold mb-2" style={{ color: "#0F172A" }}>Would you recommend us to friends & family?</p>
          <div className="flex gap-2">
            {[true, false].map((val) => (
              <button
                key={String(val)}
                onClick={() => setRecommend(val)}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors"
                style={{
                  border: `1.5px solid ${recommend === val ? "#0E7B7B" : "#E2E8F0"}`,
                  background: recommend === val ? "#EEF9F9" : "#FFFFFF",
                  color: recommend === val ? "#0E7B7B" : "#64748B",
                }}
              >
                {val ? "👍 Yes" : "👎 No"}
              </button>
            ))}
          </div>
        </div>

        {/* Comments */}
        <div className="bg-white rounded-xl p-3.5" style={{ border: "1px solid #E2E8F0" }}>
          <p className="text-xs font-bold mb-2" style={{ color: "#0F172A" }}>Tell us more (optional)</p>
          <textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="What went well? What could be improved?"
            rows={4}
            className="w-full text-sm px-3 py-2 rounded-lg outline-none resize-none"
            style={{ border: "1.5px solid #E2E8F0", color: "#0F172A" }}
            maxLength={500}
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading || overall === 0}
          className="w-full font-bold text-[15px] text-white rounded-xl disabled:opacity-40 active:scale-[0.97] transition-transform"
          style={{ height: 52, background: "#0E7B7B" }}
        >
          {loading ? "Submitting..." : "Submit Feedback"}
        </button>
      </div>
    </div>
  );
};

const MiniRating: React.FC<{ label: string; value: number; onChange: (v: number) => void }> = ({ label, value, onChange }) => (
  <div className="flex items-center justify-between">
    <span className="text-xs font-medium" style={{ color: "#374151" }}>{label}</span>
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} onClick={() => onChange(n)} className="p-0.5">
          <Star size={24} fill={n <= value ? "#F59E0B" : "none"} color={n <= value ? "#F59E0B" : "#CBD5E1"} strokeWidth={1.5} />
        </button>
      ))}
    </div>
  </div>
);

export default PortalFeedback;
