import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Props {
  onRefreshKPIs: () => void;
}

const EmbryoBankTab = ({ onRefreshKPIs }: Props) => {
  const [inventory, setInventory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("embryo_bank")
      .select("*, art_couples(couple_code), embryology_records(blast_grade)")
      .eq("disposition", "stored")
      .order("freeze_date", { ascending: false });
    if (error) console.error(error);
    setInventory(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const daysUntilExpiry = (date: string | null) => {
    if (!date) return null;
    return Math.floor((new Date(date).getTime() - Date.now()) / 86400000);
  };

  const handleExportICMR = () => {
    const csv = [
      "Couple Code,Embryo Grade,Freeze Date,Freeze Method,Storage Location,Consent Expiry,Disposition",
      ...inventory.map((e) =>
        `${e.art_couples?.couple_code || ""},${e.embryology_records?.blast_grade || ""},${e.freeze_date},${e.freeze_method},${e.storage_location},${e.consent_expiry || ""},${e.disposition}`
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `icmr_embryo_registry_${new Date().toISOString().split("T")[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast.success("ICMR registry export downloaded");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Frozen Embryo Inventory ({inventory.length} stored)</h3>
        <Button size="sm" variant="outline" onClick={handleExportICMR}>📥 Export ICMR Format</Button>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Storage Location</TableHead>
              <TableHead>Couple</TableHead>
              <TableHead>Grade</TableHead>
              <TableHead>Freeze Date</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Consent Expiry</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : inventory.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No frozen embryos</TableCell></TableRow>
            ) : inventory.map((e) => {
              const days = daysUntilExpiry(e.consent_expiry);
              return (
                <TableRow key={e.id}>
                  <TableCell className="font-mono text-xs">{e.storage_location}</TableCell>
                  <TableCell className="font-mono">{e.art_couples?.couple_code || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{e.embryology_records?.blast_grade || "—"}</Badge>
                  </TableCell>
                  <TableCell>{e.freeze_date}</TableCell>
                  <TableCell className="capitalize">{e.freeze_method}</TableCell>
                  <TableCell>
                    {e.consent_expiry ? (
                      <div className="flex items-center gap-1">
                        <span>{e.consent_expiry}</span>
                        {days !== null && days <= 0 && (
                          <Badge variant="destructive" className="text-[10px]">🔴 EXPIRED</Badge>
                        )}
                        {days !== null && days > 0 && days <= 30 && (
                          <Badge className="bg-amber-500 text-[10px]">⚠️ {days}d</Badge>
                        )}
                      </div>
                    ) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="default" className="bg-blue-600">Stored</Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* Consent alerts */}
      {inventory.some((e) => {
        const d = daysUntilExpiry(e.consent_expiry);
        return d !== null && d <= 30;
      }) && (
        <Card className="p-3 border-amber-300 bg-amber-50">
          <p className="text-sm font-semibold text-amber-900">⚠️ Consent Renewal Required</p>
          <p className="text-xs text-amber-800 mt-1">
            Some embryos have consent expiring within 30 days. Per ICMR ART Act 2021,
            annual consent renewal is mandatory for continued cryopreservation.
            Contact couples for renewal or disposition decision.
          </p>
        </Card>
      )}
    </div>
  );
};

export default EmbryoBankTab;
