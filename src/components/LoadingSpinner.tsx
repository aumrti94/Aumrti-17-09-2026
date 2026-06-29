import React from "react";
import { cn } from "@/lib/utils";

interface LoadingSpinnerProps {
  size?: number;
  className?: string;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ size = 24, className }) => (
  <div
    className={cn("animate-spin rounded-full border-[3px] border-muted border-t-primary", className)}
    style={{ width: size, height: size }}
  />
);

export default LoadingSpinner;
