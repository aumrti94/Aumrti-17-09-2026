import React, { useEffect, useState } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { PlayCircle, X } from "lucide-react";

interface TrainingVideo {
  id: string;
  title: string;
  description: string | null;
  video_url: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  category: string;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function toEmbedUrl(url: string): string {
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  return url;
}

const SettingsTrainingPage: React.FC = () => {
  const [videos, setVideos] = useState<TrainingVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [playing, setPlaying] = useState<TrainingVideo | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from("platform_training_videos")
        .select("id, title, description, video_url, thumbnail_url, duration_seconds, category")
        .order("sort_order", { ascending: true });
      setVideos(data || []);
      setLoading(false);
    })();
  }, []);

  const filtered = search
    ? videos.filter((v) => v.title.toLowerCase().includes(search.toLowerCase()) || v.category.toLowerCase().includes(search.toLowerCase()))
    : videos;

  const categories = Array.from(new Set(filtered.map((v) => v.category)));

  return (
    <SettingsPageWrapper title="Training Videos" hideSave>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground max-w-xl">Short how-to videos for using Aumrti, by role and workflow.</p>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search videos…" className="h-9 max-w-xs" />
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-10">Loading…</p>
        ) : videos.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10">No training videos published yet.</p>
        ) : filtered.length === 0 ? (
          // The list below renders `filtered`, so a search matching nothing used to fall
          // through to an empty grid — a blank panel reads as a broken page, and someone who
          // thinks training is broken stops looking for the video they needed.
          <p className="text-sm text-muted-foreground text-center py-10">
            No videos match “{search}”. Try a shorter search, or clear it to see all {videos.length}.
          </p>
        ) : (
          categories.map((cat) => (
            <div key={cat} className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide capitalize">{cat}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.filter((v) => v.category === cat).map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setPlaying(v)}
                    className="text-left border border-border rounded-xl overflow-hidden hover:border-primary transition-colors"
                  >
                    <div className="h-32 bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center relative">
                      {v.thumbnail_url ? (
                        <img src={v.thumbnail_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <PlayCircle className="h-10 w-10 text-slate-400" />
                      )}
                      {v.duration_seconds && (
                        <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded font-mono">
                          {formatDuration(v.duration_seconds)}
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <p className="text-sm font-semibold text-foreground leading-tight">{v.title}</p>
                      {v.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{v.description}</p>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {playing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={() => setPlaying(null)}>
          <div className="bg-card rounded-xl w-full max-w-3xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <p className="text-sm font-semibold text-foreground">{playing.title}</p>
              <button onClick={() => setPlaying(null)}><X size={16} className="text-muted-foreground hover:text-foreground" /></button>
            </div>
            <div className="aspect-video bg-black">
              <iframe
                src={toEmbedUrl(playing.video_url)}
                title={playing.title}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}
    </SettingsPageWrapper>
  );
};

export default SettingsTrainingPage;
