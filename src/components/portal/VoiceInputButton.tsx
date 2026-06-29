import React, { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Props {
  languageCode: string;
  onTranscript: (text: string) => void;
  patientId?: string;
  hospitalId?: string;
  sessionType?: string;
  className?: string;
  size?: "sm" | "default";
}

const VoiceInputButton: React.FC<Props> = ({
  languageCode, onTranscript, patientId, hospitalId, sessionType = "general", className, size = "default"
}) => {
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        await transcribeAudio();
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch {
      toast.error("Microphone access denied. Please allow microphone use.");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    setProcessing(true);
  };

  const transcribeAudio = async () => {
    try {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      const arrayBuffer = await blob.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

      const { data, error } = await supabase.functions.invoke("bhashini-patient-transcribe", {
        body: {
          audio_base64: base64,
          language_code: languageCode,
          patient_id: patientId,
          hospital_id: hospitalId,
          session_type: sessionType,
        },
      });

      if (error) throw error;
      if (data?.transcript) {
        onTranscript(data.transcript);
        if (data.mock) {
          toast.info("Voice captured (mock mode — configure Bhashini API for live transcription)");
        }
      } else {
        toast.error("Could not transcribe audio. Please try again.");
      }
    } catch (err: any) {
      toast.error(err.message || "Transcription failed");
    } finally {
      setProcessing(false);
    }
  };

  if (processing) {
    return (
      <Button variant="outline" size={size} className={cn("gap-1.5", className)} disabled>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Transcribing...
      </Button>
    );
  }

  if (recording) {
    return (
      <Button
        variant="destructive"
        size={size}
        className={cn("gap-1.5 animate-pulse", className)}
        onClick={stopRecording}
      >
        <MicOff className="h-3.5 w-3.5" />
        Stop Recording
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size={size}
      className={cn("gap-1.5", className)}
      onClick={startRecording}
    >
      <Mic className="h-3.5 w-3.5" />
      Speak
    </Button>
  );
};

export default VoiceInputButton;
