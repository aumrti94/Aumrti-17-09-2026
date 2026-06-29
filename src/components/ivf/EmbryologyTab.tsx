import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Save } from "lucide-react";

interface EmbryoRecord {
  id: string;
  embryo_number: string;
  day0_oocyte: string;
  day1_fert: string;
  day3_cleavage: string;
  day5_blastocyst: string;
  status: "active" | "transferred" | "frozen" | "discarded";
}

interface EmbryologyTabProps {
  patientId: string;
  hospitalId: string;
  userId: string | null;
}

const EmbryologyTab: React.FC<EmbryologyTabProps> = ({ patientId, hospitalId, userId }) => {
  const [embryos, setEmbryos] = useState<EmbryoRecord[]>([
    { id: "1", embryo_number: "E-01", day0_oocyte: "MII", day1_fert: "2PN", day3_cleavage: "8C, Gr 1", day5_blastocyst: "4AA", status: "frozen" },
    { id: "2", embryo_number: "E-02", day0_oocyte: "MII", day1_fert: "2PN", day3_cleavage: "6C, Gr 2", day5_blastocyst: "3BB", status: "transferred" },
    { id: "3", embryo_number: "E-03", day0_oocyte: "MI", day1_fert: "0PN", day3_cleavage: "", day5_blastocyst: "", status: "discarded" },
  ]);

  const addEmbryo = () => {
    const newNum = `E-${String(embryos.length + 1).padStart(2, "0")}`;
    setEmbryos([
      ...embryos,
      { id: Date.now().toString(), embryo_number: newNum, day0_oocyte: "", day1_fert: "", day3_cleavage: "", day5_blastocyst: "", status: "active" }
    ]);
  };

  const updateEmbryo = (index: number, field: keyof EmbryoRecord, value: string) => {
    const updated = [...embryos];
    updated[index] = { ...updated[index], [field]: value };
    setEmbryos(updated);
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "transferred": return "default";
      case "frozen": return "secondary";
      case "discarded": return "destructive";
      default: return "outline"; // active
    }
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-semibold text-foreground">Embryo Development Tracking (Day 0 - Day 6)</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={addEmbryo}>
            <Plus className="w-4 h-4 mr-2" /> Add Oocyte
          </Button>
          <Button size="sm">
            <Save className="w-4 h-4 mr-2" /> Save Records
          </Button>
        </div>
      </div>

      <div className="border rounded-md flex-1 overflow-y-auto bg-card">
        <Table>
          <TableHeader className="bg-muted/50 sticky top-0 z-10 shadow-sm">
            <TableRow>
              <TableHead className="w-20 text-[14px]">ID</TableHead>
              <TableHead className="text-[14px]">Day 0 (Oocyte)</TableHead>
              <TableHead className="text-[14px]">Day 1 (Fertilization)</TableHead>
              <TableHead className="text-[14px]">Day 3 (Cleavage)</TableHead>
              <TableHead className="text-[14px]">Day 5/6 (Blastocyst)</TableHead>
              <TableHead className="w-36 text-[14px]">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {embryos.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-[14px]">
                  No oocytes tracked yet. Click "Add Oocyte" to begin the cycle.
                </TableCell>
              </TableRow>
            ) : (
              embryos.map((embryo, idx) => (
                <TableRow key={embryo.id}>
                  <TableCell className="font-mono text-[14px] font-medium">{embryo.embryo_number}</TableCell>
                  <TableCell>
                    <Select value={embryo.day0_oocyte} onValueChange={(v) => updateEmbryo(idx, "day0_oocyte", v)}>
                      <SelectTrigger className="h-8 text-[14px] w-full"><SelectValue placeholder="Stage" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MII">MII (Mature)</SelectItem>
                        <SelectItem value="MI">MI (Immature)</SelectItem>
                        <SelectItem value="GV">GV (Germinal Vesicle)</SelectItem>
                        <SelectItem value="Degenerate">Degenerate</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select value={embryo.day1_fert} onValueChange={(v) => updateEmbryo(idx, "day1_fert", v)}>
                      <SelectTrigger className="h-8 text-[14px] w-full"><SelectValue placeholder="Check PN" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="2PN">2PN (Normal)</SelectItem>
                        <SelectItem value="1PN">1PN (Abnormal)</SelectItem>
                        <SelectItem value="3PN">3PN (Abnormal)</SelectItem>
                        <SelectItem value="0PN">0PN (Failed)</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 text-[14px]"
                      placeholder="e.g. 8C, Gr 1"
                      value={embryo.day3_cleavage}
                      onChange={(e) => updateEmbryo(idx, "day3_cleavage", e.target.value)}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 text-[14px]"
                      placeholder="Gardner (e.g. 4AA)"
                      value={embryo.day5_blastocyst}
                      onChange={(e) => updateEmbryo(idx, "day5_blastocyst", e.target.value)}
                    />
                  </TableCell>
                  <TableCell>
                    <Select value={embryo.status} onValueChange={(v) => updateEmbryo(idx, "status", v as any)}>
                      <SelectTrigger className="h-8 text-[13px] font-medium w-full border-none bg-transparent focus:ring-0">
                        <Badge variant={getStatusBadgeVariant(embryo.status)} className="capitalize px-2 py-0.5 rounded-sm whitespace-nowrap">
                          {embryo.status}
                        </Badge>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active (Culture)</SelectItem>
                        <SelectItem value="transferred">Transferred</SelectItem>
                        <SelectItem value="frozen">Frozen (Cryobank)</SelectItem>
                        <SelectItem value="discarded">Discarded</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default EmbryologyTab;