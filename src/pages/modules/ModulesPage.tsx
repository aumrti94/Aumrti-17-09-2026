import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Search, LayoutGrid } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  ALL_MODULES,
  CATEGORIES,
  CATEGORY_COLORS,
  getRecentModules,
  trackModuleVisit,
  type ModuleCategory,
  type ModuleDefinition,
} from "@/lib/modules";
import { useHospitalId } from "@/hooks/useHospitalId";
import { hasAccess } from "@/lib/routeRoles";

const ModulesPage: React.FC = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<ModuleCategory | "All">("All");
  const { role, permissions } = useHospitalId();

  const recentModuleRoutes = getRecentModules();
  const recentModules = ALL_MODULES.filter((m) => recentModuleRoutes.includes(m.route) && hasAccess(m.route, role, permissions));

  const filtered = useMemo(() => {
    let list = ALL_MODULES.filter((m) => hasAccess(m.route, role, permissions));
    if (activeCategory !== "All") list = list.filter((m) => m.category === activeCategory);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.desc.toLowerCase().includes(q) ||
          m.category.toLowerCase().includes(q)
      );
    }
    return list;
  }, [search, activeCategory]);

  const grouped = useMemo(() => {
    const map = new Map<ModuleCategory, ModuleDefinition[]>();
    for (const m of filtered) {
      if (!map.has(m.category)) map.set(m.category, []);
      map.get(m.category)!.push(m);
    }
    return map;
  }, [filtered]);

  const handleNav = (route: string) => {
    trackModuleVisit(route);
    navigate(route);
  };

  return (
    <div className="flex flex-col min-h-[calc(100vh-56px)] bg-muted/30">
      {/* Header */}
      <div className="bg-card border-b border-border px-8 py-4 flex items-center gap-6 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <LayoutGrid size={22} className="text-primary" />
            <h1 className="text-xl font-bold text-foreground">All Modules</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {filtered.length} modules available
          </p>
        </div>

        {/* Search */}
        <div className="flex-1 flex justify-center max-w-md mx-auto">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search modules..."
              className="pl-9 h-11 rounded-xl"
            />
          </div>
        </div>

        {/* Category pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            onClick={() => setActiveCategory("All")}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
              activeCategory === "All"
                ? "bg-primary text-primary-foreground"
                : "bg-card border border-border text-muted-foreground hover:text-foreground"
            )}
          >
            All
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
                activeCategory === cat
                  ? "bg-primary text-primary-foreground"
                  : "bg-card border border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {/* Recently used */}
        {recentModules.length > 0 && activeCategory === "All" && !search && (
          <div className="mb-8">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
              Recently Used
            </h2>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {recentModules.map((m) => (
                <button
                  key={m.route}
                  onClick={() => handleNav(m.route)}
                  className="flex flex-col items-center gap-1.5 w-20 shrink-0 group"
                >
                  <div className="w-12 h-12 rounded-xl bg-card border border-border flex items-center justify-center text-xl group-hover:border-primary group-hover:shadow-md transition-all">
                    {m.icon}
                  </div>
                  <span className="text-[11px] text-foreground font-medium text-center leading-tight line-clamp-2">
                    {m.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* No results */}
        {filtered.length === 0 && (
          <div className="text-center py-20 text-muted-foreground">
            <p className="text-sm">No modules found for &ldquo;{search}&rdquo;</p>
          </div>
        )}

        {/* Category groups */}
        {CATEGORIES.filter((c) => grouped.has(c)).map((cat) => (
          <div key={cat} className="mb-8">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
              {cat}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {grouped.get(cat)!.map((m) => (
                <ModuleCard key={m.route + m.name} module={m} onClick={() => handleNav(m.route)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const ModuleCard: React.FC<{ module: ModuleDefinition; onClick: () => void }> = ({
  module,
  onClick,
}) => {
  const bgColor = CATEGORY_COLORS[module.category] || "#64748B";

  return (
    <button
      onClick={onClick}
      className="bg-card border border-border rounded-xl px-4 py-5 flex flex-col items-center gap-2.5 text-center cursor-pointer transition-all hover:border-primary hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:shadow-none"
    >
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
        style={{ backgroundColor: `${bgColor}15` }}
      >
        {module.icon}
      </div>
      <span className="text-[13px] font-semibold text-foreground leading-tight">
        {module.name}
      </span>
      <span className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
        {module.desc}
      </span>
      {module.isNew && (
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
          NEW
        </span>
      )}
    </button>
  );
};

export default ModulesPage;
