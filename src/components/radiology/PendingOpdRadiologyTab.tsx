import React, { useState, useEffect, useCallback } from "react";
import { ScanLine, Phone, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getPendingInvestigations, type PendingInvestigationRow } from "@/lib/pendingInvestigations";
import { formatCurrency } from "@/lib/currency";

interface Props {
  hospitalId: string;
  onCreateOrder: (
    patient: { id: string; full_name: string; uhid: string },
    studyNames: string[],
    encounterId: string
  ) => void;
  onCountChange?: (count: number) => void;
}

const fmt = (d: string) => {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

const PendingOpdRadiologyTab: React.FC<Props> = ({ hospitalId, onCreateOrder, onCountChange }) => {
  const [rows, setRows] = useState<PendingInvestigationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const today = new Date().toISOString().split("T")[0];

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getPendingInvestigations(hospitalId, { start: today, end: today });
    // Only rows with pending radiology studies
    const radRows = data.filter(r => r.pendingRadiologyStudies.length > 0);
    setRows(radRows);
    onCountChange?.(radRows.length);
    setLoading(false);
  }, [hospitalId, today, onCountChange]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="animate-spin text-muted-foreground" size={20} />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScanLine size={16} className="text-primary" />
          <span className="text-[14px] font-semibold">Pending Radiology Orders from OPD</span>
          <Badge className="text-[10px] px-1.5 py-0 rounded-full bg-amber-100 text-amber-700 border-amber-200">
            {rows.length} patients
          </Badge>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={load}>
          <RefreshCw size={11} /> Refresh
        </Button>
      </div>

      <p className="text-[12px] text-muted-foreground">
        Doctors wrote these radiology studies in today's OPD prescriptions but no radiology order has been created yet.
      </p>

      {rows.length === 0 ? (
        <div className="py-16 text-center">
          <ScanLine size={36} className="mx-auto text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">No pending radiology investigations for today</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div
              key={row.encounterId}
              className="border border-border rounded-lg bg-card px-4 py-3 flex items-start justify-between gap-3"
            >
              {/* Patient + studies */}
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-semibold text-foreground">{row.patientName}</span>
                  <span className="text-[11px] text-muted-foreground font-mono">{row.uhid}</span>
                  {row.phone && (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Phone size={10} /> {row.phone}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>Dr. {row.doctorName}</span>
                  <span>·</span>
                  <span>{fmt(row.encounterDate)} {row.encounterTime}</span>
                </div>

                {/* Pending study chips */}
                <div className="flex flex-wrap gap-1.5">
                  {row.pendingRadiologyStudies.map((name) => (
                    <span
                      key={name}
                      className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-blue-200 bg-blue-50 text-blue-700"
                    >
                      <ScanLine size={9} /> {name}
                    </span>
                  ))}
                </div>

                {row.estimatedRevenue > 0 && (
                  <p className="text-[11px] text-emerald-700">
                    Est. revenue: {formatCurrency(row.estimatedRevenue)}
                  </p>
                )}
              </div>

              {/* Action */}
              <Button
                size="sm"
                className="h-8 text-[12px] shrink-0"
                onClick={() =>
                  onCreateOrder(
                    { id: row.patientId, full_name: row.patientName, uhid: row.uhid },
                    row.pendingRadiologyStudies,
                    row.encounterId
                  )
                }
              >
                Create Order
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PendingOpdRadiologyTab;
