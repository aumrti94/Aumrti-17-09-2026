import React, { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  /** Unique key used to persist collapsed state in localStorage */
  panelKey: string;
  /** Title shown in the collapsed strip */
  title: string;
  /** Which side the panel is on — affects which way the arrow points */
  side?: "left" | "right";
  /** Additional className on the outer wrapper */
  className?: string;
  children: React.ReactNode;
  /** Width class when expanded, e.g. "w-[300px]" */
  expandedWidth?: string;
  /** Default collapsed state (ignored if localStorage has a value) */
  defaultCollapsed?: boolean;
}

const STORAGE_PREFIX = "aumrti_panel_";

function readPanelStorage(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (raw === null) return fallback;
    return raw === "true";
  } catch { return fallback; }
}

function writePanelStorage(key: string, v: boolean) {
  try { localStorage.setItem(STORAGE_PREFIX + key, String(v)); } catch { /* ignore */ }
}

/**
 * Wraps any panel (left or right) with a collapse/expand toggle.
 * When collapsed it shows a thin 40px strip with the title rotated 90°.
 * State is persisted in localStorage so it survives page refreshes.
 */
const CollapsiblePanel: React.FC<Props> = ({
  panelKey,
  title,
  side = "left",
  className,
  children,
  expandedWidth = "w-[300px]",
  defaultCollapsed = false,
}) => {
  const [collapsed, setCollapsed] = useState<boolean>(() =>
    readPanelStorage(panelKey, defaultCollapsed)
  );

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      writePanelStorage(panelKey, next);
      return next;
    });
  }, [panelKey]);

  // Auto-collapse on very small screens (< 768px)
  useEffect(() => {
    const handler = () => {
      if (window.innerWidth < 768) setCollapsed(true);
    };
    handler();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const isLeft = side === "left";

  if (collapsed) {
    return (
      <div
        className={cn(
          "flex-shrink-0 flex flex-col items-center border-slate-200 bg-white relative",
          isLeft ? "border-r w-10" : "border-l w-10",
          className
        )}
      >
        {/* Expand button at top */}
        <button
          onClick={toggle}
          title={`Expand ${title}`}
          className="w-10 h-10 flex items-center justify-center hover:bg-slate-100 transition-colors shrink-0"
        >
          {isLeft ? <ChevronRight size={16} className="text-slate-500" /> : <ChevronLeft size={16} className="text-slate-500" />}
        </button>

        {/* Rotated title */}
        <div className="flex-1 flex items-center justify-center overflow-hidden py-4">
          <span
            className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest select-none whitespace-nowrap"
            style={{ writingMode: "vertical-rl", transform: isLeft ? "rotate(180deg)" : "none" }}
          >
            {title}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex-shrink-0 flex flex-col relative",
        expandedWidth,
        className
      )}
    >
      {/* Collapse toggle — thin strip on the outer edge */}
      <button
        onClick={toggle}
        title={`Collapse ${title}`}
        className={cn(
          "absolute top-1/2 -translate-y-1/2 z-10 flex items-center justify-center",
          "w-5 h-12 rounded-full bg-white border border-slate-200 shadow-sm hover:bg-slate-50 transition-colors",
          isLeft ? "-right-2.5" : "-left-2.5"
        )}
      >
        {isLeft ? <ChevronLeft size={12} className="text-slate-400" /> : <ChevronRight size={12} className="text-slate-400" />}
      </button>

      {children}
    </div>
  );
};

export default CollapsiblePanel;
