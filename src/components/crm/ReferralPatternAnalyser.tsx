import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageCircle, TrendingDown, Award, Loader2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from '@/hooks/useHospitalId';


const ReferralPatternAnalyser: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [topDoctors, setTopDoctors] = useState<any[]>([]);
  const [inactiveReferrers, setInactiveReferrers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [paretoPercent, setParetoPercent] = useState(0);

  useEffect(() => { analyse(); }, []);

  const analyse = async () => {
    setLoading(true);
    // Get referral acquisition data from last 90 days
    const { data: acquisitions } = await supabase
      .from("patient_acquisition")
      .select("source, created_at, first_visit_revenue, referral_doctor_id")
      .eq("hospital_id", hospitalId)
      .eq("source", "referral_doctor")
      .gte("created_at", new Date(Date.now() - 90 * 86400000).toISOString());

    // Get all referral doctors
    const { data: doctors } = await supabase
      .from("referral_doctors")
      .select("*")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .order("total_referrals", { ascending: false });

    if (doctors && doctors.length > 0) {
      const topN = Math.ceil(doctors.length * 0.2);
      const topSlice = doctors.slice(0, topN);
      const totalRefs = doctors.reduce((s: number, d: any) => s + (d.total_referrals || 0), 0);
      const topRefs = topSlice.reduce((s: number, d: any) => s + (d.total_referrals || 0), 0);
      setParetoPercent(totalRefs > 0 ? Math.round((topRefs / totalRefs) * 100) : 0);
      setTopDoctors(topSlice);
    }

    // Inactive referrers: haven't referred in 60 days but had >3 referrals before
    const { data: inactive } = await supabase
      .from("referral_doctors")
      .select("*")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .gt("total_referrals", 3)
      .lt("last_referral_at", new Date(Date.now() - 60 * 86400000).toISOString().split("T")[0]);

    setInactiveReferrers(inactive || []);
    setLoading(false);
  };

  const reEngage = (doc: any) => {
    if (!doc.phone) { toast({ title: "No phone number", variant: "destructive" }); return; }
    const msg = `Dear Dr. ${doc.doctor_name}, we greatly value your continued support. We wanted to share our latest clinical outcomes data and update you on our new capabilities. May we arrange a brief visit? — Aumrti Hospital`;
    window.open(`https://wa.me/91${doc.phone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
  };

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      {/* Top Referrers Pareto */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Award className="h-4 w-4 text-amber-500" />
            Top Referrers — Top {topDoctors.length} doctors = {paretoPercent}% of all referrals
          </CardTitle>
        </CardHeader>
        <CardContent>
          {topDoctors.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={topDoctors.map(d => ({ name: d.doctor_name.split(" ").slice(0, 2).join(" "), referrals: d.total_referrals, revenue: d.total_revenue || 0 }))}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="referrals" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-center text-muted-foreground text-xs py-6">No referral data</p>}
        </CardContent>
      </Card>

      {/* At-Risk Referrers */}
      {inactiveReferrers.length > 0 && (
        <Card className="border-amber-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-amber-700">
              <TrendingDown className="h-4 w-4" />
              At-Risk Referrers ({inactiveReferrers.length} previously active doctors haven't referred recently)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[200px]">
              <div className="space-y-2">
                {inactiveReferrers.map(doc => (
                  <div key={doc.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                    <div>
                      <p className="text-sm font-medium">{doc.doctor_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {doc.specialty} · Last referral: {doc.last_referral_at ? new Date(doc.last_referral_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}
                        · Total: {doc.total_referrals}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => reEngage(doc)}>
                      <MessageCircle className="h-3 w-3 mr-1" /> Re-engage
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ReferralPatternAnalyser;
