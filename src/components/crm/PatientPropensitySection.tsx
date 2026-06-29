import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Target, MessageCircle, RefreshCw, Send, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from '@/hooks/useHospitalId';


interface ScoredPatient {
  id: string;
  full_name: string;
  phone: string | null;
  last_visit_date: string | null;
  total_visits: number;
  total_spend: number;
  propensityScore: number;
  daysSinceVisit: number;
}

const PatientPropensitySection: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [patients, setPatients] = useState<ScoredPatient[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<string | null>(null);

  const scorePatients = async () => {
    setLoading(true);
    try {
      const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().split("T")[0];
      const { data, error } = await supabase
        .from("patients")
        .select("id, full_name, phone, last_visit_date, total_visits, total_spend")
        .eq("hospital_id", hospitalId)
        .lt("last_visit_date", cutoff)
        .order("last_visit_date", { ascending: false })
        .limit(50);

      if (error || !data) { setPatients([]); setLoading(false); return; }

      const scored: ScoredPatient[] = data.map((p: any) => {
        const daysSinceVisit = Math.floor((Date.now() - new Date(p.last_visit_date).getTime()) / 86400000);
        const recencyScore = Math.max(0, 100 - daysSinceVisit);
        const frequencyScore = Math.min(100, (p.total_visits || 1) * 10);
        const monetaryScore = Math.min(100, ((p.total_spend || 0) / 10000) * 10);
        const propensityScore = Math.round(recencyScore * 0.4 + frequencyScore * 0.35 + monetaryScore * 0.25);
        return { ...p, propensityScore, daysSinceVisit };
      });

      scored.sort((a, b) => b.propensityScore - a.propensityScore);
      setPatients(scored.slice(0, 20));
    } catch { setPatients([]); }
    setLoading(false);
  };

  useEffect(() => { scorePatients(); }, []);

  const contactPatient = (p: ScoredPatient) => {
    if (!p.phone) { toast({ title: "No phone number", variant: "destructive" }); return; }
    const msg = `Dear ${p.full_name}, we noticed you haven't visited Aumrti Hospital recently. As a valued patient, we'd love to see you. Book an appointment at your convenience.`;
    window.open(`https://wa.me/91${p.phone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
  };

  const runCampaign = async () => {
    setSending("all");
    const highPropensity = patients.filter(p => p.propensityScore >= 70 && p.phone);
    for (const p of highPropensity) {
      contactPatient(p);
      await new Promise(r => setTimeout(r, 500));
    }
    toast({ title: `Re-engagement sent to ${highPropensity.length} patients` });
    setSending(null);
  };

  const getScoreBadge = (score: number) => {
    if (score >= 70) return <Badge className="bg-green-100 text-green-700 text-[10px]">High</Badge>;
    if (score >= 40) return <Badge className="bg-amber-100 text-amber-700 text-[10px]">Medium</Badge>;
    return <Badge variant="secondary" className="text-[10px]">Low</Badge>;
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" /> Re-engagement Opportunities
          </CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="text-xs h-7" onClick={scorePatients} disabled={loading}>
              <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button size="sm" className="text-xs h-7" onClick={runCampaign} disabled={sending === "all" || patients.filter(p => p.propensityScore >= 70).length === 0}>
              {sending === "all" ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Send className="h-3 w-3 mr-1" />}
              Run Campaign ({patients.filter(p => p.propensityScore >= 70).length})
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[300px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Patient</TableHead>
                <TableHead className="text-xs">Last Visit</TableHead>
                <TableHead className="text-xs text-right">Days Inactive</TableHead>
                <TableHead className="text-xs text-right">Score</TableHead>
                <TableHead className="text-xs">Level</TableHead>
                <TableHead className="text-xs">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {patients.map(p => (
                <TableRow key={p.id}>
                  <TableCell className="text-xs font-medium">{p.full_name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.last_visit_date ? new Date(p.last_visit_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-right font-mono">{p.daysSinceVisit}</TableCell>
                  <TableCell className="text-xs text-right font-mono font-bold">{p.propensityScore}</TableCell>
                  <TableCell>{getScoreBadge(p.propensityScore)}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" className="text-xs h-6 px-2" onClick={() => contactPatient(p)} disabled={!p.phone}>
                      <MessageCircle className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {patients.length === 0 && !loading && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8 text-xs">No inactive patients found</TableCell></TableRow>
              )}
              {loading && (
                <TableRow><TableCell colSpan={6} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

export default PatientPropensitySection;
