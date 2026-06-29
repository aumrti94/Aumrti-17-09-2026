import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { callAI } from "@/lib/aiProvider";
import { FileText, Download, MessageSquare, Loader2 } from "lucide-react";
import { useHospitalId } from '@/hooks/useHospitalId';


export default function ProgressTrackerTab() {
  const { hospitalId } = useHospitalId();
  const [bookings, setBookings] = useState<any[]>([]);
  const [generating, setGenerating] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, string>>({});

  useEffect(() => {
    supabase.from("package_bookings")
      .select("*, health_packages(package_name), patients(full_name, uhid, dob, gender)")
      .eq("hospital_id", hospitalId)
      .in("status", ["awaiting_report", "completed"])
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => setBookings(data || []));
  }, []);

  const generateReport = async (booking: any) => {
    setGenerating(booking.id);
    try {
      const patient = booking.patients;
      const age = patient?.dob
        ? Math.floor((Date.now() - new Date(patient.dob).getTime()) / 31557600000)
        : "N/A";

      const response = await callAI({
        featureKey: "ai_digest",
        hospitalId: hospitalId,
        prompt: `Generate a professional health report summary for a preventive health checkup patient.

Patient: ${patient?.full_name}, Age: ${age}, Gender: ${patient?.gender || "N/A"}
Package: ${booking.health_packages?.package_name}
Date: ${booking.scheduled_date}

Write a doctor-friendly health report summary:
1. Overall health status (Excellent/Good/Fair/Poor)
2. Key findings (normal values to reassure, abnormal to highlight)
3. Risk factors identified
4. Recommendations (lifestyle, follow-up tests, specialist referrals)
5. Next checkup: recommended in N months

Keep language professional but accessible. Max 300 words.`,
        maxTokens: 400,
      });

      if (response.error) {
        toast.error(response.error);
        return;
      }

      if (!response.text) {
        toast.error("No report text generated. Check AI provider configuration.");
        return;
      }

      setReports((prev) => ({ ...prev, [booking.id]: response.text }));

      await supabase.from("package_bookings").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", booking.id);
      toast.success("Report generated successfully");
    } catch (e) {
      toast.error("Failed to generate report");
    } finally {
      setGenerating(null);
    }
  };

  return (
    <div className="space-y-4">
      {bookings.length === 0 && <p className="text-center text-muted-foreground py-8">No bookings awaiting report</p>}
      {bookings.map((b) => {
        const patient = b.patients;
        const report = reports[b.id];
        return (
          <Card key={b.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{patient?.full_name} — {b.health_packages?.package_name}</CardTitle>
                <Badge variant={b.status === "completed" ? "default" : "secondary"}>{b.status.replace("_", " ")}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">UHID: {patient?.uhid} • Scheduled: {b.scheduled_date}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {report && (
                <div className="bg-muted/50 rounded-md p-3 text-sm whitespace-pre-wrap border">{report}</div>
              )}
              <div className="flex gap-2">
                {b.status === "awaiting_report" && (
                  <Button size="sm" onClick={() => generateReport(b)} disabled={generating === b.id}>
                    {generating === b.id ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileText className="h-4 w-4 mr-1" />}
                    Generate Health Report
                  </Button>
                )}
                {(b.status === "completed" || report) && (
                  <>
                    <Button size="sm" variant="outline"><Download className="h-4 w-4 mr-1" /> Download Report</Button>
                    <Button size="sm" variant="outline"><MessageSquare className="h-4 w-4 mr-1" /> WhatsApp to Patient</Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
