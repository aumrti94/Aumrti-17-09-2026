import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarDays } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useChronicFollowups } from "@/hooks/useChronicFollowups";
import { cn } from "@/lib/utils";

interface Props {
  hospitalId: string | null;
  onClick?: () => void;
}

const ChronicFollowupsStatCard: React.FC<Props> = ({ hospitalId, onClick }) => {
  const { rows, loading } = useChronicFollowups(hospitalId);

  return (
    <Card
      className={cn(
        "shadow-sm hover:shadow-md transition-shadow cursor-pointer group",
        rows.length > 0 && !loading && "border-l-[3px] border-l-[hsl(38,92%,50%)] bg-[hsl(48,96%,89%,0.1)]"
      )}
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0 p-3">
        <CardTitle className="text-[11px] font-medium text-muted-foreground">Follow-ups Due</CardTitle>
        <CalendarDays size={16} className="text-muted-foreground group-hover:text-primary transition-colors" />
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {loading ? (
          <Skeleton className="h-6 w-16" />
        ) : (
          <>
            <div className={cn("text-lg font-bold", rows.length > 0 ? "text-[hsl(28,80%,44%)]" : "text-muted-foreground")}>
              {rows.length}
            </div>
            <p className="text-[10px] text-muted-foreground">Next 7 days</p>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default ChronicFollowupsStatCard;
