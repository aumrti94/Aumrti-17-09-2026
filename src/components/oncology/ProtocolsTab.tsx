import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";

const ProtocolsTab: React.FC = () => {
  const [protocols, setProtocols] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any | null>(null);

  useEffect(() => {
    (supabase as any).from("chemo_protocols").select("*").eq("is_active", true).order("protocol_name").then(({ data }: any) => setProtocols(data || []));
  }, []);

  const filtered = protocols.filter((p: any) =>
    p.protocol_name.toLowerCase().includes(search.toLowerCase()) ||
    p.cancer_type.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-3 mt-3">
      <Input placeholder="Search by protocol or cancer type..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((p: any) => (
          <Card key={p.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setSelected(p)}>
            <CardContent className="p-3">
              <p className="text-sm font-bold">{p.protocol_name}</p>
              <Badge variant="outline" className="text-[10px] mt-1">{p.cancer_type}</Badge>
              <div className="flex gap-3 mt-2 text-[11px] text-muted-foreground">
                <span>{p.total_cycles} cycles</span>
                <span>q{p.cycle_duration_days}d</span>
                <span>{((p.drugs as any[]) || []).length} drugs</span>
              </div>
              {p.reference && <p className="text-[10px] text-muted-foreground mt-1">Ref: {p.reference}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {selected && (
        <Card className="mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{selected.protocol_name} — {selected.cancer_type}</CardTitle>
            <p className="text-xs text-muted-foreground">{selected.total_cycles} cycles · Every {selected.cycle_duration_days} days · {selected.reference}</p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Drug</TableHead>
                  <TableHead>Dose (mg/m²)</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Day</TableHead>
                  <TableHead>Infusion Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {((selected.drugs as any[]) || []).map((d: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{d.drug_name}</TableCell>
                    <TableCell>{d.dose_mg_m2}</TableCell>
                    <TableCell>{d.route}</TableCell>
                    <TableCell>Day {d.day_of_cycle}</TableCell>
                    <TableCell>{d.infusion_time_min > 0 ? `${d.infusion_time_min} min` : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ProtocolsTab;
