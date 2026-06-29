import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Printer, Copy, Send, Globe, Volume2, VolumeX, AlertTriangle } from "lucide-react";
import { callAI } from "@/lib/aiProvider";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ALL_PATIENT_LANGUAGES,
  translateText,
  getHospitalLanguages,
  buildBilingualHtml,
} from "@/lib/translateUtils";

interface Props {
  hospitalId: string;
  patientId?: string;
  patientName: string;
  patientPhone: string | null;
  diagnosis: string;
  medications: { drug_name: string; dose?: string; frequency?: string }[];
  followupDate: string | null;
  restrictions: string | null;
}

const DischargeInstructions: React.FC<Props> = ({
  hospitalId,
  patientId,
  patientName,
  patientPhone,
  diagnosis,
  medications,
  followupDate,
  restrictions,
}) => {
  const { toast } = useToast();

  // Available languages filtered to hospital's configured set
  const [availableLanguages, setAvailableLanguages] = useState(
    ALL_PATIENT_LANGUAGES.filter((l) => l.code === "English")
  );
  const [selectedLang, setSelectedLang] = useState("English");

  // English is the source; translation is derived from it
  const [englishText, setEnglishText]       = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [generating, setGenerating]         = useState(false);
  const [translating, setTranslating]       = useState(false);
  const [speaking, setSpeaking]             = useState(false);

  // Load hospital's preferred languages once
  useEffect(() => {
    getHospitalLanguages(hospitalId).then((langs) => {
      const available = ALL_PATIENT_LANGUAGES.filter((l) => langs.includes(l.code));
      setAvailableLanguages(available.length > 0 ? available : ALL_PATIENT_LANGUAGES);
    });
  }, [hospitalId]);

  // When language changes, translate existing English text if available
  const handleLangChange = useCallback(
    async (lang: string) => {
      setSelectedLang(lang);
      setTranslatedText("");
      if (lang === "English" || !englishText) return;
      setTranslating(true);
      try {
        const result = await translateText(englishText, lang, hospitalId, {
          context: "patient_discharge_instructions",
          patientId,
        });
        setTranslatedText(result);
      } catch {
        toast({ title: "Translation failed", variant: "destructive" });
      } finally {
        setTranslating(false);
      }
    },
    [englishText, hospitalId, patientId, toast]
  );

  const generateEnglish = async () => {
    setGenerating(true);
    setEnglishText("");
    setTranslatedText("");

    try {
      const medList = medications
        .map((m) => [m.drug_name, m.dose, m.frequency].filter(Boolean).join(" "))
        .join(", ");

      const response = await callAI({
        featureKey: "discharge_instructions",
        hospitalId,
        prompt: `Write simple, clear discharge instructions for a patient in English.

Patient details:
- Diagnosis: ${diagnosis || "Not specified"}
- Medications: ${medList || "None prescribed"}
- Follow-up: ${followupDate || "As advised"}
- Restrictions: ${restrictions || "None specified"}

Write in simple English that a patient with no medical knowledge can understand. Use short sentences. Use numbered points.
Include: what medicines to take and when, what to avoid, when to come back, warning signs to watch for.`,
        maxTokens: 600,
      });

      if (response.error || !response.text) {
        toast({ title: "AI generation failed", description: response.error || "Empty response", variant: "destructive" });
        return;
      }

      setEnglishText(response.text);

      // Auto-translate to selected language if non-English
      if (selectedLang !== "English" && response.text) {
        setTranslating(true);
        try {
          const translated = await translateText(response.text, selectedLang, hospitalId, {
            context: "patient_discharge_instructions",
            patientId,
          });
          setTranslatedText(translated);
        } finally {
          setTranslating(false);
        }
      }
    } catch {
      toast({
        title: "AI unavailable",
        description: "Could not generate instructions. Please type them manually.",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const displayText = selectedLang === "English" ? englishText : (translatedText || englishText);

  const handlePrint = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const langMeta = ALL_PATIENT_LANGUAGES.find((l) => l.code === selectedLang);
    const bodyHtml =
      selectedLang !== "English" && translatedText
        ? buildBilingualHtml(englishText, translatedText, selectedLang, langMeta?.native || selectedLang)
        : `<pre style="white-space:pre-wrap;font-family:inherit;">${englishText}</pre>`;

    printWindow.document.write(`<html>
      <head>
        <title>Discharge Instructions — ${patientName}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; line-height: 1.7; font-size: 14px; }
          h2 { border-bottom: 2px solid #1A2F5A; padding-bottom: 8px; }
        </style>
      </head>
      <body>
        <h2>Discharge Instructions — ${patientName}</h2>
        ${bodyHtml}
        <script>window.print();</script>
      </body>
    </html>`);
    printWindow.document.close();
  };

  const handleWhatsApp = () => {
    if (!patientPhone) {
      toast({ title: "No phone number available", variant: "destructive" });
      return;
    }
    const phone = patientPhone.replace(/\D/g, "");
    const text = `*Discharge Instructions — ${patientName}*\n\n${displayText}`;
    window.open(
      `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(displayText);
    toast({ title: "Instructions copied to clipboard" });
  };

  const handlePlayAudio = () => {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const lang = ALL_PATIENT_LANGUAGES.find((l) => l.code === selectedLang);
    const utterance = new SpeechSynthesisUtterance(displayText);
    utterance.lang = lang?.tts || "en-IN";
    utterance.rate = 0.85;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const isNonEnglish = selectedLang !== "English";

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-2">
        <Globe size={14} className="text-primary" />
        <span className="text-xs font-bold text-foreground">Generate Patient Instructions</span>
      </div>

      {/* Language pills */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {availableLanguages.map((lang) => (
          <button
            key={lang.code}
            onClick={() => handleLangChange(lang.code)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
              selectedLang === lang.code
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            {lang.native !== lang.label ? `${lang.native} ${lang.label}` : lang.label}
          </button>
        ))}
      </div>

      <Button
        size="sm"
        onClick={generateEnglish}
        disabled={generating}
        className="text-xs mb-3"
      >
        {generating
          ? <><Loader2 size={12} className="animate-spin mr-1" /> Generating…</>
          : <>🌐 Generate Instructions</>
        }
      </Button>

      {/* Translation in-progress */}
      {translating && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          <Loader2 size={12} className="animate-spin" />
          Translating to {selectedLang}…
        </div>
      )}

      {/* Instructions display */}
      {englishText && (
        <div className="bg-[hsl(var(--success)/0.08)] border-l-[3px] border-l-[hsl(var(--success))] rounded-lg p-4">
          <p className="text-[13px] font-bold text-foreground mb-2">
            📋 Discharge Instructions
            {isNonEnglish && translatedText && ` — ${selectedLang}`}
          </p>

          <pre className="text-sm text-foreground whitespace-pre-wrap font-sans leading-7">
            {displayText}
          </pre>

          {/* Auto-translated disclaimer */}
          {isNonEnglish && translatedText && (
            <div className="flex items-start gap-1.5 mt-2 p-2 rounded bg-amber-50 border border-amber-200">
              <AlertTriangle size={12} className="text-amber-600 mt-0.5 shrink-0" />
              <p className="text-[11px] text-amber-800">
                Auto-translated. Please verify accuracy with the patient before discharge.
              </p>
            </div>
          )}

          <div className="flex gap-2 mt-3 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7"
              onClick={handlePrint}
            >
              <Printer size={12} className="mr-1" />
              {isNonEnglish && translatedText ? `Print Bilingual (EN + ${selectedLang})` : "Print"}
            </Button>
            <Button variant="outline" size="sm" className="text-xs h-7" onClick={handleWhatsApp}>
              <Send size={12} className="mr-1" /> WhatsApp
            </Button>
            <Button variant="outline" size="sm" className="text-xs h-7" onClick={handleCopy}>
              <Copy size={12} className="mr-1" /> Copy
            </Button>
            <Button
              variant={speaking ? "default" : "outline"}
              size="sm"
              className={cn("text-xs h-7", speaking && "bg-primary")}
              onClick={handlePlayAudio}
            >
              {speaking
                ? <><VolumeX size={12} className="mr-1" /> Stop</>
                : <><Volume2 size={12} className="mr-1" /> 🔊 Play in {selectedLang}</>
              }
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Audio uses device text-to-speech. Configure Sarvam Bulbul V3 in API Hub for higher quality.
          </p>
        </div>
      )}
    </div>
  );
};

export default DischargeInstructions;
