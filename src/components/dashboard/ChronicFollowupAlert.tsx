import React from "react";
import { CalendarDays, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChronicFollowups, FollowupRow } from "@/hooks/useChronicFollowups";
import { cn } from "@/lib/utils";

interface Props {
  hospitalId: string | null;
}

const ChronicFollowupAlert: React.FC<Props> = ({ hospitalId }) => {
  const { rows, loading } = useChronicFollowups(hospitalId);

  if (loading) return <div className="h-48 animate-pulse bg-muted rounded-xl mb-3" />;
  if (rows.length === 0) return null;

  const sendReminder = (row: FollowupRow) => {
    if (!row.patient_phone) return;
    const phone = row.patient_phone.replace(/\D/g, "");
    const tests = row.followup_tests?.join(", ") || "routine tests";
    const date = new Date(row.next_followup).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const msg = `Dear ${row.patient_name}, your ${row.condition_label} follow-up is due on ${date}. Please book an appointment. Tests required: ${tests}`;
    window.open(`https://wa.me/91${phone}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto -mx-5 px-5">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground text-[10px] uppercase">
              <th className="text-left py-2 pr-3 font-bold">Patient</th>
              <th className="text-left py-2 pr-3 font-bold">Condition</th>
              <th className="text-left py-2 pr-3 font-bold text-right">Due</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {rows.map((r) => {
              const overdue = new Date(r.next_followup) < new Date();
              return (
                <tr key={r.id} className="group hover:bg-muted/30 transition-colors">
                  <td className="py-3 pr-3">
                    <div className="font-bold text-foreground text-[13px]">{r.patient_name}</div>
                    <div className="text-[10px] text-muted-foreground leading-none mt-1">{r.patient_uhid}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="text-foreground font-medium">{r.condition_label}</div>
                    {r.followup_tests && r.followup_tests.length > 0 && (
                      <div className="text-[9px] text-muted-foreground mt-1 line-clamp-1 italic">
                        Tests: {r.followup_tests.join(", ")}
                      </div>
                    )}
                  </td>
                  <td className="py-3 text-right">
                    <div className={cn("font-bold text-[12px]", overdue ? "text-destructive" : "text-[hsl(38,92%,50%)]")}>
                      {new Date(r.next_followup).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                    </div>
                    {r.patient_phone && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-6 text-[9px] px-1.5 mt-1 text-primary hover:bg-primary/10" 
                        onClick={(e) => { e.stopPropagation(); sendReminder(r); }}
                      >
                        <Send size={10} className="mr-1" /> Remind
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ChronicFollowupAlert;
