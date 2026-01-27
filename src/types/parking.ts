export interface Vehicle {
  id: string;
  plateNumber: string;
  ownerName: string;
  contactNumber: string;
  registeredAt: Date;
  dataSource?: string;
  hostId?: string;
  rented?: string;
  purposeOfVisit?: string;
}

export interface Host {
  id: string;
  name: string;
  contactNumber: string;
  address?: string;
  createdAt: Date;
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
