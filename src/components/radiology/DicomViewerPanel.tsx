import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Upload, ImageIcon, ExternalLink, Download, Trash2,
  ZoomIn, ZoomOut, RotateCw, RefreshCw, Loader2,
  MonitorPlay, FileImage, Info, Settings, ChevronLeft, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  parseDicomFile, parseDicomFromUrl, formatDicomDate,
  renderDicomFrame, getHUAtPixel, WL_PRESETS,
  type DicomMetadata,
} from "@/lib/dicomParser";
import { callAI } from "@/lib/aiProvider";

interface DicomFile {
  id: string;
  storage_path: string;
  original_filename: string;
  file_size_bytes: number | null;
  modality: string | null;
  series_description: string | null;
  series_number: number | null;
  instance_number: number | null;
  rows: number | null;
  columns: number | null;
  number_of_frames: number | null;
  bits_allocated: number | null;
  is_jpeg_compressed: boolean;
  study_instance_uid: string | null;
  uploaded_at: string;
}

interface PacsConfig {
  id?: string;
  pacs_type: string;
  pacs_name: string | null;
  wado_uri_root: string | null;
  wado_rs_root: string | null;
  ohif_viewer_url: string | null;
  ae_title: string | null;
  is_active: boolean;
}

interface Props {
  orderId: string;
  patientName?: string;
  accessionNumber?: string;
  modalityType?: string;
  studyName?: string;
  currentPacsUrl?: string | null;  // legacy dicom_pacs_url on order
  onPacsUrlSaved?: (url: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Clinical-Grade Image Viewer (Gap 9)
// Supports both JPEG-compressed (img tag) and raw 16-bit (canvas + W/L)
// ─────────────────────────────────────────────────────────────────────────────
type Tool = "none" | "measure" | "hu_probe";

interface ImageViewerProps {
  src: string | null;        // JPEG blob URL (null for raw pixel mode)
  filename: string;
  isJpeg: boolean;
  meta: DicomMetadata;
  hospitalId: string;
  totalFrames: number;
  frameIndex: number;
  onFrameChange: (i: number) => void;
}

const ImageViewer: React.FC<ImageViewerProps> = ({
  src, filename, isJpeg, meta, hospitalId,
  totalFrames, frameIndex, onFrameChange,
}) => {
  const { toast } = useToast();

  // View controls
  const [zoom, setZoom]         = useState(1);
  const [rotate, setRotate]     = useState(0);
  const [showMeta, setShowMeta] = useState(false);

  // W/L controls (for raw pixel rendering)
  const [wc, setWc] = useState(40);
  const [ww, setWw] = useState(400);

  // JPEG W/L via CSS filter
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast]     = useState(100);

  // Measurement tool
  const [tool, setTool]           = useState<Tool>("none");
  const [huValue, setHuValue]     = useState<number | null>(null);
  const [measureStart, setMeasureStart] = useState<{x:number;y:number} | null>(null);
  const [measureEnd, setMeasureEnd]     = useState<{x:number;y:number} | null>(null);
  const [measurePx, setMeasurePx]       = useState<number | null>(null);

  // Cine animation
  const [playing, setPlaying] = useState(false);
  const [cineSpeed, setCineSpeed] = useState(8); // fps
  const cineRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // AI Impression
  const [aiLoading, setAiLoading] = useState(false);
  const [aiImpression, setAiImpression] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Re-render canvas when frame/WL changes
  useEffect(() => {
    if (!isJpeg && meta.rawPixels && canvasRef.current) {
      renderDicomFrame(canvasRef.current, meta, frameIndex, wc, ww);
    }
  }, [isJpeg, meta, frameIndex, wc, ww]);

  // Latest-ref: the parent passes a fresh `onFrameChange` every render, so
  // depending on it directly would tear down and restart the cine interval each
  // time — visibly stuttering playback.
  const onFrameChangeRef = useRef(onFrameChange);
  useEffect(() => { onFrameChangeRef.current = onFrameChange; });

  // Cine playback
  useEffect(() => {
    if (cineRef.current) clearInterval(cineRef.current);
    if (playing && totalFrames > 1) {
      cineRef.current = setInterval(() => {
        onFrameChangeRef.current((frameIndex + 1) % totalFrames);
      }, Math.round(1000 / cineSpeed));
    }
    return () => { if (cineRef.current) clearInterval(cineRef.current); };
  }, [playing, cineSpeed, frameIndex, totalFrames]);

  const applyWLPreset = (preset: typeof WL_PRESETS[0]) => {
    setWc(preset.wc);
    setWw(preset.ww);
  };

  const reset = () => {
    setZoom(1); setRotate(0); setBrightness(100); setContrast(100);
    setWc(40); setWw(400); setMeasureStart(null); setMeasureEnd(null);
    setMeasurePx(null); setHuValue(null); setTool("none");
  };

  // Pointer events for measurement and HU probe
  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = e.currentTarget.width / rect.width;
    const scaleY = e.currentTarget.height / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  };

  const handleCanvasPointerDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e);
    if (tool === "measure") {
      setMeasureStart({ x, y });
      setMeasureEnd(null);
      setMeasurePx(null);
    } else if (tool === "hu_probe") {
      const hu = getHUAtPixel(meta, x, y, frameIndex);
      setHuValue(hu);
    }
  };

  const handleCanvasPointerMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e);
    if (tool === "measure" && measureStart) {
      setMeasureEnd({ x, y });
      const dx = x - measureStart.x;
      const dy = y - measureStart.y;
      setMeasurePx(Math.round(Math.sqrt(dx * dx + dy * dy)));
    } else if (tool === "hu_probe") {
      const hu = getHUAtPixel(meta, x, y, frameIndex);
      setHuValue(hu);
    }
    // Draw measurement line on overlay canvas
    if (tool === "measure" && measureStart && overlayRef.current) {
      const oc = overlayRef.current;
      const ctx = oc.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, oc.width, oc.height);
        ctx.strokeStyle = "#facc15";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(measureStart.x, measureStart.y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.fillStyle = "#facc15";
        ctx.font = "12px monospace";
        ctx.fillText(`${Math.round(Math.sqrt((x-measureStart.x)**2 + (y-measureStart.y)**2))} px`, x + 4, y - 4);
      }
    }
  };

  const runAIImpression = async () => {
    if (!hospitalId || !meta.modality) return;
    setAiLoading(true);
    try {
      const resp = await callAI({
        featureKey: "radiology_impression",
        hospitalId,
        prompt: `Generate a concise radiology impression for: Modality: ${meta.modality}, Series: ${meta.seriesDescription || "Unknown"}, Study: ${meta.studyDescription || "Unknown"}. Patient: ${meta.patientName || "Anonymous"}. Study date: ${meta.studyDate ? formatDicomDate(meta.studyDate) : "Unknown"}. Provide a structured impression as a radiologist would, with findings and conclusion sections.`,
        maxTokens: 600,
      });
      if (resp.error || !resp.text) {
        toast({ title: "AI impression failed", description: resp.error || "Empty response", variant: "destructive" });
      } else {
        setAiImpression(resp.text);
      }
    } catch {
      toast({ title: "AI impression failed", variant: "destructive" });
    }
    setAiLoading(false);
  };

  const toolBtnClass = (t: Tool) =>
    cn("p-1.5 rounded text-[11px] font-medium transition-colors", tool === t ? "bg-yellow-500 text-black" : "text-slate-300 hover:bg-slate-700");

  return (
    <div className="flex flex-col h-full bg-black">
      {/* ── Toolbar ── */}
      <div className="shrink-0 bg-slate-900 border-b border-slate-700 px-2 py-1 flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] text-slate-400 font-mono truncate max-w-[140px]">{filename}</span>
        {meta.modality && <Badge variant="outline" className="text-[9px] border-slate-600 text-slate-300 h-4">{meta.modality}</Badge>}
        {meta.rows && meta.columns && <span className="text-[10px] text-slate-500">{meta.columns}×{meta.rows}</span>}

        <div className="w-px h-4 bg-slate-700 mx-1" />

        {/* W/L presets — only for raw pixel */}
        {!isJpeg && meta.rawPixels && (
          <>
            {WL_PRESETS.map(p => (
              <button key={p.label} onClick={() => applyWLPreset(p)}
                className={cn("text-[10px] px-1.5 py-0.5 rounded border transition-colors", wc === p.wc && ww === p.ww ? "bg-blue-600 border-blue-500 text-white" : "border-slate-600 text-slate-400 hover:border-slate-400 hover:text-slate-200")}>
                {p.label}
              </button>
            ))}
            <div className="flex items-center gap-1 ml-1">
              <span className="text-[9px] text-slate-500">WC</span>
              <input type="number" value={wc} onChange={e => setWc(Number(e.target.value))} className="w-14 bg-slate-800 border border-slate-700 text-slate-200 text-[10px] px-1 py-0 h-5 rounded" />
              <span className="text-[9px] text-slate-500">WW</span>
              <input type="number" value={ww} onChange={e => setWw(Number(e.target.value))} className="w-16 bg-slate-800 border border-slate-700 text-slate-200 text-[10px] px-1 py-0 h-5 rounded" />
            </div>
            <div className="w-px h-4 bg-slate-700 mx-1" />
          </>
        )}

        {/* JPEG W/L via CSS */}
        {isJpeg && (
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-slate-400">Bright</span>
            <input type="range" min={20} max={300} value={brightness} onChange={e => setBrightness(Number(e.target.value))} className="w-16 h-1 accent-blue-400" />
            <span className="text-[9px] text-slate-400">Contrast</span>
            <input type="range" min={20} max={300} value={contrast} onChange={e => setContrast(Number(e.target.value))} className="w-16 h-1 accent-blue-400" />
          </div>
        )}

        <div className="w-px h-4 bg-slate-700 mx-1" />

        {/* Tools */}
        <button onClick={() => setTool(t => t === "measure" ? "none" : "measure")} className={toolBtnClass("measure")} title="Measure distance (px)">📏</button>
        {!isJpeg && meta.rawPixels && (
          <button onClick={() => setTool(t => t === "hu_probe" ? "none" : "hu_probe")} className={toolBtnClass("hu_probe")} title="HU probe">HU</button>
        )}
        {huValue !== null && <span className="text-[11px] text-yellow-400 font-mono">{huValue} HU</span>}
        {measurePx !== null && <span className="text-[11px] text-yellow-400 font-mono">{measurePx} px</span>}

        <div className="w-px h-4 bg-slate-700 mx-1" />

        {/* Zoom / Rotate */}
        <button onClick={() => setZoom(z => Math.min(z + 0.25, 4))} className="text-slate-300 hover:text-white p-1" title="Zoom in"><ZoomIn size={13} /></button>
        <button onClick={() => setZoom(z => Math.max(z - 0.25, 0.25))} className="text-slate-300 hover:text-white p-1" title="Zoom out"><ZoomOut size={13} /></button>
        <button onClick={() => setRotate(r => (r + 90) % 360)} className="text-slate-300 hover:text-white p-1" title="Rotate"><RotateCw size={13} /></button>
        <button onClick={reset} className="text-slate-300 hover:text-white p-1" title="Reset"><RefreshCw size={13} /></button>

        {/* Multi-frame cine */}
        {totalFrames > 1 && (
          <>
            <div className="w-px h-4 bg-slate-700 mx-1" />
            <button onClick={() => setPlaying(p => !p)} className="text-slate-300 hover:text-white p-1 text-[11px] font-medium">
              {playing ? "⏸ Pause" : "▶ Cine"}
            </button>
            <span className="text-[9px] text-slate-500">Speed</span>
            <input type="range" min={1} max={30} value={cineSpeed} onChange={e => setCineSpeed(Number(e.target.value))} className="w-14 h-1 accent-blue-400" />
            <span className="text-[10px] text-slate-400">{cineSpeed} fps</span>
            <span className="text-[10px] text-slate-500">{frameIndex + 1}/{totalFrames}</span>
          </>
        )}

        <div className="flex-1" />

        {/* AI Impression */}
        <button
          onClick={runAIImpression}
          disabled={aiLoading}
          className="flex items-center gap-1.5 text-[11px] bg-violet-700 hover:bg-violet-600 text-white px-2 py-1 rounded font-medium transition-colors disabled:opacity-50"
          title="AI Radiology Impression"
        >
          {aiLoading ? <Loader2 size={11} className="animate-spin" /> : "✨"}AI Impression
        </button>
        <button onClick={() => setShowMeta(v => !v)} className={cn("text-slate-300 hover:text-white p-1", showMeta && "text-blue-400")} title="DICOM metadata">
          <Info size={13} />
        </button>
        {src && <a href={src} download={filename} className="text-slate-300 hover:text-white p-1" title="Download"><Download size={13} /></a>}
      </div>

      {/* ── Image area ── */}
      <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-black">
        {isJpeg && src ? (
          <img
            ref={imgRef}
            src={src}
            alt={filename}
            style={{
              transform: `scale(${zoom}) rotate(${rotate}deg)`,
              filter: `brightness(${brightness}%) contrast(${contrast}%)`,
              transformOrigin: "center",
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              cursor: tool !== "none" ? "crosshair" : "default",
            }}
            draggable={false}
          />
        ) : meta.rawPixels ? (
          <div className="relative" style={{ transform: `scale(${zoom}) rotate(${rotate}deg)`, transformOrigin: "center" }}>
            <canvas
              ref={canvasRef}
              style={{ display: "block", maxWidth: "100%", maxHeight: "calc(100vh - 140px)", cursor: tool !== "none" ? "crosshair" : "default" }}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
            />
            <canvas
              ref={overlayRef}
              width={meta.columns || 512}
              height={meta.rows || 512}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}
            />
          </div>
        ) : null}

        {/* DICOM metadata overlay */}
        {showMeta && (
          <div className="absolute top-2 left-2 bg-black/85 border border-slate-700 rounded p-2 text-[10px] text-slate-300 space-y-0.5 max-w-[240px]">
            {meta.patientName   && <p><span className="text-slate-500">Patient:</span> {meta.patientName}</p>}
            {meta.studyDate     && <p><span className="text-slate-500">Date:</span> {formatDicomDate(meta.studyDate)}</p>}
            {meta.modality      && <p><span className="text-slate-500">Modality:</span> {meta.modality}</p>}
            {meta.seriesDescription && <p><span className="text-slate-500">Series:</span> {meta.seriesDescription}</p>}
            {meta.rows && meta.columns && <p><span className="text-slate-500">Size:</span> {meta.columns}×{meta.rows}</p>}
            {meta.bitsAllocated && <p><span className="text-slate-500">Bits:</span> {meta.bitsAllocated}</p>}
            {!isJpeg && <p><span className="text-slate-500">WC/WW:</span> {wc}/{ww} HU</p>}
          </div>
        )}

        {/* AI Impression panel */}
        {aiImpression && (
          <div className="absolute bottom-2 left-2 right-2 bg-violet-950/95 border border-violet-700 rounded-xl p-3 text-[12px] text-violet-100">
            <div className="flex items-center justify-between mb-1.5">
              <p className="font-semibold text-violet-300 text-[11px] uppercase tracking-wide">✨ AI Radiology Impression</p>
              <button onClick={() => setAiImpression(null)} className="text-violet-400 hover:text-white text-[14px] leading-none">✕</button>
            </div>
            <p className="leading-relaxed whitespace-pre-wrap">{aiImpression}</p>
          </div>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// Main panel
// ─────────────────────────────────────────────
const DicomViewerPanel: React.FC<Props> = ({
  orderId, patientName, accessionNumber, modalityType, studyName,
  currentPacsUrl, onPacsUrlSaved,
}) => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<"files" | "pacs">("files");
  const [dicomFiles, setDicomFiles] = useState<DicomFile[]>([]);
  const [pacsConfig, setPacsConfig] = useState<PacsConfig | null>(null);
  const [loading, setLoading] = useState(true);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Viewer state
  const [selectedFile, setSelectedFile] = useState<DicomFile | null>(null);
  const [viewerMeta, setViewerMeta] = useState<DicomMetadata | null>(null);
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [fileIndex, setFileIndex] = useState(0);
  const [frameIndex, setFrameIndex] = useState(0);
  const [compareMode, setCompareMode] = useState(false);
  const [compareMeta, setCompareMeta] = useState<DicomMetadata | null>(null);
  const [compareSrc, setCompareSrc] = useState<string | null>(null);

  // PACS / legacy URL
  const [pacsUrl, setPacsUrl] = useState(currentPacsUrl || "");
  const [pacsUrlSaving, setPacsUrlSaving] = useState(false);
  const [showPacsIframe, setShowPacsIframe] = useState(false);

  // ── Fetch ─────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);

    const [filesRes, configRes] = await Promise.all([
      (supabase as any)
        .from("dicom_files")
        .select("*")
        .eq("order_id", orderId)
        .eq("hospital_id", hospitalId)
        .order("instance_number", { ascending: true }),
      (supabase as any)
        .from("hospital_pacs_config")
        .select("*")
        .eq("hospital_id", hospitalId)
        .maybeSingle(),
    ]);

    if (filesRes.data) setDicomFiles(filesRes.data as DicomFile[]);
    if (configRes.data) setPacsConfig(configRes.data as PacsConfig);
    setLoading(false);
  }, [hospitalId, orderId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Upload ────────────────────────────────
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length || !hospitalId) return;

    setUploading(true);
    let uploaded = 0;

    for (const file of files) {
      try {
        // Parse DICOM metadata client-side before upload
        const meta = await parseDicomFile(file);

        // Revoke temporary blob URL — we don't persist it; it will be
        // re-created from signed URL when user opens the file
        if (meta.imageDataUrl) URL.revokeObjectURL(meta.imageDataUrl);

        const storagePath = `${hospitalId}/${orderId}/${Date.now()}_${file.name}`;

        const { error: storageErr } = await supabase.storage
          .from("dicom")
          .upload(storagePath, file, { upsert: false });

        if (storageErr) {
          toast({ title: `Upload failed: ${file.name}`, description: storageErr.message, variant: "destructive" });
          continue;
        }

        // Get current user id
        const { data: userData } = await supabase.auth.getUser();
        let userId: string | null = null;
        if (userData?.user) {
          const { data: u } = await supabase
            .from("users")
            .select("id")
            .eq("auth_user_id", userData.user.id)
            .maybeSingle();
          userId = u?.id ?? null;
        }

        await (supabase as any).from("dicom_files").insert({
          hospital_id:          hospitalId,
          order_id:             orderId,
          storage_path:         storagePath,
          original_filename:    file.name,
          file_size_bytes:      file.size,
          study_instance_uid:   meta.studyInstanceUID ?? null,
          series_instance_uid:  meta.seriesInstanceUID ?? null,
          sop_instance_uid:     meta.sopInstanceUID ?? null,
          sop_class_uid:        meta.sopClassUID ?? null,
          transfer_syntax_uid:  meta.transferSyntaxUID ?? null,
          modality:             meta.modality ?? modalityType ?? null,
          series_description:   meta.seriesDescription ?? null,
          series_number:        meta.seriesNumber ?? null,
          instance_number:      meta.instanceNumber ?? null,
          rows:                 meta.rows ?? null,
          columns:              meta.columns ?? null,
          number_of_frames:     meta.numberOfFrames ?? 1,
          bits_allocated:       meta.bitsAllocated ?? null,
          is_jpeg_compressed:   meta.isJpegCompressed,
          uploaded_by:          userId,
        });

        uploaded++;
      } catch (err: any) {
        toast({ title: `Error processing ${file.name}`, description: err.message, variant: "destructive" });
      }
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";

    if (uploaded > 0) {
      toast({ title: `${uploaded} DICOM file${uploaded > 1 ? "s" : ""} uploaded ✓` });
      fetchData();
    }
  };

  // ── Open file in viewer ───────────────────
  const openFile = async (file: DicomFile, index: number, asCompare = false) => {
    if (!asCompare) {
      setSelectedFile(file);
      setFileIndex(index);
      setViewerSrc(null);
      setViewerMeta(null);
      setFrameIndex(0);
    }

    setViewerLoading(true);
    try {
      const { data: signedData, error } = await supabase.storage
        .from("dicom")
        .createSignedUrl(file.storage_path, 300);

      if (error || !signedData?.signedUrl) throw new Error("Failed to create signed URL");

      const meta = await parseDicomFromUrl(signedData.signedUrl);
      if (asCompare) {
        setCompareMeta(meta);
        setCompareSrc(meta.imageDataUrl || null);
      } else {
        setViewerMeta(meta);
        setViewerSrc(meta.imageDataUrl || null);
      }
    } catch (err: any) {
      toast({ title: "Could not load image", description: err.message, variant: "destructive" });
    }
    setViewerLoading(false);
  };

  // Navigate between files
  const navigateFile = (delta: number) => {
    const nextIndex = fileIndex + delta;
    if (nextIndex >= 0 && nextIndex < dicomFiles.length) {
      openFile(dicomFiles[nextIndex], nextIndex);
    }
  };

  // ── Delete file ───────────────────────────
  const deleteFile = async (file: DicomFile) => {
    if (!window.confirm(`Delete ${file.original_filename}?`)) return;

    await supabase.storage.from("dicom").remove([file.storage_path]);
    await (supabase as any).from("dicom_files").delete().eq("id", file.id);

    if (selectedFile?.id === file.id) {
      setSelectedFile(null);
      setViewerSrc(null);
      setViewerMeta(null);
    }
    setDicomFiles(prev => prev.filter(f => f.id !== file.id));
    toast({ title: "File deleted" });
  };

  // ── Build OHIF/PACS URL for this study ───
  const buildPacsViewerUrl = (): string | null => {
    if (!pacsConfig) return null;

    // Prefer configured OHIF viewer URL with study UID
    const studyUID = dicomFiles[0]?.study_instance_uid ?? null;

    if (pacsConfig.ohif_viewer_url && studyUID) {
      return `${pacsConfig.ohif_viewer_url}?StudyInstanceUIDs=${encodeURIComponent(studyUID)}`;
    }
    if (pacsConfig.ohif_viewer_url) return pacsConfig.ohif_viewer_url;

    // WADO-URI fallback — link directly to study
    if (pacsConfig.wado_uri_root && studyUID) {
      return `${pacsConfig.wado_uri_root}?requestType=WADO&studyUID=${encodeURIComponent(studyUID)}&objectUID=&contentType=application/x-dicom-manifest`;
    }

    // Legacy URL on the order
    return pacsUrl || null;
  };

  // ── Save legacy PACS URL ──────────────────
  const saveLegacyPacsUrl = async () => {
    setPacsUrlSaving(true);
    await supabase.from("radiology_orders").update({ dicom_pacs_url: pacsUrl || null }).eq("id", orderId);
    setPacsUrlSaving(false);
    onPacsUrlSaved?.(pacsUrl);
    toast({ title: "PACS URL saved" });
  };

  // ── Format helpers ────────────────────────
  const fmtSize = (bytes: number | null) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const pacsViewerUrl = buildPacsViewerUrl();
  const hasPacsConfig = pacsConfig && pacsConfig.pacs_type !== "none" && pacsConfig.is_active;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-900">
        <Loader2 className="text-slate-400 animate-spin" size={22} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-900">
      {/* ── Tab bar ─────────────────────────── */}
      <div className="shrink-0 flex items-center gap-1 px-4 py-2 border-b border-slate-700 bg-slate-800">
        <button
          onClick={() => setActiveTab("files")}
          className={cn(
            "text-[11px] px-3 py-1 rounded font-medium transition-colors",
            activeTab === "files"
              ? "bg-blue-600 text-white"
              : "text-slate-400 hover:text-white"
          )}
        >
          <FileImage size={11} className="inline mr-1" />
          Uploaded Files
          {dicomFiles.length > 0 && (
            <span className="ml-1 bg-blue-500/30 text-blue-300 text-[9px] px-1.5 rounded-full">
              {dicomFiles.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("pacs")}
          className={cn(
            "text-[11px] px-3 py-1 rounded font-medium transition-colors",
            activeTab === "pacs"
              ? "bg-blue-600 text-white"
              : "text-slate-400 hover:text-white"
          )}
        >
          <MonitorPlay size={11} className="inline mr-1" />
          PACS Viewer
          {hasPacsConfig && (
            <span className="ml-1 bg-emerald-500/30 text-emerald-300 text-[9px] px-1 rounded-full">●</span>
          )}
        </button>

        <div className="flex-1" />

        {/* Accession quick-copy */}
        <span className="text-[10px] text-slate-500 font-mono">
          {accessionNumber || `RAD-${orderId.slice(0, 8).toUpperCase()}`}
        </span>
      </div>

      {/* ════════════════════════════════════════
          TAB 1 — Uploaded DICOM Files
      ════════════════════════════════════════ */}
      {activeTab === "files" && (
        <div className="flex-1 flex overflow-hidden">
          {/* Left: file list + upload */}
          <div className="w-[220px] shrink-0 border-r border-slate-700 flex flex-col overflow-hidden bg-slate-800">
            {/* Upload button */}
            <div className="shrink-0 p-3 border-b border-slate-700">
              <input
                ref={fileInputRef}
                type="file"
                accept=".dcm,application/dicom"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
              <Button
                size="sm"
                className="w-full h-8 text-[12px] bg-blue-600 hover:bg-blue-700"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <><Loader2 size={12} className="animate-spin" /> Uploading...</>
                ) : (
                  <><Upload size={12} /> Upload DICOM</>
                )}
              </Button>
              <p className="text-[10px] text-slate-500 text-center mt-1">
                .dcm files · up to 100 MB each
              </p>
            </div>

            {/* File list */}
            <div className="flex-1 overflow-y-auto">
              {dicomFiles.length === 0 ? (
                <div className="p-4 text-center">
                  <ImageIcon size={28} className="text-slate-600 mx-auto mb-2" />
                  <p className="text-[11px] text-slate-500">No DICOM files uploaded</p>
                  <p className="text-[10px] text-slate-600 mt-1">
                    Upload .dcm files from your imaging equipment or PACS export.
                  </p>
                </div>
              ) : (
                dicomFiles.map((f, idx) => (
                  <div
                    key={f.id}
                    onClick={() => openFile(f, idx)}
                    className={cn(
                      "p-2 border-b border-slate-700 cursor-pointer hover:bg-slate-700/60 transition-colors group",
                      selectedFile?.id === f.id && "bg-blue-900/40 border-l-2 border-l-blue-500"
                    )}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-slate-200 truncate font-mono">
                          {f.original_filename}
                        </p>
                        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                          {f.modality && (
                            <span className="text-[9px] bg-slate-700 text-slate-300 px-1 rounded">
                              {f.modality}
                            </span>
                          )}
                          {f.is_jpeg_compressed && (
                            <span className="text-[9px] bg-emerald-900/50 text-emerald-400 px-1 rounded">
                              JPEG
                            </span>
                          )}
                          {f.number_of_frames && f.number_of_frames > 1 && (
                            <span className="text-[9px] text-slate-500">
                              {f.number_of_frames}fr
                            </span>
                          )}
                        </div>
                        {f.series_description && (
                          <p className="text-[10px] text-slate-500 truncate mt-0.5">
                            {f.series_description}
                          </p>
                        )}
                        <p className="text-[9px] text-slate-600 mt-0.5">{fmtSize(f.file_size_bytes)}</p>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); deleteFile(f); }}
                        className="shrink-0 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all p-0.5"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right: viewer or no-file state */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {viewerLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <Loader2 className="text-blue-400 animate-spin mx-auto mb-2" size={28} />
                  <p className="text-[12px] text-slate-400">Loading DICOM image...</p>
                </div>
              </div>
            ) : selectedFile && (viewerSrc || viewerMeta?.rawPixels) ? (
              <>
                {/* Series navigation + compare toggle */}
                {dicomFiles.length > 1 && (
                  <div className="shrink-0 bg-slate-800 border-b border-slate-700 px-3 py-1 flex items-center gap-2">
                    <button onClick={() => navigateFile(-1)} disabled={fileIndex === 0} className="text-slate-400 hover:text-white disabled:opacity-30"><ChevronLeft size={14} /></button>
                    <span className="text-[11px] text-slate-400">{fileIndex + 1} / {dicomFiles.length}</span>
                    <button onClick={() => navigateFile(1)} disabled={fileIndex === dicomFiles.length - 1} className="text-slate-400 hover:text-white disabled:opacity-30"><ChevronRight size={14} /></button>
                    <button
                      onClick={() => { setCompareMode(v => !v); if (!compareMode && dicomFiles[fileIndex + 1]) openFile(dicomFiles[fileIndex + 1], fileIndex + 1, true); }}
                      className={cn("ml-2 text-[11px] px-2 py-0.5 rounded font-medium transition-colors", compareMode ? "bg-blue-600 text-white" : "text-slate-400 border border-slate-600 hover:text-white")}
                    >
                      ⊟ Compare
                    </button>
                  </div>
                )}

                {/* Single or side-by-side */}
                <div className={cn("flex-1 overflow-hidden", compareMode ? "grid grid-cols-2 gap-0.5" : "flex flex-col")}>
                  <ImageViewer
                    src={viewerSrc}
                    filename={selectedFile.original_filename}
                    isJpeg={selectedFile.is_jpeg_compressed}
                    meta={viewerMeta ?? { isJpegCompressed: true }}
                    hospitalId={hospitalId ?? ""}
                    totalFrames={selectedFile.number_of_frames ?? 1}
                    frameIndex={frameIndex}
                    onFrameChange={setFrameIndex}
                  />
                  {compareMode && compareMeta && (
                    <ImageViewer
                      src={compareSrc}
                      filename="Compare"
                      isJpeg={compareMeta.isJpegCompressed}
                      meta={compareMeta}
                      hospitalId={hospitalId ?? ""}
                      totalFrames={compareMeta.numberOfFrames ?? 1}
                      frameIndex={frameIndex}
                      onFrameChange={setFrameIndex}
                    />
                  )}
                </div>
              </>
            ) : selectedFile && !viewerSrc && !viewerMeta?.rawPixels ? (
              /* Raw pixel data — can't render in browser without DWV/Cornerstone */
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center max-w-sm">
                  <ImageIcon size={40} className="text-slate-600 mx-auto mb-3" />
                  <p className="text-[14px] font-semibold text-slate-300 mb-1">
                    {selectedFile.modality ?? "DICOM"} — Uncompressed Pixel Data
                  </p>
                  <p className="text-[12px] text-slate-500 mb-4">
                    This file uses {selectedFile.bits_allocated ?? 16}-bit pixel data
                    ({selectedFile.columns ?? "?"}×{selectedFile.rows ?? "?"} px).
                    Browser rendering requires JPEG compression. Download to view in a
                    DICOM viewer (RadiAnt, Horos, MicroDicom).
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-left bg-slate-800 rounded p-3 mb-4">
                    {selectedFile.modality && <><span className="text-slate-500">Modality</span><span className="text-slate-300">{selectedFile.modality}</span></>}
                    {selectedFile.series_description && <><span className="text-slate-500">Series</span><span className="text-slate-300">{selectedFile.series_description}</span></>}
                    {selectedFile.rows && selectedFile.columns && <><span className="text-slate-500">Size</span><span className="text-slate-300">{selectedFile.columns}×{selectedFile.rows}</span></>}
                    {selectedFile.bits_allocated && <><span className="text-slate-500">Bit depth</span><span className="text-slate-300">{selectedFile.bits_allocated}-bit</span></>}
                    {selectedFile.number_of_frames && selectedFile.number_of_frames > 1 && <><span className="text-slate-500">Frames</span><span className="text-slate-300">{selectedFile.number_of_frames}</span></>}
                  </div>
                  <Button
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700"
                    onClick={async () => {
                      const { data } = await supabase.storage
                        .from("dicom")
                        .createSignedUrl(selectedFile.storage_path, 60);
                      if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
                    }}
                  >
                    <Download size={13} /> Download DICOM File
                  </Button>
                </div>
              </div>
            ) : (
              /* No file selected */
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center">
                  <FileImage size={40} className="text-slate-700 mx-auto mb-3" />
                  <p className="text-[13px] text-slate-500">Select a file from the list to view</p>
                  {dicomFiles.length === 0 && (
                    <p className="text-[12px] text-slate-600 mt-2 max-w-xs">
                      Upload DICOM files exported from your imaging equipment or modality workstation.
                      JPEG-compressed files (X-ray, USG) render directly in the browser.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════
          TAB 2 — PACS / External Viewer
      ════════════════════════════════════════ */}
      {activeTab === "pacs" && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {hasPacsConfig && pacsViewerUrl ? (
            /* PACS is configured — show embedded viewer or open link */
            <div className="flex-1 flex flex-col">
              {/* Controls bar */}
              <div className="shrink-0 bg-slate-800 border-b border-slate-700 px-4 py-2 flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-emerald-400 rounded-full" />
                  <span className="text-[12px] text-slate-300 font-medium">
                    {pacsConfig!.pacs_name || pacsConfig!.pacs_type.toUpperCase()}
                  </span>
                </div>
                {dicomFiles[0]?.study_instance_uid && (
                  <span className="text-[10px] text-slate-500 font-mono truncate max-w-xs">
                    {dicomFiles[0].study_instance_uid}
                  </span>
                )}
                <div className="flex-1" />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] border-slate-600 text-slate-300 hover:bg-slate-700"
                  onClick={() => setShowPacsIframe(v => !v)}
                >
                  {showPacsIframe ? "Hide Viewer" : "Show Inline"}
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-[11px] bg-blue-600 hover:bg-blue-700"
                  onClick={() => window.open(pacsViewerUrl, "_blank", "noopener,noreferrer")}
                >
                  <ExternalLink size={12} /> Open PACS
                </Button>
              </div>

              {showPacsIframe ? (
                <iframe
                  src={pacsViewerUrl}
                  className="flex-1 w-full border-0"
                  allow="camera; microphone; fullscreen; display-capture"
                  title="PACS Viewer"
                />
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center">
                    <MonitorPlay size={48} className="text-slate-700 mx-auto mb-3" />
                    <p className="text-[14px] text-slate-400 mb-1">PACS viewer configured</p>
                    <p className="text-[12px] text-slate-600 mb-4">
                      Click "Open PACS" to launch in a new tab, or "Show Inline" to embed here.
                    </p>
                    <Button
                      className="bg-blue-600 hover:bg-blue-700"
                      onClick={() => window.open(pacsViewerUrl, "_blank", "noopener,noreferrer")}
                    >
                      <ExternalLink size={14} /> Open in PACS Viewer
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* No PACS configured — show manual URL + setup guide */
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Legacy PACS URL entry */}
              <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
                <h3 className="text-[13px] font-bold text-slate-200 mb-1 flex items-center gap-2">
                  <ExternalLink size={14} className="text-blue-400" />
                  Quick Link to Existing PACS
                </h3>
                <p className="text-[11px] text-slate-500 mb-3">
                  If your hospital has a PACS (Synapse, Centricity, Orthanc, etc.), paste the direct
                  study URL here. The radiologist can open it in one click.
                </p>
                <div className="flex gap-2">
                  <Input
                    value={pacsUrl}
                    onChange={e => setPacsUrl(e.target.value)}
                    placeholder="https://pacs.hospital.com/viewer?studyUID=..."
                    className="bg-slate-700 border-slate-600 text-slate-200 text-[12px] h-8"
                  />
                  <Button
                    size="sm"
                    className="h-8 text-[12px] bg-blue-600 hover:bg-blue-700 shrink-0"
                    onClick={saveLegacyPacsUrl}
                    disabled={pacsUrlSaving}
                  >
                    {pacsUrlSaving ? <Loader2 size={12} className="animate-spin" /> : "Save"}
                  </Button>
                </div>
                {pacsUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 h-7 text-[11px] text-blue-400 hover:text-blue-300"
                    onClick={() => window.open(pacsUrl, "_blank", "noopener,noreferrer")}
                  >
                    <ExternalLink size={11} /> Test Link
                  </Button>
                )}
              </div>

              {/* Setup guide */}
              <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-5">
                <h3 className="text-[13px] font-bold text-slate-300 mb-3 flex items-center gap-2">
                  <Settings size={14} className="text-slate-500" />
                  Configure Full PACS Integration
                </h3>
                <p className="text-[12px] text-slate-500 mb-3">
                  For automatic study linking and embedded viewer, configure your PACS connection in
                  Settings → Radiology → PACS Configuration.
                </p>
                <div className="space-y-2">
                  {[
                    { type: "OHIF Viewer", desc: "Self-hosted OHIF (ohif.org) — full DICOM viewer embedded in HMS. Recommended.", tag: "Recommended" },
                    { type: "Orthanc", desc: "Open-source DICOM server with built-in web viewer. Free to deploy on your server." },
                    { type: "WADO-URI", desc: "Connect any standards-compliant PACS (Synapse, Centricity, DCM4CHEE) via WADO protocol." },
                    { type: "Cloud PACS", desc: "Ambra Health, Karos Health, or similar cloud DICOM storage with viewer." },
                  ].map(opt => (
                    <div key={opt.type} className="flex items-start gap-2 p-2 rounded bg-slate-700/40">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-medium text-slate-300">{opt.type}</span>
                          {opt.tag && (
                            <span className="text-[9px] bg-emerald-900/50 text-emerald-400 px-1.5 rounded">
                              {opt.tag}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-500">{opt.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Accession reference */}
              <div className="text-center">
                <p className="text-[11px] text-slate-600 uppercase tracking-wider mb-1">Accession Number</p>
                <p className="text-[26px] font-bold text-slate-400 font-mono">
                  {accessionNumber || `RAD-${orderId.slice(0, 8).toUpperCase()}`}
                </p>
                <p className="text-[10px] text-slate-600">Use this to retrieve study from your PACS</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DicomViewerPanel;
