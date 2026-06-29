import React from "react";
import { BarChart3 } from "lucide-react";

const PlaceholderTab: React.FC<{ title: string }> = ({ title }) => (
  <div className="flex flex-col items-center justify-center py-20 gap-3">
    <BarChart3 className="h-12 w-12 text-muted-foreground/40" />
    <h3 className="text-lg font-semibold text-foreground">{title}</h3>
    <p className="text-sm text-muted-foreground">Deep drill-down analytics coming in the next build phase.</p>
  </div>
);

export default PlaceholderTab;
