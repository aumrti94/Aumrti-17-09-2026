import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, X, UserPlus } from "lucide-react";

interface Patient {
  id: string;
  full_name: string;
  uhid: string;
  phone: string | null;
  gender: string | null;
}

interface Props {
  hospitalId: string;
  value: string; // patient_id
  onChange: (patientId: string) => void;
  onRegisterNew?: () => void;
  placeholder?: string;
  selectedLabel?: string; // display name for selected patient
}

const PatientSearchPicker: React.FC<Props> = ({
  hospitalId, value, onChange, onRegisterNew, placeholder = "Search by name or UHID…", selectedLabel
}) => {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Patient[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState(selectedLabel || "");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  // If value set externally, try to resolve display name
  useEffect(() => {
    if (value && !displayName) {
      supabase.from("patients").select("full_name, uhid").eq("id", value).maybeSingle().then(({ data }) => {
        if (data) setDisplayName(`${data.full_name} (${data.uhid})`);
      });
    }
    if (!value) setDisplayName("");
  }, [value]);

  useEffect(() => {
    if (selectedLabel) setDisplayName(selectedLabel);
  }, [selectedLabel]);

  useEffect(() => {
    if (!search.trim() || search.length < 2) { setResults([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      const q = `%${search.trim()}%`;
      const { data, error } = await supabase
        .from("patients")
        .select("id, full_name, uhid, phone, gender")
        .eq("hospital_id", hospitalId)
        .or(`full_name.ilike.${q},uhid.ilike.${q}`)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) console.error("Patient search error:", error.message);
      setResults(data || []);
      setSearching(false);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, hospitalId]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (value && displayName) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="text-xs py-1 px-2 max-w-full truncate">{displayName}</Badge>
        <button type="button" onClick={() => { onChange(""); setDisplayName(""); setSearch(""); }} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={e => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => { if (search.length >= 2) setOpen(true); }}
          placeholder={placeholder}
          className="pl-8 h-9 text-sm"
        />
      </div>
      {open && (search.length >= 2) && (
        <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-[200px] overflow-y-auto">
          {searching && <div className="p-3 text-xs text-muted-foreground text-center">Searching…</div>}
          {!searching && results.length === 0 && <div className="p-3 text-xs text-muted-foreground text-center">No patients found</div>}
          {results.map(p => (
            <button
              key={p.id}
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-accent/50 flex items-center justify-between text-sm border-b last:border-b-0"
              onClick={() => { onChange(p.id); setDisplayName(`${p.full_name} (${p.uhid})`); setOpen(false); setSearch(""); }}
            >
              <div>
                <div className="font-medium text-foreground">{p.full_name}</div>
                <div className="text-xs text-muted-foreground">{p.uhid} {p.phone ? `• ${p.phone}` : ""}</div>
              </div>
              {p.gender && <Badge variant="outline" className="text-[10px] capitalize">{p.gender}</Badge>}
            </button>
          ))}
          {onRegisterNew && (
            <button
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-accent/50 text-sm font-medium text-primary flex items-center gap-1.5 border-t"
              onClick={() => { setOpen(false); onRegisterNew(); }}
            >
              <UserPlus size={14} /> + Register New Patient
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default PatientSearchPicker;
