import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from '@/hooks/useHospitalId';


export default function PackageAnalyticsTab() {
  const { hospitalId } = useHospitalId();
  const [stats, setStats] = useState({ total: 0, completed: 0, cancelled: 0, topPackage: "—" });

  useEffect(() => {
    const load = async () => {
      const { count: total } = await supabase.from("package_bookings").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId);
      const { count: completed } = await supabase.from("package_bookings").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("status", "completed");
      const { count: cancelled } = await supabase.from("package_bookings").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("status", "cancelled");
      setStats({ total: total || 0, completed: completed || 0, cancelled: cancelled || 0, topPackage: "—" });
    };
    load();
  }, []);

  const cards = [
    { label: "Total Bookings", value: stats.total },
    { label: "Completed", value: stats.completed },
    { label: "Cancelled", value: stats.cancelled },
    { label: "Completion Rate", value: stats.total > 0 ? `${Math.round((stats.completed / stats.total) * 100)}%` : "N/A" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className="text-2xl font-bold mt-1">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle className="text-sm">Package Performance</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Detailed analytics will populate as bookings accumulate.</p>
        </CardContent>
      </Card>
    </div>
  );
}
