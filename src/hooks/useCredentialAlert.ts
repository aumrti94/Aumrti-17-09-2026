import { createContext, useContext } from "react";

/**
 * Split out of CredentialAlertContext.tsx so that file exports only the Provider
 * component — a file mixing component and non-component exports silently
 * disables Fast Refresh for it.
 */
export interface ExpiringCredential {
  id: string;
  user_id: string;
  staff_name: string;
  credential_type: string;
  name: string | null;
  expiry_date: string;
  days_left: number;
}

export interface CredentialAlertContextValue {
  expiringCount: number;
  credentials: ExpiringCredential[];
  loading: boolean;
  refresh: () => void;
}

export const CredentialAlertContext = createContext<CredentialAlertContextValue>({
  expiringCount: 0,
  credentials: [],
  loading: false,
  refresh: () => {},
});

export const useCredentialAlert = () => useContext(CredentialAlertContext);
