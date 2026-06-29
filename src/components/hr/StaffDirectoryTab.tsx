import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AlertTriangle, Phone, Search, MessageSquare } from "lucide-react";
import { differenceInDays, format } from "date-fns";

interface StaffMember {
  user_id: string;
  full_name: string;
  role: string;
  phone: string;
  department_name: string;
  employee_id: string;
  designation: string;
  employment_type: string;
  license_expiry_date: string | null;
  registration_number: string | null;
  registration_body: string | null;
  is_active: boolean;
}

const roleColors: Record<string, string> = {
  doctor: "hsl(var(--primary))",
  nurse: "hsl(var(--chart-4))",
  admin: "hsl(var(--chart-2))",
  pharmacist: "hsl(var(--chart-3))",
  lab_tech: "hsl(var(--chart-5))",
};

const StaffDirectoryTab: React.FC = () => {
  const { toast } = useToast();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [expiringStaff, setExpiringStaff] = useState<StaffMember[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const { data: depts } = await supabase.from("departments").select("id, name").eq("is_active", true).order("name", { ascending: true });
    setDepartments(depts || []);

    const { data: users } = await supabase.from("users").select("id, full_name, role, phone, department_id, is_active").eq("is_active", true);
    const { data: profiles } = await (supabase as any).from("staff_profiles").select("*");

    const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));
    const deptMap = new Map((depts || []).map((d: any) => [d.id, d.name]));

    const merged: StaffMember[] = (users || []).map((u: any) => {
      const p = profileMap.get(u.id) || {} as any;
      return {
        user_id: u.id,
        full_name: u.full_name,
        role: u.role,
        phone: u.phone || "",
        department_name: deptMap.get(u.department_id || p.department_id) || "—",
        employee_id: p.employee_id || "—",
        designation: p.designation || u.role,
        employment_type: p.employment_type || "permanent",
        license_expiry_date: p.license_expiry_date,
        registration_number: p.registration_number || u.registration_number,
        registration_body: p.registration_body,
        is_active: u.is_active,
      };
    });

    setStaff(merged);

    const expiring = merged.filter((s) => {
      if (!s.license_expiry_date) return false;
      const days = differenceInDays(new Date(s.license_expiry_date), new Date());
      return days <= 90;
    }).sort((a, b) => {
      const da = differenceInDays(new Date(a.license_expiry_date!), new Date());
      const db = differenceInDays(new Date(b.license_expiry_date!), new Date());
      return da - db;
    });
    setExpiringStaff(expiring);
  };

  const filtered = staff.filter((s) => {
    if (search && !s.full_name.toLowerCase().includes(search.toLowerCase()) && !s.employee_id.toLowerCase().includes(search.toLowerCase()) && !s.phone.includes(search)) return false;
    if (roleFilter !== "all" && s.role !== roleFilter) return false;
    if (deptFilter !== "all" && s.department_name !== deptFilter) return false;
    return true;
  });

  const getInitials = (name: string) => name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  const getLicenseStatus = (date: string | null) => {
    if (!date) return null;
    const days = differenceInDays(new Date(date), new Date());
    if (days < 0) return { label: "EXPIRED", color: "destructive" as const, days };
    if (days <= 30) return { label: `${days}d left`, color: "destructive" as const, days };
    if (days <= 60) return { label: `${days}d left`, color: "default" as const, days };
    if (days <= 90) return { label: `${days}d left`, color: "secondary" as const, days };
    return { label: `Valid until ${format(new Date(date), "dd MMM yyyy")}`, color: "secondary" as const, days };
  };

  const sendReminder = (s: StaffMember) => {
    const msg = encodeURIComponent(
      `Dear ${s.full_name}, your ${s.registration_body || "medical"} license (Reg No: ${s.registration_number || "N/A"}) expires on ${s.license_expiry_date}. Please renew to avoid disruption. — HR Team`
    );
    window.open(`https://wa.me/${s.phone?.replace(/\D/g, "")}?text=${msg}`, "_blank", "noopener,noreferrer");
  };

  const roles = Array.from(new Set(staff.map((s) => s.role)));

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* License Expiry Alert Panel */}
      {expiringStaff.length > 0 && (
        <div className="mx-5 mt-4 bg-destructive/5 border border-destructive/20 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-destructive flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4" /> Staff License Expiry Alerts ({expiringStaff.length})
          </h4>
          <div className="space-y-1.5">
            {expiringStaff.slice(0, 5).map((s) => {
              const status = getLicenseStatus(s.license_expiry_date);
              const days = status?.days ?? 0;
              return (
                <div key={s.user_id} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-foreground">{s.full_name}</span>
                    <span className="text-muted-foreground">{s.role}</span>
                    <span className="text-muted-foreground">{s.registration_body}</span>
                    <span className="text-muted-foreground">{s.license_expiry_date}</span>
                    <span className={`font-semibold ${days < 0 ? "text-destructive" : days <= 30 ? "text-destructive" : days <= 60 ? "text-orange-500" : "text-amber-500"}`}>
                      {days < 0 ? "EXPIRED" : `${days} days left`}
                    </span>
                  </div>
                  <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => sendReminder(s)}>
                    <MessageSquare className="h-3 w-3 mr-1" /> Remind
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="h-12 flex-shrink-0 flex items-center gap-3 px-5 border-b border-border">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search name, ID, phone..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-8 text-sm" />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-36 h-8 text-sm"><SelectValue placeholder="All Roles" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            {roles.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="w-40 h-8 text-sm"><SelectValue placeholder="All Departments" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {departments.map((d) => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Staff Grid */}
      <div className="flex-1 overflow-auto p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((s) => {
            const licStatus = getLicenseStatus(s.license_expiry_date);
            const bgColor = roleColors[s.role] || "hsl(var(--muted))";
            return (
              <div key={s.user_id} className="bg-card border border-border rounded-lg p-4 hover:shadow-sm transition-shadow">
                <div className="flex items-start gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback style={{ backgroundColor: bgColor, color: "white" }} className="text-xs font-semibold">
                      {getInitials(s.full_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{s.full_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{s.designation} · {s.department_name}</p>
                    <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{s.employee_id}</p>
                  </div>
                </div>
                {s.phone && (
                  <a href={`tel:${s.phone}`} className="flex items-center gap-1.5 text-xs text-primary mt-2">
                    <Phone className="h-3 w-3" /> {s.phone}
                  </a>
                )}
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <Badge variant="secondary" className="text-[10px]">{s.role}</Badge>
                  <Badge variant="outline" className="text-[10px]">{s.employment_type}</Badge>
                </div>
                {licStatus && (
                  <div className="mt-2">
                    <Badge variant={licStatus.color} className="text-[10px]">
                      {licStatus.days < 0 ? "🔴" : licStatus.days <= 30 ? "🔴" : licStatus.days <= 60 ? "⚠️" : "✓"} {licStatus.label}
                    </Badge>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-sm">No staff members found</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default StaffDirectoryTab;
