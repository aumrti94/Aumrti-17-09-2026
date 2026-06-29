import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { User, Phone, Calendar, Droplets, MapPin, AlertCircle, Users, Edit2, Check, X as XIcon } from "lucide-react";
import type { PortalSession } from "./PortalLogin";

interface PatientProfile {
  full_name: string;
  uhid: string;
  phone: string | null;
  email: string | null;
  gender: string | null;
  dob: string | null;
  blood_group: string | null;
  address: string | null;
  allergies: string | null;
}

interface FamilyMember {
  id: string;
  full_name: string;
  uhid: string;
  dob: string | null;
  gender: string | null;
}

const PortalProfilePage: React.FC<{ session: PortalSession }> = ({ session }) => {
  const [profile, setProfile]         = useState<PatientProfile | null>(null);
  const [family, setFamily]           = useState<FamilyMember[]>([]);
  const [loading, setLoading]         = useState(true);
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailValue, setEmailValue]   = useState("");
  const [savingEmail, setSavingEmail] = useState(false);

  useEffect(() => { load(); }, [session]);

  const load = async () => {
    const { data } = await (supabase as any)
      .from("patients")
      .select("full_name, uhid, phone, email, gender, dob, blood_group, address, allergies")
      .eq("id", session.patientId)
      .maybeSingle();

    if (data) {
      setProfile(data as PatientProfile);
      setEmailValue(data.email ?? "");
    }

    // Other patients on the same phone (family members)
    const clean = session.phone.replace(/\D/g, "");
    if (clean.length >= 10) {
      const { data: fam } = await supabase
        .from("patients")
        .select("id, full_name, uhid, dob, gender")
        .eq("hospital_id", session.hospitalId)
        .ilike("phone", `%${clean.slice(-10)}`)
        .neq("id", session.patientId)
        .limit(10);
      setFamily((fam as FamilyMember[]) || []);
    }

    setLoading(false);
  };

  const saveEmail = async () => {
    setSavingEmail(true);
    await (supabase as any)
      .from("patients")
      .update({ email: emailValue })
      .eq("id", session.patientId);
    setProfile(p => p ? { ...p, email: emailValue } : p);
    setSavingEmail(false);
    setEditingEmail(false);
  };

  const fmtDob = (dob: string | null) => {
    if (!dob) return null;
    try {
      const d   = new Date(dob);
      const age = Math.floor((Date.now() - d.getTime()) / (365.25 * 86400000));
      return `${d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} (${age} yrs)`;
    } catch { return dob; }
  };

  const initials = session.fullName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-6 h-6 border-2 rounded-full animate-spin"
          style={{ borderColor: "#E2E8F0", borderTopColor: "#0E7B7B" }} />
      </div>
    );
  }

  const InfoRow = ({
    icon, label, value,
  }: { icon: React.ReactNode; label: string; value: string | null }) =>
    value ? (
      <div className="flex items-start gap-3 py-2.5" style={{ borderBottom: "1px solid #F1F5F9" }}>
        <span className="mt-0.5 shrink-0" style={{ color: "#94A3B8" }}>{icon}</span>
        <div>
          <p className="text-[10px] font-medium uppercase" style={{ color: "#94A3B8" }}>{label}</p>
          <p className="text-sm" style={{ color: "#0F172A" }}>{value}</p>
        </div>
      </div>
    ) : null;

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Avatar + name */}
      <div className="bg-white rounded-xl p-4 flex items-center gap-4" style={{ border: "1px solid #E2E8F0" }}>
        <div
          className="flex items-center justify-center rounded-full text-white font-bold text-xl shrink-0"
          style={{ width: 60, height: 60, background: "#0E7B7B" }}
        >
          {initials}
        </div>
        <div>
          <p className="font-bold text-base" style={{ color: "#0F172A" }}>{session.fullName}</p>
          <p className="text-xs mt-0.5" style={{ color: "#64748B" }}>UHID: {session.uhid}</p>
          {session.bloodGroup && (
            <span
              className="inline-block text-[10px] px-1.5 py-0.5 rounded-full font-medium mt-1"
              style={{ background: "#FEF2F2", color: "#DC2626" }}
            >
              🩸 {session.bloodGroup}
            </span>
          )}
        </div>
      </div>

      {/* Demographics */}
      <div className="bg-white rounded-xl px-4 pt-1 pb-2" style={{ border: "1px solid #E2E8F0" }}>
        <p className="text-[10px] font-bold uppercase pt-3 mb-0.5" style={{ color: "#94A3B8" }}>
          Personal Information
        </p>
        <InfoRow icon={<Phone size={14} />}        label="Phone"       value={session.phone}                  />
        <InfoRow icon={<Calendar size={14} />}     label="Date of Birth" value={fmtDob(profile?.dob ?? null)} />
        <InfoRow icon={<User size={14} />}         label="Gender"      value={profile?.gender ?? null}        />
        <InfoRow icon={<Droplets size={14} />}     label="Blood Group" value={profile?.blood_group ?? null}   />
        <InfoRow icon={<MapPin size={14} />}       label="Address"     value={profile?.address ?? null}       />
        <InfoRow icon={<AlertCircle size={14} />}  label="Allergies"   value={profile?.allergies ?? null}     />

        {/* Editable email */}
        <div className="flex items-start gap-3 py-2.5">
          <span className="mt-0.5 shrink-0" style={{ color: "#94A3B8" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
          </span>
          <div className="flex-1">
            <p className="text-[10px] font-medium uppercase" style={{ color: "#94A3B8" }}>Email</p>
            {editingEmail ? (
              <div className="flex items-center gap-1 mt-0.5">
                <input
                  type="email"
                  value={emailValue}
                  onChange={e => setEmailValue(e.target.value)}
                  className="flex-1 text-sm border rounded px-2 py-0.5 outline-none"
                  style={{ borderColor: "#0E7B7B", color: "#0F172A" }}
                  autoFocus
                />
                <button
                  onClick={saveEmail}
                  disabled={savingEmail}
                  style={{ color: "#059669" }}
                  className="p-1 rounded"
                >
                  <Check size={15} />
                </button>
                <button
                  onClick={() => { setEditingEmail(false); setEmailValue(profile?.email ?? ""); }}
                  style={{ color: "#EF4444" }}
                  className="p-1 rounded"
                >
                  <XIcon size={15} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-sm" style={{ color: "#0F172A" }}>
                  {profile?.email || <span style={{ color: "#94A3B8" }}>Not set</span>}
                </p>
                <button onClick={() => setEditingEmail(true)} style={{ color: "#0E7B7B" }}>
                  <Edit2 size={12} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Family members */}
      {family.length > 0 && (
        <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #E2E8F0" }}>
          <div className="flex items-center gap-2 px-4 pt-3 pb-1.5">
            <Users size={14} color="#0E7B7B" />
            <p className="text-[10px] font-bold uppercase" style={{ color: "#94A3B8" }}>
              Family Members
            </p>
          </div>
          {family.map((m, i) => {
            const fi  = m.full_name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
            const age = m.dob
              ? Math.floor((Date.now() - new Date(m.dob).getTime()) / (365.25 * 86400000))
              : null;
            return (
              <div
                key={m.id}
                className="flex items-center gap-3 px-4 py-3"
                style={{ borderTop: "1px solid #F1F5F9" }}
              >
                <div
                  className="flex items-center justify-center rounded-full text-white text-xs font-bold shrink-0"
                  style={{ width: 36, height: 36, background: "#64748B" }}
                >
                  {fi}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "#0F172A" }}>
                    {m.full_name}
                  </p>
                  <p className="text-[11px]" style={{ color: "#94A3B8" }}>
                    UHID: {m.uhid}
                    {age !== null ? ` · ${age} yrs` : ""}
                    {m.gender ? ` · ${m.gender}` : ""}
                  </p>
                </div>
              </div>
            );
          })}
          <div className="px-4 py-2.5" style={{ borderTop: "1px solid #F1F5F9" }}>
            <p className="text-[10px]" style={{ color: "#94A3B8" }}>
              Other patients registered with the same mobile number. Log out and re-login to
              access a different family member's records.
            </p>
          </div>
        </div>
      )}

      {/* Privacy note */}
      <div className="rounded-xl p-3 text-[11px]" style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", color: "#64748B" }}>
        <p className="font-bold mb-0.5">🔒 Data Privacy (DPDP Act 2023)</p>
        <p>
          For corrections to name, date of birth, or other registered details please contact
          hospital reception. You can download all your health records from the Home screen.
        </p>
      </div>
    </div>
  );
};

export default PortalProfilePage;
