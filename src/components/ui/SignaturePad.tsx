import { useRef, useEffect } from "react";

interface Props {
  label: string;
  onCapture: (dataUrl: string | null) => void;
  cleared: number;
  width?: number;
  height?: number;
}

export default function SignaturePad({ label, onCapture, cleared, width = 380, height = 100 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasStrokes = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasStrokes.current = false;
    onCapture(null);
  }, [cleared]);

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0f172a";
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    hasStrokes.current = true;
  };

  const onPointerUp = () => {
    drawing.current = false;
    if (hasStrokes.current && canvasRef.current) {
      onCapture(canvasRef.current.toDataURL("image/png"));
    }
  };

  return (
    <div>
      {label && <p className="text-[12px] font-medium text-muted-foreground mb-1.5">{label}</p>}
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="w-full border border-border rounded-lg bg-slate-50 touch-none cursor-crosshair"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
    </div>
  );
}
