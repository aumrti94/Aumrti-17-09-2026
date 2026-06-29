import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import NABHBadge from "@/components/nabh/NABHBadge";

interface Props {
  onCodeBlue: () => void;
}

const EmergencyHeader: React.FC<Props> = ({ onCodeBlue }) => {
  const [clock, setClock] = useState(new Date());
  const [showConfirm, setShowConfirm] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);

  useEffect(() => {
    const iv = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  const handleConfirm = () => {
    setShowConfirm(false);
    onCodeBlue();
    setShowOverlay(true);
    setTimeout(() => setShowOverlay(false), 3000);
  };

  return (
    <>
      <div className="flex-shrink-0 h-[52px] flex items-center justify-between px-5" style={{ background: "#1E293B", borderBottom: "1px solid #334155" }}>
        <div className="flex items-center gap-4">
          <span className="text-[15px] font-bold text-white">🚨 Emergency / Casualty</span>
          <span className="text-sm text-slate-300 font-mono tabular-nums">
            {clock.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true })}
          </span>
        </div>

        <div className="flex-1" />

        <NABHBadge standardCodes={["AAC.1", "COP.3", "COP.13"]} />

        <button
          onClick={() => setShowConfirm(true)}
          className="h-11 px-6 rounded-lg bg-red-500 text-white text-[13px] font-bold hover:bg-red-600 active:scale-[0.97] transition-all"
          style={{ animation: "codeBluePulse 2s infinite" }}
        >
          🔴 CODE BLUE
        </button>
      </div>

      {/* Code Blue confirmation */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="max-w-sm" style={{ background: "#1E293B", border: "1px solid #334155" }}>
          <DialogHeader>
            <DialogTitle className="text-white text-lg">Confirm Code Blue Alert?</DialogTitle>
            <DialogDescription className="text-slate-400">This will notify ALL connected staff immediately.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowConfirm(false)} className="flex-1 border-slate-600 text-slate-300 hover:bg-slate-700">Cancel</Button>
            <Button onClick={handleConfirm} className="flex-1 bg-red-500 hover:bg-red-600 text-white">Yes — Alert All Staff</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Full-screen overlay */}
      {showOverlay && (
        <div className="fixed inset-0 z-[100] bg-red-600 flex items-center justify-center animate-in fade-in duration-200" style={{ animation: "codeBlueFlash 3s forwards" }}>
          <div className="text-center">
            <p className="text-6xl font-bold text-white mb-4">🔴 CODE BLUE ACTIVE</p>
            <p className="text-xl text-red-200">Emergency Department</p>
          </div>
        </div>
      )}

      <style>{`
        @keyframes codeBluePulse {
          0% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); }
          70% { box-shadow: 0 0 0 10px rgba(239,68,68,0); }
          100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
        }
        @keyframes codeBlueFlash {
          0% { opacity: 1; }
          80% { opacity: 1; }
          100% { opacity: 0; pointer-events: none; }
        }
      `}</style>
    </>
  );
};

export default EmergencyHeader;
