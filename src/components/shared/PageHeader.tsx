import React from "react";
import { cn } from "@/lib/utils";

/**
 * Shared page-title row. Replaces the
 * `h-14 border-b border-border flex items-center justify-between px-6 shrink-0`
 * block that was duplicated verbatim across every platform admin page (and is
 * the same shape Dashboard-style HMS pages already use informally).
 */
export interface PageHeaderProps {
  title: React.ReactNode;
  /** Optional line under the title (e.g. a short description). */
  subtitle?: React.ReactNode;
  /**
   * Extra interactive content next to the title but outside the `<h1>`
   * (e.g. a tab switcher) — keeps the title semantically a plain heading
   * rather than nesting buttons inside it.
   */
  titleExtra?: React.ReactNode;
  /** Right-aligned slot for buttons, filters, refresh, tabs, etc. */
  actions?: React.ReactNode;
  /** Optional search box/slot rendered before `actions`. */
  search?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, titleExtra, actions, search, className }) => {
  return (
    <div className={cn("h-14 border-b border-border flex items-center justify-between px-6 shrink-0 gap-4", className)}>
      <div className="min-w-0 flex items-center gap-4">
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold text-foreground truncate">{title}</h1>
          {subtitle && <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>}
        </div>
        {titleExtra}
      </div>
      {(search || actions) && (
        <div className="flex items-center gap-4 shrink-0">
          {search}
          {actions}
        </div>
      )}
    </div>
  );
};

export default PageHeader;
