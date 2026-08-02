import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import SignaturePad from "@/components/ui/SignaturePad";
import {
  FileText, PenLine, CheckCircle2, Loader2, Trash2, ChevronLeft, ChevronRight,
} from "lucide-react";

interface ConsentTemplate {
  id: string;
  name: string;
  consent_type: string;
  content: string | null;
  witness_required: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  admissionId?: string | null;
  edVisitId?: string | null;      // Emergency visit — used when there is no admission
  patientId: string;
  patientName: string;
  hospitalId: string;
  onAllSigned?: () => void;
}

// ── SHA-256 of a string ──────────────────────────────────────────────────────
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function ConsentSignatureModal({
  open, onClose, admissionId, edVisitId, patientId, patientName, hospitalId, onAllSigned,
}: Props) {
  const { toast } = useToast();
  const [templates, setTemplates]         = useState<ConsentTemplate[]>([]);
  const [loading, setLoading]             = useState(true);
  const [currentIdx, setCurrentIdx]       = useState(0);
  const [signed, setSigned]               = useState<Set<string>>(new Set());
  const [patientSig, setPatientSig]       = useState<string | null>(null);
  const [witnessSig, setWitnessSig]       = useState<string | null>(null);
  const [witnessName, setWitnessName]     = useState("");
  const [agreed, setAgreed]               = useState(false);
  const [saving, setSaving]               = useState(false);
  const [clearCount, setClearCount]       = useState(0);

  useEffect(() => {
    if (!open || !hospitalId) return;
    setLoading(true);
    (supabase as any)
      .from("consent_form_templates")
      .select("id, name, consent_type, content, witness_required")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .then(({ data }: any) => {
        setTemplates(data || []);
        setLoading(false);
      });
  }, [open, hospitalId]);

  // Reset signature fields when moving to next template
  useEffect(() => {
    setPatientSig(null);
    setWitnessSig(null);
    setWitnessName("");
    setAgreed(false);
    setClearCount(c => c + 1);
  }, [currentIdx]);

  const template = templates[currentIdx];
  const isLast   = currentIdx === templates.length - 1;
  const allDone  = signed.size === templates.length && templates.length > 0;

  const canSign = agreed && patientSig && (!template?.witness_required || (witnessName.trim() && witnessSig));

  const handleSign = useCallback(async () => {
    if (!template || !canSign || !patientSig) return;
    setSaving(true);
    try {
      const now       = new Date().toISOString();
      const contextId = admissionId ?? edVisitId ?? patientId;
      const hashInput = `${contextId}|${template.id}|${patientId}|${now}|${patientSig.substring(0, 50)}`;
      const hash      = await sha256(hashInput);
      const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const { data: { user } } = await supabase.auth.getUser();

      await (supabase as any).from("patient_consents").insert({
        hospital_id:        hospitalId,
        patient_id:         patientId,
        admission_id:       admissionId ?? null,
        ed_visit_id:        edVisitId ?? null,
        template_id:        template.id,
        consent_type:       template.consent_type,
        consent_given:      true,
        consented_at:       now,
        consent_text:       template.content,
        patient_signature:  patientSig,
        witness_signature:  witnessSig || null,
        witness_name:       witnessName.trim() || null,
        signature_hash:     hash,
        signed_by_user_id:  user?.id || null,
        valid_until:        validUntil,
      });

      // NABH PRE.1 — Patient rights and informed consent
      await logNABHEvidence(
        hospitalId,
        "PRE.1",
        `Informed consent documented for ${patientName} — ${template.name} (${template.consent_type}) signed with e-signature, hash: ${hash.substring(0, 16)}…`,
        "compliant"
      );

      setSigned(prev => new Set([...prev, template.id]));
      toast({ title: `Consent signed`, description: template.name });

      if (!isLast) {
        setCurrentIdx(i => i + 1);
      } else {
        onAllSigned?.();
      }
    } catch (e: any) {
      toast({ title: "Failed to save consent", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [template, canSign, patientSig, witnessSig, witnessName, admissionId, edVisitId, patientId, hospitalId, isLast, onAllSigned, patientName, toast]);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText size={16} className="text-primary" />
            Informed Consent — {patientName}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-12 flex items-center justify-center">
            <Loader2 size={22} className="animate-spin text-muted-foreground" />
          </div>
        ) : templates.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-[13px] text-muted-foreground">
              No active consent templates found.
              <br />
              Add templates in <strong>Settings → Consent Forms</strong>.
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={onClose}>Close</Button>
          </div>
        ) : allDone ? (
          <div className="py-8 text-center space-y-3">
            <CheckCircle2 size={36} className="text-green-500 mx-auto" />
            <p className="text-[14px] font-semibold text-foreground">All {templates.length} consent forms signed</p>
            <p className="text-[12px] text-muted-foreground">
              Signatures stored with SHA-256 audit hash. NABH evidence logged.
            </p>
            <Button size="sm" onClick={onClose}>Close</Button>
          </div>
        ) : (
          <div className="space-y-4 mt-1">
            {/* Progress */}
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-muted-foreground">
                Form {currentIdx + 1} of {templates.length}
              </span>
              <div className="flex gap-1">
                {templates.map((t, i) => (
                  <div
                    key={t.id}
                    className={`h-1.5 w-6 rounded-full transition-colors ${
                      signed.has(t.id) ? "bg-green-500"
                      : i === currentIdx ? "bg-primary"
                      : "bg-slate-200"
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Template name */}
            <div className="flex items-start gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${signed.has(template.id) ? "bg-green-500/10" : "bg-primary/10"}`}>
                {signed.has(template.id)
                  ? <CheckCircle2 size={13} className="text-green-500" />
                  : <PenLine size={13} className="text-primary" />
                }
              </div>
              <div>
                <p className="text-[14px] font-semibold text-foreground">{template.name}</p>
                {template.witness_required && (
                  <span className="text-[11px] text-amber-600 font-medium">Witness signature required</span>
                )}
              </div>
            </div>

            {/* Consent text */}
            <div className="bg-muted/40 rounded-xl p-4 max-h-40 overflow-y-auto">
              <p className="text-[12px] text-foreground leading-relaxed whitespace-pre-wrap">
                {template.content || "Please read the consent form and sign below."}
              </p>
            </div>

            {/* Agreement checkbox */}
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={agreed}
                onChange={e => setAgreed(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded border-border text-primary focus:ring-primary/20 shrink-0"
              />
              <span className="text-[13px] text-foreground">
                I have read and understood the above consent form and voluntarily agree to the terms.
              </span>
            </label>

            {/* Patient signature */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[12px] font-medium text-muted-foreground">Patient / Guardian Signature</p>
                <button
                  onClick={() => { setPatientSig(null); setClearCount(c => c + 1); }}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 size={11} /> Clear
                </button>
              </div>
              <SignaturePad
                label=""
                onCapture={setPatientSig}
                cleared={clearCount}
              />
              {patientSig && (
                <p className="text-[11px] text-green-600 mt-1 flex items-center gap-1">
                  <CheckCircle2 size={11} /> Signature captured
                </p>
              )}
            </div>

            {/* Witness section */}
            {template.witness_required && (
              <div className="space-y-3 border-t border-border pt-3">
                <p className="text-[12px] font-medium text-foreground">Witness Details</p>
                <div>
                  <label className="text-[12px] text-muted-foreground">Witness Full Name *</label>
                  <Input
                    value={witnessName}
                    onChange={e => setWitnessName(e.target.value)}
                    placeholder="Staff nurse / doctor name"
                    className="mt-1 h-9 text-[13px]"
                  />
                </div>
                <SignaturePad
                  label="Witness Signature *"
                  onCapture={setWitnessSig}
                  cleared={clearCount}
                />
              </div>
            )}

            {/* Navigation + Sign */}
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <button
                onClick={() => setCurrentIdx(i => Math.max(0, i - 1))}
                disabled={currentIdx === 0}
                className="flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
              >
                <ChevronLeft size={14} /> Previous
              </button>

              <Button
                onClick={handleSign}
                disabled={!canSign || saving || signed.has(template.id)}
                size="sm"
                className="gap-1.5"
              >
                {saving
                  ? <><Loader2 size={13} className="animate-spin" /> Saving…</>
                  : signed.has(template.id)
                  ? <><CheckCircle2 size={13} /> Signed</>
                  : <><PenLine size={13} /> Sign & {isLast ? "Finish" : "Next"}</>
                }
              </Button>

              {!isLast && (
                <button
                  onClick={() => setCurrentIdx(i => Math.min(templates.length - 1, i + 1))}
                  className="flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Skip <ChevronRight size={14} />
                </button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
