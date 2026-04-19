export interface VehicleTypeOption {
  value: string;
  label: string;
}

export interface VisitorPurposeOption {
  label: string;
  category: 'guest' | 'delivery' | 'rental';
}

/** Payload shape returned by GET /health/runtime-config (subset used by forms). */
export interface RuntimeFormConfig {
  ownerSmsDelayMinutes: number;
  ownerSmsDelayDisabledForDemo: boolean;
  gracePeriodMinutes: number;
  postGraceVerificationMinutes: number;
  vehicleTypeOptions: VehicleTypeOption[];
  visitorPurposes: VisitorPurposeOption[];
  residentVisitPurposeLabel: string;
  rentedLocationOptions: string[];
  residentStreets: string[];
}
