import React from "react";
import { useLocation } from "react-router-dom";

const ComingSoon: React.FC = () => {
  const location = useLocation();
  const module = location.pathname.slice(1).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-foreground mb-2">{module || "Module"}</h1>
        <p className="text-muted-foreground">This module is coming soon.</p>
      </div>
    </div>
  );
};

export default ComingSoon;
