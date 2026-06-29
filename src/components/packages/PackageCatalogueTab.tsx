import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Clock, Users, ChevronDown, ChevronUp } from "lucide-react";
import { useHospitalId } from '@/hooks/useHospitalId';


interface Props { onBook: () => void; onCreate: () => void; }

export default function PackageCatalogueTab({ onBook, onCreate }: Props) {
  const { hospitalId } = useHospitalId();
  const [packages, setPackages] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("health_packages").select("*").eq("hospital_id", hospitalId)
      .eq("is_active", true).order("display_order")
      .then(({ data }) => setPackages(data || []));
  }, []);

  const typeColors: Record<string, string> = {
    basic: "bg-emerald-100 text-emerald-800",
    essential: "bg-blue-100 text-blue-800",
    comprehensive: "bg-purple-100 text-purple-800",
    executive: "bg-amber-100 text-amber-800",
    senior_citizen: "bg-rose-100 text-rose-800",
    corporate: "bg-slate-100 text-slate-800",
    custom: "bg-gray-100 text-gray-800",
    pre_marital: "bg-pink-100 text-pink-800",
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {packages.map((pkg) => {
        const components = Array.isArray(pkg.components) ? pkg.components : [];
        const isExpanded = expanded === pkg.id;
        return (
          <Card key={pkg.id} className="flex flex-col">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <CardTitle className="text-base">{pkg.package_name}</CardTitle>
                <Badge className={typeColors[pkg.package_type] || ""}>{pkg.package_type.replace("_", " ")}</Badge>
              </div>
              {pkg.description && <p className="text-xs text-muted-foreground mt-1">{pkg.description}</p>}
            </CardHeader>
            <CardContent className="flex-1 flex flex-col gap-3">
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{pkg.target_gender === "both" ? "All" : pkg.target_gender}</span>
                {pkg.estimated_hours && <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{pkg.estimated_hours}h</span>}
                {pkg.min_age && <span>Age {pkg.min_age}{pkg.max_age ? `-${pkg.max_age}` : "+"}</span>}
              </div>
              <p className="text-xs text-muted-foreground">{components.length} components included</p>
              <p className="text-xl font-bold text-primary">₹{Number(pkg.price).toLocaleString("en-IN")}</p>

              {components.length > 0 && (
                <Button variant="ghost" size="sm" className="w-fit text-xs" onClick={() => setExpanded(isExpanded ? null : pkg.id)}>
                  {isExpanded ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
                  {isExpanded ? "Hide" : "View"} Components
                </Button>
              )}
              {isExpanded && (
                <ul className="text-xs space-y-1 border-t pt-2">
                  {components.map((c: any, i: number) => (
                    <li key={i} className="flex justify-between">
                      <span>{c.sequence || i + 1}. {c.name}</span>
                      {c.estimated_mins && <span className="text-muted-foreground">{c.estimated_mins}m</span>}
                    </li>
                  ))}
                </ul>
              )}

              <Button size="sm" className="mt-auto" onClick={onBook}>Book This Package</Button>
            </CardContent>
          </Card>
        );
      })}
      {packages.length === 0 && (
        <div className="col-span-3 text-center py-12 text-muted-foreground">
          No packages configured. <Button variant="link" onClick={onCreate}>Create your first package</Button>
        </div>
      )}
    </div>
  );
}
