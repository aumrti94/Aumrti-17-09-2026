import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";

interface Props { hospitalId: string | null; }

const BMWLogTab: React.FC<Props> = ({ hospitalId }) => {
  const [records, setRecords] = useState<any[]>([]);

  useEffect(() => {
    if (!hospitalId) return;
    supabase.from("bmw_records").select("*, wards(name)").eq("hospital_id", hospitalId)
      .order("record_date", { ascending: false }).limit(50)
      .then(({ data }) => setRecords(data || []));
  }, [hospitalId]);

  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      {/* Compliance Note */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
        <strong>CPCB Compliance:</strong> Biomedical waste must be collected daily. Colour-coding per BMW Rules 2016:
        🟡 Yellow = Anatomical | 🔴 Red = Contaminated | 🔵 Blue = Glass | ⚪ White = Sharps
      </div>

      {/* History Table */}
      <div className="flex-1 overflow-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Date</TableHead>
              <TableHead className="text-xs">Ward</TableHead>
              <TableHead className="text-xs">🟡 Yellow</TableHead>
              <TableHead className="text-xs">🔴 Red</TableHead>
              <TableHead className="text-xs">🔵 Blue</TableHead>
              <TableHead className="text-xs">⚪ White</TableHead>
              <TableHead className="text-xs">⚫ Black</TableHead>
              <TableHead className="text-xs">🧪 Cyto</TableHead>
              <TableHead className="text-xs font-bold">Total kg</TableHead>
              <TableHead className="text-xs">Agency</TableHead>
              <TableHead className="text-xs">Manifest</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map(r => (
              <TableRow key={r.id}>
                <TableCell className="text-xs font-mono">{format(new Date(r.record_date), "dd/MM/yyyy")}</TableCell>
                <TableCell className="text-xs">{r.wards?.name || r.ward_name || "—"}</TableCell>
                <TableCell className="text-xs">{r.yellow_bag_kg || 0}</TableCell>
                <TableCell className="text-xs">{r.red_bag_kg || 0}</TableCell>
                <TableCell className="text-xs">{r.blue_bag_kg || 0}</TableCell>
                <TableCell className="text-xs">{r.white_bag_kg || 0}</TableCell>
                <TableCell className="text-xs">{r.black_bag_kg || 0}</TableCell>
                <TableCell className="text-xs">{r.cytotoxic_kg || 0}</TableCell>
                <TableCell className="text-xs font-bold font-mono">{r.total_kg || 0}</TableCell>
                <TableCell className="text-xs">{r.disposal_agency || "—"}</TableCell>
                <TableCell className="text-xs font-mono">{r.cpcb_manifest_no || "—"}</TableCell>
              </TableRow>
            ))}
            {records.length === 0 && (
              <TableRow><TableCell colSpan={11} className="text-center text-xs text-muted-foreground py-8">No BMW records yet</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default BMWLogTab;
