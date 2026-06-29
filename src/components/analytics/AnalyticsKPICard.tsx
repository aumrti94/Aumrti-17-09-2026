import React from "react";
import { cn } from "@/lib/utils";

interface AnalyticsKPICardProps {
  icon: string;
  iconBg: string;
  value: string;
  valueColor?: string;
  label: string;
  subtitle?: string;
  subtitleColor?: string;
}

const AnalyticsKPICard: React.FC<AnalyticsKPICardProps> = ({
  icon, iconBg, value, valueColor, label, subtitle, subtitleColor,
}) => (
  <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-2">
    <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center text-lg", iconBg)}>
      {icon}
    </div>
    <p className={cn("text-[22px] font-bold leading-tight", valueColor || "text-foreground")}>{value}</p>
    <p className="text-[11px] text-muted-foreground">{label}</p>
    {subtitle && (
      <p className={cn("text-[11px]", subtitleColor || "text-muted-foreground")}>{subtitle}</p>
    )}
  </div>
);

export default AnalyticsKPICard;
