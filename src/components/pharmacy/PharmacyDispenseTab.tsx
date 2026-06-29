import React, { useState, useCallback } from "react";
import PrescriptionQueue, { type PrescriptionItem } from "./ip/PrescriptionQueue";
import DispensingWorkspace from "./ip/DispensingWorkspace";
import PatientStockPanel from "./ip/PatientStockPanel";
import RetailPOS from "./retail/RetailPOS";
import ManualDispenseModal from "./ip/ManualDispenseModal";

interface Props {
  hospitalId: string;
  mode: "ip" | "retail";
}

const PharmacyDispenseTab: React.FC<Props> = ({ hospitalId, mode }) => {
  const [selectedPrescription, setSelectedPrescription] = useState<PrescriptionItem | null>(null);
  const [patientInfo, setPatientInfo] = useState<any>(null);
  const [stockItems, setStockItems] = useState<{ drug_name: string; available: number; nearest_expiry?: string }[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [manualOpen, setManualOpen] = useState(false);

  const handleSelect = useCallback((item: PrescriptionItem) => {
    setSelectedPrescription(item);
  }, []);

  const handleDispensed = useCallback(() => {
    setSelectedPrescription(null);
    setPatientInfo(null);
    setStockItems([]);
    setRefreshKey(k => k + 1);
  }, []);

  const handlePatientLoaded = useCallback((p: any) => {
    setPatientInfo(p);
  }, []);

  const handleDrugsLoaded = useCallback((drugs: { drug_name: string; available: number; nearest_expiry?: string }[]) => {
    setStockItems(drugs);
  }, []);

  const handleManualCreated = useCallback((item: PrescriptionItem) => {
    setSelectedPrescription(item);
    setManualOpen(false);
  }, []);

  if (mode === "retail") {
    return <RetailPOS hospitalId={hospitalId} />;
  }

  return (
    <div className="h-full flex flex-row overflow-hidden">
      <PrescriptionQueue
        key={refreshKey}
        hospitalId={hospitalId}
        selectedId={selectedPrescription?.id || null}
        onSelect={handleSelect}
        onManualDispense={() => setManualOpen(true)}
      />
      <DispensingWorkspace
        hospitalId={hospitalId}
        prescription={selectedPrescription}
        onDispensed={handleDispensed}
        onPatientLoaded={handlePatientLoaded}
        onDrugsLoaded={handleDrugsLoaded}
      />
      <PatientStockPanel
        patient={patientInfo}
        stockItems={stockItems}
        todayDispensed={[]}
        todayTotal={0}
      />
      <ManualDispenseModal
        hospitalId={hospitalId}
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        onCreate={handleManualCreated}
      />
    </div>
  );
};

export default PharmacyDispenseTab;
