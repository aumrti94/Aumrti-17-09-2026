import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  system: string;
}

export default function PrescriptionsTab({ system }: Props) {
  const [encounters, setEncounters] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);

  useEffect(() => {
    loadEncounters();
  }, [system]);

  const loadEncounters = async () => {
    const { data } = await supabase.from("ayush_encounters").select("*")
      .eq("system", system).order("encounter_date", { ascending: false }).limit(50);
    if (data) setEncounters(data);
  };

  const filtered = search
    ? encounters.filter((e) =>
        e.chief_complaint?.toLowerCase().includes(search.toLowerCase()) ||
        e.ayurvedic_diagnosis?.toLowerCase().includes(search.toLowerCase())
      )
    : encounters;

  return (
    <div className="flex h-full overflow-hidden">
      {/* List */}
      <div className="w-[340px] border-r flex flex-col">
        <div className="p-3 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search prescriptions..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9 text-sm" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.map((enc) => (
            <button
              key={enc.id}
              className={`w-full text-left px-3 py-2 border-b text-sm hover:bg-accent/50 ${selected?.id === enc.id ? "bg-accent" : ""}`}
              onClick={() => setSelected(enc)}
            >
              <div className="flex justify-between items-start">
                <p className="font-medium truncate text-xs">{enc.chief_complaint}</p>
                <Badge variant="outline" className="text-[10px] shrink-0 ml-2">{enc.system}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {new Date(enc.encounter_date).toLocaleDateString("en-IN")}
                {enc.ayurvedic_diagnosis && ` · ${enc.ayurvedic_diagnosis}`}
              </p>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">No prescriptions found</p>
          )}
        </div>
      </div>

      {/* Detail */}
      <div className="flex-1 overflow-y-auto p-4">
        {!selected ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Select a consultation to view prescription</div>
        ) : (
          <div className="space-y-4">
            <Card className="shadow-none">
              <CardContent className="p-4 space-y-2">
                <div className="flex justify-between">
                  <div>
                    <p className="text-sm font-bold">{selected.chief_complaint}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(selected.encounter_date).toLocaleDateString("en-IN")} · {selected.system}
                    </p>
                  </div>
                  {selected.ayurvedic_diagnosis && (
                    <Badge variant="secondary">{selected.ayurvedic_diagnosis}</Badge>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Prescription items */}
            {Array.isArray(selected.prescription) && selected.prescription.length > 0 && (
              <Card className="shadow-none">
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Medicine</TableHead>
                        <TableHead className="text-xs">Formulation</TableHead>
                        <TableHead className="text-xs">Dose</TableHead>
                        <TableHead className="text-xs">Anupana</TableHead>
                        <TableHead className="text-xs">Frequency</TableHead>
                        <TableHead className="text-xs">Duration</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(selected.prescription as any[]).map((rx: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs font-medium">{rx.drug_name}</TableCell>
                          <TableCell className="text-xs">{rx.formulation_type}</TableCell>
                          <TableCell className="text-xs">{rx.dose}</TableCell>
                          <TableCell className="text-xs">{rx.anupana}</TableCell>
                          <TableCell className="text-xs">{rx.frequency}</TableCell>
                          <TableCell className="text-xs">{rx.duration}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {/* Diet & Lifestyle */}
            <div className="grid grid-cols-2 gap-3">
              {selected.diet_advice && (
                <Card className="shadow-none">
                  <CardContent className="p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Diet Advice</p>
                    <p className="text-sm">{selected.diet_advice}</p>
                  </CardContent>
                </Card>
              )}
              {selected.lifestyle_advice && (
                <Card className="shadow-none">
                  <CardContent className="p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Lifestyle Advice</p>
                    <p className="text-sm">{selected.lifestyle_advice}</p>
                  </CardContent>
                </Card>
              )}
            </div>

            {selected.follow_up_days && (
              <Badge variant="outline">Follow-up in {selected.follow_up_days} days</Badge>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
