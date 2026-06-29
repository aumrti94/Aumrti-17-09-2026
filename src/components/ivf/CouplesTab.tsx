import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import PatientSearchPicker from "@/components/shared/PatientSearchPicker";

interface Props {
  showRegister: boolean;
  onCloseRegister: () => void;
  onRefreshKPIs: () => void;
}

const CouplesTab = ({ showRegister, onCloseRegister, onRefreshKPIs }: Props) => {
  const [couples, setCouples] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCouple, setSelectedCouple] = useState<any>(null);

  // Form state
  const [femaleId, setFemaleId] = useState("");
  const [femaleName, setFemaleName] = useState("");
  const [maleId, setMaleId] = useState("");
  const [maleName, setMaleName] = useState("");
  const [indication, setIndication] = useState("");
  const [amh, setAmh] = useState("");
  const [afc, setAfc] = useState("");
  const [icmrReg, setIcmrReg] = useState("");
  const [consentObtained, setConsentObtained] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadCouples = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("art_couples")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) { console.error(error); toast.error("Failed to load couples"); }
    else setCouples(data || []);
    setLoading(false);
  };

  useEffect(() => { loadCouples(); }, []);

  const handleRegister = async () => {
    if (!femaleId) { toast.error("Female patient is required"); return; }
    if (!consentObtained) { toast.error("ICMR ART Act 2021 requires informed consent before any ART procedure"); return; }

    setSaving(true);
    const { data: userData } = await supabase.from("users").select("id, hospital_id").limit(1).maybeSingle();
    if (!userData) { toast.error("User session not found"); setSaving(false); return; }

    const code = `ART-${new Date().getFullYear()}-${String(couples.length + 1).padStart(3, "0")}`;

    const { error } = await supabase.from("art_couples").insert({
      hospital_id: userData.hospital_id,
      couple_code: code,
      female_patient_id: femaleId,
      male_patient_id: maleId || null,
      treating_doctor: userData.id,
      indication: indication || null,
      amh_level: amh ? parseFloat(amh) : null,
      afc_count: afc ? parseInt(afc) : null,
      consent_obtained: true,
      icmr_reg_number: icmrReg || null,
      registered_at: new Date().toISOString().split("T")[0],
    });

    if (error) { console.error(error); toast.error("Failed to register couple"); }
    else {
      toast.success("Couple registered successfully");
      onCloseRegister();
      resetForm();
      loadCouples();
      onRefreshKPIs();
    }
    setSaving(false);
  };

  const resetForm = () => {
    setFemaleId(""); setFemaleName(""); setMaleId(""); setMaleName("");
    setIndication(""); setAmh(""); setAfc(""); setIcmrReg("");
    setConsentObtained(false);
  };

  return (
    <div className="space-y-4">
      {/* Couple List */}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Couple Code</TableHead>
              <TableHead>Female Patient</TableHead>
              <TableHead>Indication</TableHead>
              <TableHead>AMH</TableHead>
              <TableHead>AFC</TableHead>
              <TableHead>Consent</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : couples.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No couples registered yet</TableCell></TableRow>
            ) : couples.map((c) => (
              <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedCouple(c)}>
                <TableCell className="font-mono font-medium">{c.couple_code}</TableCell>
                <TableCell>{c.female_patient_id?.slice(0, 8)}…</TableCell>
                <TableCell>{c.indication || "—"}</TableCell>
                <TableCell className="font-mono">{c.amh_level ?? "—"}</TableCell>
                <TableCell className="font-mono">{c.afc_count ?? "—"}</TableCell>
                <TableCell>
                  {c.consent_obtained
                    ? <Badge variant="default" className="bg-green-600">✓ Obtained</Badge>
                    : <Badge variant="destructive">Missing</Badge>}
                </TableCell>
                <TableCell>
                  <Badge variant={c.is_active ? "default" : "secondary"}>
                    {c.is_active ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Register Couple Modal */}
      <Dialog open={showRegister} onOpenChange={(o) => { if (!o) onCloseRegister(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Register ART Couple</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Female Patient *</Label>
              <PatientSearchPicker
                hospitalId=""
                value={femaleId}
                onChange={(id) => { setFemaleId(id); }}
              />
            </div>
            <div>
              <Label>Male Patient</Label>
              <PatientSearchPicker
                hospitalId=""
                value={maleId}
                onChange={(id) => { setMaleId(id); }}
              />
            </div>
            <div>
              <Label>Indication</Label>
              <Input value={indication} onChange={(e) => setIndication(e.target.value)}
                placeholder="Tubal factor, Male factor, Unexplained, PCOS…" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>AMH Level (ng/mL)</Label>
                <Input type="number" step="0.01" value={amh} onChange={(e) => setAmh(e.target.value)} />
              </div>
              <div>
                <Label>AFC Count</Label>
                <Input type="number" value={afc} onChange={(e) => setAfc(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>ICMR Registration Number</Label>
              <Input value={icmrReg} onChange={(e) => setIcmrReg(e.target.value)} />
            </div>

            <Card className="p-3 border-amber-300 bg-amber-50">
              <p className="text-sm font-medium text-amber-900 mb-2">
                ⚠️ ICMR ART Act 2021 Compliance
              </p>
              <p className="text-xs text-amber-800 mb-3">
                Informed consent from both partners is mandatory before any ART procedure.
                Ensure physical consent form is signed and documented.
              </p>
              <div className="flex items-center gap-2">
                <Switch checked={consentObtained} onCheckedChange={setConsentObtained} />
                <Label className="text-sm font-medium">Consent obtained from couple</Label>
              </div>
            </Card>

            <Button onClick={handleRegister} disabled={saving || !consentObtained} className="w-full">
              {saving ? "Registering…" : "Register Couple"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Couple Detail */}
      <Dialog open={!!selectedCouple} onOpenChange={(o) => { if (!o) setSelectedCouple(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Couple: {selectedCouple?.couple_code}</DialogTitle>
          </DialogHeader>
          {selectedCouple && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">Indication:</span> {selectedCouple.indication || "—"}</div>
                <div><span className="text-muted-foreground">AMH:</span> {selectedCouple.amh_level ?? "—"} ng/mL</div>
                <div><span className="text-muted-foreground">AFC:</span> {selectedCouple.afc_count ?? "—"}</div>
                <div><span className="text-muted-foreground">ICMR Reg:</span> {selectedCouple.icmr_reg_number || "—"}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Consent:</span>{" "}
                {selectedCouple.consent_obtained
                  ? <Badge className="bg-green-600">✓ Obtained</Badge>
                  : <Badge variant="destructive">Missing</Badge>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CouplesTab;
