import { ENTERPRISE_EMAIL } from "@/lib/brand";
export const INDIAN_STATES = [
  "Andaman & Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra & Nagar Haveli",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu & Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
];

// Sales / Enterprise contact — centralised so ops can override via env
// (VITE_SALES_WHATSAPP / VITE_SALES_EMAIL) without editing component code.
export const SALES_WHATSAPP =
  (import.meta.env.VITE_SALES_WHATSAPP as string) || "918800000000";
export const SALES_EMAIL =
  (import.meta.env.VITE_SALES_EMAIL as string) || ENTERPRISE_EMAIL;

export const HOSPITAL_TYPES = [
  "Private Hospital",
  "Government Hospital",
  "Trust / NGO Hospital",
  "Corporate Hospital",
  "Nursing Home",
  "Clinic",
  "Specialty Center",
  "Dental Clinic",
  "AYUSH Center",
  "Other",
];

export const BED_COUNTS = [
  { label: "Under 30 beds", value: "under_30" },
  { label: "30–50 beds", value: "30_50" },
  { label: "51–100 beds", value: "51_100" },
  { label: "101–200 beds", value: "101_200" },
  { label: "201–500 beds", value: "201_500" },
  { label: "500+ beds", value: "500_plus" },
];

export const DESIGNATIONS = [
  "Medical Director",
  "CEO / Managing Director",
  "Hospital Administrator",
  "IT Head / CTO",
  "Finance Head / CFO",
  "Operations Head",
  "Other",
];

export interface RegistrationData {
  hospitalName: string;
  hospitalType: string;
  state: string;
  bedCount: string;
  phone: string;
  phoneVerified: boolean;
  /** Single-use token issued by verify-signup-otp; validated server-side by register-hospital. */
  phoneOtpToken: string;
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
  designation: string;
  referralCode: string;
  address1: string;
  address2: string;
  pincode: string;
  city: string;
  gstin: string;
  nabhAccredited: boolean;
  nabhNumber: string;
  website: string;
  plan: "starter" | "professional" | "enterprise" | "";
  termsAccepted: boolean;
  dpdpConsent: boolean;
  verificationMethod: "email" | "phone";
}

export const initialData: RegistrationData = {
  hospitalName: "",
  hospitalType: "",
  state: "",
  bedCount: "",
  phone: "",
  phoneVerified: false,
  phoneOtpToken: "",
  fullName: "",
  email: "",
  password: "",
  confirmPassword: "",
  designation: "",
  referralCode: "",
  address1: "",
  address2: "",
  pincode: "",
  city: "",
  gstin: "",
  nabhAccredited: false,
  nabhNumber: "",
  website: "",
  plan: "" as any,
  termsAccepted: false,
  dpdpConsent: false,
  verificationMethod: "email",
};
