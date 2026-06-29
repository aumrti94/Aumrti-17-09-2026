import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { FileText, Package, AlertTriangle, ClipboardList, TrendingUp } from "lucide-react";

interface Props {
  hospitalId: string;
}

const reports = [
  { title: "Daily Dispensing Report", desc: "Today's dispensing summary with totals", icon: FileText, color: "text-blue-600" },
  { title: "Stock Valuation Report", desc: "Total stock value at cost & MRP", icon: Package, color: "text-emerald-600" },
  { title: "Expiry Report", desc: "Drugs expiring by month", icon: AlertTriangle, color: "text-orange-600" },
  { title: "NDPS Monthly Summary", desc: "Schedule H/H1/X drug register summary", icon: ClipboardList, color: "text-red-600" },
  { title: "Consumption Report", desc: "Most & least dispensed drugs", icon: TrendingUp, color: "text-purple-600" },
];

const PharmacyReportsTab: React.FC<Props> = () => {
  return (
    <div className="h-full overflow-auto p-5">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl">
        {reports.map((r) => {
          const Icon = r.icon;
          return (
            <Card
              key={r.title}
              className="cursor-pointer hover:shadow-md transition-shadow active:scale-[0.98]"
            >
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg bg-muted ${r.color}`}>
                    <Icon size={20} />
                  </div>
                  <CardTitle className="text-sm">{r.title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-xs">{r.desc}</CardDescription>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default PharmacyReportsTab;
