import React from "react";
import { useNavigate } from "react-router-dom";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ShieldCheck, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  standardCodes: string[];
  className?: string;
}

/**
 * Small blue "NABH" pill. Click to see relevant standard codes with links to the
 * compliance matrix filtered to that standard.
 */
const NABHBadge: React.FC<Props> = ({ standardCodes, className }) => {
  const navigate = useNavigate();
  if (!standardCodes.length) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full",
            "text-[11px] font-bold leading-none",
            "bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.97]",
            "transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60",
            className,
          )}
        >
          <ShieldCheck className="h-3 w-3 shrink-0" />
          NABH
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="w-52 p-2"
        side="bottom"
        align="end"
        sideOffset={6}
      >
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1.5 px-1">
          Applicable Standards
        </p>
        <div className="space-y-0.5">
          {standardCodes.map(code => (
            <button
              key={code}
              onClick={() => navigate(`/nabh/compliance?filter=${encodeURIComponent(code)}`)}
              className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              <span className="font-mono tracking-wide">{code}</span>
              <ArrowUpRight className="h-3 w-3 text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default NABHBadge;
