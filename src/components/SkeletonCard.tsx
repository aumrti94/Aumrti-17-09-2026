import React from "react";

interface SkeletonCardProps {
  count?: number;
}

const SkeletonCard: React.FC<SkeletonCardProps> = ({ count = 4 }) => (
  <div className="space-y-2 p-2">
    {Array.from({ length: count }).map((_, i) => (
      <div
        key={i}
        className="h-[68px] rounded-lg skeleton-shimmer"
      />
    ))}
  </div>
);

export default SkeletonCard;
