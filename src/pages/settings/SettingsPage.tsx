import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Search, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  SETTINGS_CATALOG,
  SETTINGS_GROUP_ORDER,
  GROUP_EMOJI,
  searchSettings,
  entryRoute,
  crossCuttingHint,
  moduleShortLabel,
  type SettingsEntry,
} from "@/lib/settingsCatalog";

const highlightMatch = (text: string, query: string) => {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-200/80 text-inherit rounded-sm px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
};

interface CardProps {
  entry: SettingsEntry;
  query: string;
  /** Module context the card was surfaced under — drives deep link + "why this matched" line. */
  moduleKey?: string;
  onOpen: (route: string) => void;
}

const SettingsCard: React.FC<CardProps> = ({ entry, query, moduleKey, onOpen }) => {
  const Icon = entry.icon;
  const hint = crossCuttingHint(entry, moduleKey);
  return (
    <button
      onClick={() => onOpen(entryRoute(entry, moduleKey))}
      className={cn(
        "group bg-card border border-border rounded-xl p-[18px] text-left",
        "cursor-pointer transition-all duration-150",
        "hover:border-primary hover:shadow-md hover:-translate-y-0.5",
        "active:scale-[0.98] flex flex-col"
      )}
    >
      <div className="flex items-start justify-between">
        <div className="h-10 w-10 rounded-[10px] bg-muted flex items-center justify-center">
          <Icon size={20} className="text-foreground" />
        </div>
        <ChevronRight
          size={14}
          className="text-muted-foreground/40 group-hover:text-primary transition-colors mt-1"
        />
      </div>
      <h3 className="text-sm font-bold text-foreground mt-3">{highlightMatch(entry.title, query)}</h3>
      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
        {highlightMatch(entry.desc, query)}
      </p>
      {hint && (
        <p className="text-[11px] text-primary/80 mt-2 leading-relaxed">↳ {hint}</p>
      )}
    </button>
  );
};

const SectionHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">{children}</p>
);

const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const query = search.trim();

  /** Browse mode: the full catalog grouped exactly as before. */
  const browseGroups = useMemo(
    () =>
      SETTINGS_GROUP_ORDER.map((label) => ({
        label,
        cards: SETTINGS_CATALOG.filter((e) => e.group === label),
      })).filter((g) => g.cards.length > 0),
    []
  );

  const results = useMemo(() => searchSettings(query), [query]);

  // Primary module the query resolved to — labels the sections and picks the deep links.
  const primaryModule = results.moduleKeys[0];
  const moduleTitle = primaryModule ? moduleShortLabel(primaryModule) : "";
  const open = (route: string) => navigate(route);

  if (!query) {
    return (
      <Shell search={search} setSearch={setSearch}>
        {browseGroups.map((group) => (
          <div key={group.label} className="mb-8">
            <SectionHeading>
              {GROUP_EMOJI[group.label]} {group.label}
            </SectionHeading>
            <div className="grid grid-cols-4 gap-3.5">
              {group.cards.map((entry) => (
                <SettingsCard
                  key={entry.route + entry.title}
                  entry={entry}
                  query=""
                  onOpen={open}
                />
              ))}
            </div>
          </div>
        ))}
      </Shell>
    );
  }

  const nothingFound = results.direct.length === 0 && results.crossCutting.length === 0;

  return (
    <Shell search={search} setSearch={setSearch}>
      {nothingFound && (
        <div className="text-center py-20">
          <p className="text-sm text-muted-foreground">
            No settings found for "<span className="font-medium text-foreground">{search}</span>"
          </p>
        </div>
      )}

      {results.direct.length > 0 && (
        <div className="mb-8">
          <SectionHeading>
            {primaryModule ? `${moduleTitle} settings` : "Matching settings"} ({results.direct.length})
          </SectionHeading>
          <div className="grid grid-cols-4 gap-3.5">
            {results.direct.map((entry) => (
              <SettingsCard
                key={entry.route + entry.title}
                entry={entry}
                query={query}
                moduleKey={primaryModule}
                onOpen={open}
              />
            ))}
          </div>
        </div>
      )}

      {results.crossCutting.length > 0 && (
        <div className="mb-8">
          <SectionHeading>
            Also configures {moduleTitle} ({results.crossCutting.length})
          </SectionHeading>
          <div className="grid grid-cols-4 gap-3.5">
            {results.crossCutting.map((entry) => (
              <SettingsCard
                key={entry.route + entry.title}
                entry={entry}
                query={query}
                moduleKey={primaryModule}
                onOpen={open}
              />
            ))}
          </div>
        </div>
      )}
    </Shell>
  );
};

/** Page chrome — header, search box, scroll container. */
const Shell: React.FC<{
  search: string;
  setSearch: (v: string) => void;
  children: React.ReactNode;
}> = ({ search, setSearch, children }) => (
  <div className="h-[calc(100vh-56px)] flex flex-col overflow-hidden bg-background">
    <div className="flex-shrink-0 h-16 flex items-center justify-between px-8 border-b border-border bg-card">
      <div>
        <h1 className="text-xl font-bold text-foreground">Settings</h1>
        <p className="text-xs text-muted-foreground">Configure your hospital system</p>
      </div>
      <div className="relative w-[280px]">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search settings or a module…"
          className="pl-9 h-10 bg-muted/50 border-border rounded-[10px] text-sm"
        />
      </div>
    </div>

    <div className="flex-1 overflow-y-auto px-8 py-7">{children}</div>
  </div>
);

export default SettingsPage;
