import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { EntityList } from "@/components/shared/EntityList";
import { ArrowLeft, Plus, Save } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";

export default function SpecialtyTemplateBuilderPage() {
  const { hospitalId } = useHospitalId();
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [searchTerm, setSearchTerm] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState({ title: "", specialty: "general", description: "" });

  const { data: templates, isLoading } = useQuery({
    queryKey: ["emr_template_definitions", hospitalId],
    queryFn: async () => {
      if (!hospitalId) return [];
      const { data, error } = await supabase
        .from("emr_template_definitions")
        .select("*")
        .eq("hospital_id", hospitalId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!hospitalId,
  });

  const saveTemplate = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("emr_template_definitions").insert({
        hospital_id: hospitalId,
        title: form.title,
        specialty: form.specialty,
        description: form.description,
        form_schema_json: [],
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Template created successfully" });
      qc.invalidateQueries({ queryKey: ["emr_template_definitions"] });
      setDrawerOpen(false);
      setForm({ title: "", specialty: "general", description: "" });
    },
    onError: (e: any) => toast({ title: "Error saving template", description: e.message, variant: "destructive" }),
  });

  const columns = [
    { key: "title", header: "Template Name", render: (item: any) => <span className="font-semibold">{item.title}</span> },
    { key: "specialty", header: "Specialty", render: (item: any) => <span className="capitalize px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-[11px]">{item.specialty}</span> },
    { key: "description", header: "Description" },
    { key: "version", header: "Version" },
    {
      key: "is_active",
      header: "Status",
      render: (item: any) => (
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${item.is_active ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
          {item.is_active ? "Active" : "Draft"}
        </span>
      ),
    },
  ];

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col p-6 space-y-4 relative">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/settings")} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-foreground">EMR Template Builder</h1>
            <p className="text-sm text-muted-foreground">Create dynamic clinical forms for specialties</p>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <EntityList
          title="Clinical Templates"
          data={templates || []}
          columns={columns}
          isLoading={isLoading}
          searchPlaceholder="Search templates..."
          onSearch={setSearchTerm}
          onAdd={() => setDrawerOpen(true)}
        />
      </div>

      {drawerOpen && (
        <div className="absolute inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/20" onClick={() => setDrawerOpen(false)} />
          <div className="relative w-[400px] bg-card border-l border-border flex flex-col shadow-xl animate-in slide-in-from-right">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-bold">New Template</h2>
            </div>
            <div className="flex-1 p-4 space-y-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Title</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full h-9 rounded-md border border-input px-3 text-sm"
                  placeholder="e.g. Initial ANC Visit"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Specialty</label>
                <select
                  value={form.specialty}
                  onChange={(e) => setForm({ ...form, specialty: e.target.value })}
                  className="w-full h-9 rounded-md border border-input px-3 text-sm capitalize"
                >
                  {["general", "obstetrics", "dental", "ayush", "oncology", "pediatrics", "ophthalmology"].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full min-h-[80px] rounded-md border border-input px-3 py-2 text-sm"
                  placeholder="What is this template for?"
                />
              </div>
            </div>
            <div className="p-4 border-t border-border">
              <button
                onClick={() => saveTemplate.mutate()}
                disabled={!form.title || saveTemplate.isPending}
                className="w-full h-10 flex items-center justify-center gap-2 bg-[hsl(222,55%,23%)] text-white rounded-md font-medium disabled:opacity-50"
              >
                <Save size={16} /> Save Template
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
