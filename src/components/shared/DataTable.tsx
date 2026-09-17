import React from "react";
import { cn } from "@/lib/utils";

/**
 * Shared table chrome for admin/list-style tables. Factors out the header
 * row, sticky-header, loading/empty states, and row hover styling that was
 * duplicated identically across platform pages (PlatformDashboard,
 * HospitalsListPage, AuditLogPage, and others) — column definitions and row
 * cell content stay page-local since those genuinely differ per page.
 */
export interface DataTableColumn {
  key: string;
  /** Header cell content — usually a label, sometimes a sort button. */
  header: React.ReactNode;
  className?: string;
}

export interface DataTableProps {
  columns: DataTableColumn[];
  loading?: boolean;
  loadingMessage?: string;
  empty?: boolean;
  emptyMessage?: string;
  /** Sticky header (`thead` pinned with `sticky top-0`). Default true. */
  sticky?: boolean;
  children: React.ReactNode;
  className?: string;
}

export const DataTable: React.FC<DataTableProps> = ({
  columns,
  loading,
  loadingMessage = "Loading…",
  empty,
  emptyMessage = "No records found",
  sticky = true,
  children,
  className,
}) => {
  return (
    <table className={cn("w-full text-sm", className)}>
      <thead className={cn(sticky && "sticky top-0 bg-card z-10")}>
        <tr className="text-[10px] uppercase font-bold text-muted-foreground border-b border-border">
          {columns.map((col) => (
            <th key={col.key} className={cn("px-5 py-3 text-left", col.className)}>
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <tr>
            <td colSpan={columns.length} className="px-5 py-10 text-center text-xs text-muted-foreground">
              {loadingMessage}
            </td>
          </tr>
        ) : empty ? (
          <tr>
            <td colSpan={columns.length} className="px-5 py-10 text-center text-xs text-muted-foreground">
              {emptyMessage}
            </td>
          </tr>
        ) : (
          children
        )}
      </tbody>
    </table>
  );
};

/** Convenience row wrapper — same hover/border chrome used on every table. */
export const DataTableRow: React.FC<React.HTMLAttributes<HTMLTableRowElement>> = ({ className, ...props }) => (
  <tr className={cn("border-t border-border hover:bg-muted/40 transition-colors", className)} {...props} />
);

export default DataTable;
