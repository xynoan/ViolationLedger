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
}

export type ViolationStatus = Violation['status'];
