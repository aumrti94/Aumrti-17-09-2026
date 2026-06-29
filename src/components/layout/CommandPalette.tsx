import React, { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ALL_MODULES, trackModuleVisit } from "@/lib/modules";
import { useHospitalId } from "@/hooks/useHospitalId";
import { hasAccess } from "@/lib/routeRoles";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

const CommandPalette: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const { role, permissions } = useHospitalId();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const results = useMemo(() => {
    if (!query.trim()) return ALL_MODULES.filter((m) => hasAccess(m.route, role, permissions));
    const q = query.toLowerCase();
    return ALL_MODULES.filter(
      (m) =>
        (m.name.toLowerCase().includes(q) || m.desc.toLowerCase().includes(q)) &&
        hasAccess(m.route, role, permissions)
    );
  }, [query, role, permissions]);

  const handleSelect = (route: string) => {
    trackModuleVisit(route);
    navigate(route);
    setOpen(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Jump to module..." />
      <CommandList>
        <CommandEmpty>No modules found.</CommandEmpty>
        <CommandGroup heading="Modules">
          {ALL_MODULES.filter(m => hasAccess(m.route, role, permissions)).map((m) => (
            <CommandItem
              key={m.route + m.name}
              value={`${m.name} ${m.desc} ${m.category}`}
              onSelect={() => handleSelect(m.route)}
            >
              <span className="mr-2 text-lg">{m.icon}</span>
              <div className="flex-1 min-w-0">
                <span className="font-medium">{m.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{m.category}</span>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};

export default CommandPalette;
