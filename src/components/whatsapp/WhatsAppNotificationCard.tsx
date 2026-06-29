import React, { useState, useEffect, useCallback } from "react";
import { MessageSquare, X } from "lucide-react";

interface Props {
  patientName: string;
  notificationType: string;
  waUrl: string;
  onSend: () => void;
  onSkip: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  appointment_confirmation: "Appointment Confirmation",
  appointment_reminder: "Appointment Reminder",
  lab_result_ready: "Lab Report Ready",
  bill_generated: "Bill Generated",
  payment_received: "Payment Receipt",
  discharge_summary: "Discharge Summary",
  prescription_ready: "Prescription Ready",
  feedback_request: "Feedback Request",
};

const WhatsAppNotificationCard: React.FC<Props> = ({ patientName, notificationType, waUrl, onSend, onSkip }) => {
  const [countdown, setCountdown] = useState(15);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (countdown <= 0) {
      setVisible(false);
      onSkip();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, onSkip]);

  const handleSend = () => {
    window.open(waUrl, "_blank", "noopener,noreferrer");
    onSend();
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[500] w-[calc(100%-32px)] max-w-md animate-in slide-in-from-bottom-4 duration-300"
      style={{
        background: "#FFFFFF",
        borderRadius: "16px 16px 16px 16px",
        borderTop: "3px solid #25D366",
        boxShadow: "0 -4px 20px rgba(0,0,0,0.1)",
        padding: "16px 20px",
      }}
    >
      {/* Countdown bar */}
      <div className="absolute top-0 left-0 right-0 h-0.5 overflow-hidden rounded-t-2xl">
        <div
          className="h-full transition-all ease-linear"
          style={{
            width: `${(countdown / 15) * 100}%`,
            background: "#25D366",
          }}
        />
      </div>

      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
          style={{ background: "#25D366" }}
        >
          <MessageSquare size={20} color="white" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-foreground">
            Notify {patientName}?
          </p>
          <p className="text-[11px] text-muted-foreground">
            {TYPE_LABELS[notificationType] || notificationType}
          </p>
        </div>

        <button onClick={() => { setVisible(false); onSkip(); }} className="p-1 text-muted-foreground hover:text-foreground">
          <X size={16} />
        </button>
      </div>

      <div className="flex gap-2 mt-3">
        <button
          onClick={() => { setVisible(false); onSkip(); }}
          className="flex-1 py-2.5 rounded-lg text-xs font-medium text-muted-foreground border border-border hover:bg-muted transition-colors"
        >
          Skip
        </button>
        <button
          onClick={handleSend}
          className="flex-[2] py-2.5 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-1.5 active:scale-[0.97] transition-transform"
          style={{ background: "#25D366" }}
        >
          <MessageSquare size={14} />
          Send WhatsApp
        </button>
      </div>
    </div>
  );
};

export default WhatsAppNotificationCard;

// Hook for easy usage in any module
export function useWhatsAppNotification() {
  const [notification, setNotification] = useState<{
    patientName: string;
    type: string;
    waUrl: string;
  } | null>(null);

  const show = useCallback((patientName: string, type: string, waUrl: string) => {
    setNotification({ patientName, type, waUrl });
  }, []);

  const card = notification ? (
    <WhatsAppNotificationCard
      patientName={notification.patientName}
      notificationType={notification.type}
      waUrl={notification.waUrl}
      onSend={() => setNotification(null)}
      onSkip={() => setNotification(null)}
    />
  ) : null;

  return { show, card };
}
