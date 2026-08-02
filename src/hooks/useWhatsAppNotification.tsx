import { useState, useCallback } from "react";
import WhatsAppNotificationCard from "@/components/whatsapp/WhatsAppNotificationCard";

/**
 * Convenience wrapper that owns the notification card's state so any module can
 * raise one with a single call. Lifted out of WhatsAppNotificationCard.tsx so
 * that file exports only its component — a file mixing component and
 * non-component exports silently disables Fast Refresh for it.
 *
 * Lives in a .tsx file because it returns rendered JSX.
 */
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
