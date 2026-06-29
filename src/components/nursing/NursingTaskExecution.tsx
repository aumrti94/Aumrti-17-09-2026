import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Check, Pause, X, Activity, Pill, Handshake, AlertTriangle } from "lucide-react";
import type { NursingTask } from "@/pages/nursing/NursingPage";
import NursingMedicationTask from "./NursingMedicationTask";
import NursingVitalsTask from "./NursingVitalsTask";
import NursingHandoverTask from "./NursingHandoverTask";

interface Props {
  task: NursingTask | null;
  shift: { label: string; type: string };
  wards: { id: string; name: string }[];
  onComplete: () => void;
}

const typeIcons: Record<string, React.ElementType> = {
  medication: Pill,
  vitals: Activity,
  handover: Handshake,
};

const NursingTaskExecution: React.FC<Props> = ({ task, shift, wards, onComplete }) => {
  if (!task) {
    return (
      <div className="flex-1 flex items-center justify-center bg-muted/30">
        <div className="text-center">
          <Activity size={40} className="mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">← Select a task to execute</p>
        </div>
      </div>
    );
  }

  const Icon = typeIcons[task.type] || Activity;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-muted/30">
      {/* Header */}
      <div className="h-[52px] flex-shrink-0 bg-card border-b border-border px-5 flex items-center gap-4">
        <Icon size={18} className="text-primary flex-shrink-0" />
        <span className="text-base font-bold text-foreground truncate">{task.patientName}</span>
        <Badge variant="outline" className="text-[10px] flex-shrink-0">
          {task.type === "medication" ? "Medication" : task.type === "vitals" ? "Vitals" : "Handover"}
        </Badge>
        {task.bedLabel && (
          <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">{task.bedLabel}</span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {task.type === "medication" && <NursingMedicationTask task={task} onComplete={onComplete} />}
        {task.type === "vitals" && <NursingVitalsTask task={task} onComplete={onComplete} />}
        {task.type === "handover" && <NursingHandoverTask task={task} shift={shift} wards={wards} onComplete={onComplete} />}
      </div>
    </div>
  );
};

export default NursingTaskExecution;
