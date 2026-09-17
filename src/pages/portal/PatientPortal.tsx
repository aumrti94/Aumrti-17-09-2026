import React from "react";
import { Routes, Route, Navigate, useSearchParams } from "react-router-dom";
import { PatientPortalProvider } from "@/contexts/PatientPortalContext";
import { usePatientPortal } from "@/hooks/usePatientPortal";
import PatientPortalLogin from "./PatientPortalLogin";
import PatientPortalLayout from "./PatientPortalLayout";
import PortalDashboard from "./PortalDashboard";
import PortalAppointments from "./PortalAppointments";
import PatientPortalReportsPage from "./PatientPortalReportsPage";
import PatientPortalBillsPage from "./PatientPortalBillsPage";
import PortalPrescriptions from "./PortalPrescriptions";
import PortalFeedback from "./PortalFeedback";
import PortalTimeline from "./PortalTimeline";
import PortalTeleconsultPage from "./PortalTeleconsultPage";
import PortalProfilePage from "./PortalProfilePage";
import PortalChatPage from "./PortalChatPage";
import PortalHealthCoachPage from "./PortalHealthCoachPage";
import PortalHealthStoryPage from "./PortalHealthStoryPage";
import type { PortalSession } from "./portalTypes";

// ── Loading spinner ───────────────────────────────────────────────────────────
const Spinner: React.FC = () => (
  <div className="min-h-screen flex items-center justify-center" style={{ background: "#F8FAFC" }}>
    <div
      className="w-8 h-8 border-[3px] rounded-full animate-spin"
      style={{ borderColor: "#E2E8F0", borderTopColor: "#0E7B7B" }}
    />
  </div>
);

// ── Inner component (reads context, must be inside Provider) ─────────────────
const PortalContent: React.FC = () => {
  const { patient, hospital, loading, logout } = usePatientPortal();
  const [searchParams] = useSearchParams();
  const hospitalId = searchParams.get("h") || null;

  if (loading) return <Spinner />;

  // Not authenticated or no patient selected → show login
  if (!patient || !hospital) {
    return <PatientPortalLogin hospitalId={hospitalId} />;
  }

  // Derive PortalSession shape for backward-compat with existing page components
  const session: PortalSession = {
    patientId: patient.id,
    hospitalId: hospital.id,
    fullName: patient.fullName,
    uhid: patient.uhid,
    phone: patient.phone ?? "",
    hospitalName: hospital.name,
    hospitalLogo: hospital.logoUrl,
    bloodGroup: patient.bloodGroup,
  };

  return (
    <PatientPortalLayout
      hospitalName={hospital.name}
      hospitalLogo={hospital.logoUrl}
      patientName={patient.fullName}
      onLogout={logout}
    >
      <Routes>
        <Route path="dashboard"    element={<PortalDashboard session={session} />} />
        <Route path="appointments" element={<PortalAppointments session={session} />} />
        <Route path="reports"      element={<PatientPortalReportsPage />} />
        <Route path="bills"        element={<PatientPortalBillsPage />} />
        <Route path="prescriptions" element={<PortalPrescriptions session={session} />} />
        <Route path="timeline"     element={<PortalTimeline session={session} />} />
        <Route path="feedback"     element={<PortalFeedback session={session} />} />
        <Route path="teleconsult"   element={<PortalTeleconsultPage session={session} />} />
        <Route path="profile"       element={<PortalProfilePage session={session} />} />
        <Route path="chat"          element={<PortalChatPage />} />
        <Route path="health-coach"  element={<PortalHealthCoachPage />} />
        <Route path="health-story"  element={<PortalHealthStoryPage />} />
        <Route path="*"             element={<Navigate to="/portal/dashboard" replace />} />
      </Routes>
    </PatientPortalLayout>
  );
};

// ── Root export — wraps everything in the context provider ───────────────────
const PatientPortal: React.FC = () => (
  <PatientPortalProvider>
    <PortalContent />
  </PatientPortalProvider>
);

export default PatientPortal;
