export interface Vehicle {
  id: string;
  plateNumber: string;
  ownerName: string;
  contactNumber: string;
  registeredAt: Date;
  dataSource?: string;
  residentId?: string;
  rented?: string;
  purposeOfVisit?: string;
  /** Normalized slug: car, motorcycle, truck, etc. */
  vehicleType?: string;
  /** Non-resident visitor classification (null when linked to a resident). */
  visitorCategory?: 'guest' | 'delivery' | 'rental' | null;
}

export type ResidentStatus = 'verified' | 'guest';

/** Property relationship; drives registry badges (Homeowner vs Tenant). */
export type ResidentType = 'homeowner' | 'tenant';

export interface Resident {
  id: string;
  name: string;
  contactNumber: string;
  /** Composed from house number + street (kept for search and legacy rows). */
  address?: string;
  houseNumber?: string;
  streetName?: string;
  barangay?: string;
  city?: string;
  createdAt: Date;
  residentStatus?: ResidentStatus;
  /** Homeowner or Tenant; default homeowner when unset (legacy rows). */
  residentType?: ResidentType;
}

export interface Camera {
  id: string;
  locationId: string;
  name: string;
  status: 'online' | 'offline';
  lastCapture: Date;
  deviceId?: string;
  /** When set, server-side YOLO uses this RTSP URL instead of GO2RTC_RTSP_BASE + deviceId. */
  detectionRtspUrl?: string | null;
  isFixed?: boolean;
  illegalParkingZone?: boolean;
}

export interface Detection {
  id: string;
  cameraId: string;
  plateNumber: string;
  timestamp: Date;
  confidence: number;
  imageUrl?: string;
}

export interface Violation {
  id: string;
  ticketId?: string;
  plateNumber: string;
  cameraLocationId: string;
  timeDetected: Date;
  timeIssued?: Date;
  status: 'warning' | 'pending' | 'issued' | 'cancelled' | 'cleared' | 'resolved';
  warningExpiresAt?: Date;
  imageUrl?: string;
  imageBase64?: string;
  message?: string;
  detectionId?: string;
  vehicleType?: string;
  /** True when plate has no registered vehicle and should be treated as immediate priority. */
  unregisteredUrgent?: boolean;
  /** When an SMS was successfully logged for this violation (from sms_logs). */
  smsSentAt?: Date;
}

export type ViolationStatus = Violation['status'];
