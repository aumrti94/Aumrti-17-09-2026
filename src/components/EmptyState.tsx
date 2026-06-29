import React from "react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon: string;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, actionLabel, onAction }) => (
  <div className="flex flex-col items-center justify-center h-full text-center px-4">
    <span className="text-[48px] leading-none opacity-60">{icon}</span>
    <h3 className="text-base font-semibold text-foreground mt-3">{title}</h3>
    <p className="text-[13px] text-muted-foreground max-w-[280px] mt-1.5">{description}</p>
    {actionLabel && onAction && (
      <Button variant="outline" size="sm" className="mt-4 text-xs" onClick={onAction}>
        {actionLabel}
      </Button>
    )}
  </div>
);

export default EmptyState;
