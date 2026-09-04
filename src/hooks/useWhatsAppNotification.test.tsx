import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/components/whatsapp/WhatsAppNotificationCard", () => ({
  default: (props: any) => <div data-testid="wa-card" data-patient={props.patientName} data-type={props.notificationType} data-url={props.waUrl} />,
}));

import { useWhatsAppNotification } from "./useWhatsAppNotification";

describe("useWhatsAppNotification", () => {
  it("card is null until show() is called", () => {
    const { result } = renderHook(() => useWhatsAppNotification());
    expect(result.current.card).toBeNull();
  });

  it("show() renders the card with the given patient, type, and WhatsApp URL", () => {
    const { result } = renderHook(() => useWhatsAppNotification());
    act(() => result.current.show("Jane Doe", "appointment_reminder", "https://wa.me/911234?text=hi"));

    expect(result.current.card).not.toBeNull();
    expect(result.current.card!.props.patientName).toBe("Jane Doe");
    expect(result.current.card!.props.notificationType).toBe("appointment_reminder");
    expect(result.current.card!.props.waUrl).toBe("https://wa.me/911234?text=hi");
  });

  it("onSend and onSkip both clear the notification back to null", () => {
    const { result } = renderHook(() => useWhatsAppNotification());
    act(() => result.current.show("Jane Doe", "reminder", "https://wa.me/1"));
    act(() => result.current.card!.props.onSend());
    expect(result.current.card).toBeNull();

    act(() => result.current.show("Jane Doe", "reminder", "https://wa.me/1"));
    act(() => result.current.card!.props.onSkip());
    expect(result.current.card).toBeNull();
  });
});
