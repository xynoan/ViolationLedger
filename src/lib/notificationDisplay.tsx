import type { ReactNode } from 'react';
import { AlertTriangle, Camera, Clock, type LucideIcon } from 'lucide-react';

export type NotificationKind =
  | 'warning_expired'
  | 'vehicle_detected'
  | 'incident_created'
  | 'plate_not_visible'
  | 'unknown';

export interface NotificationDisplayModel {
  id: string;
  type: string;
  title: string;
  message: string;
  cameraId?: string;
  locationId?: string;
  plateNumber?: string;
  timeDetected?: Date;
  reason?: string;
  imageUrl?: string;
  imageBase64?: string;
  timestamp: Date;
  read: boolean;
  handledBy?: string | null;
  handledAt?: Date | null;
  status?: 'open' | 'in_progress' | 'resolved' | string;
}

export function getImageSrc(
  notification: NotificationDisplayModel,
  serverBaseUrl: string
): string | null {
  if (notification.imageBase64) {
    if (notification.imageBase64.startsWith('data:')) {
      return notification.imageBase64;
    }
    return `data:image/jpeg;base64,${notification.imageBase64}`;
  }
  if (notification.imageUrl) {
    return `${serverBaseUrl}/captured_images/${notification.imageUrl.split(/[/\\]/).pop()}`;
  }
  return null;
}

export function getNotificationKind(notification: NotificationDisplayModel): NotificationKind {
  const t = (notification.type || '').toLowerCase();
  if (t === 'warning_expired') return 'warning_expired';
  if (t === 'vehicle_detected') return 'vehicle_detected';
  if (t === 'incident_created') return 'incident_created';
  if (t === 'plate_not_visible') return 'plate_not_visible';
  return 'unknown';
}

export function getStatusTitle(notification: NotificationDisplayModel): string {
  const kind = getNotificationKind(notification);
  switch (kind) {
    case 'vehicle_detected':
      return 'New Detection';
    case 'warning_expired':
      return 'Warning Expired';
    case 'incident_created':
      return 'Incident Created';
    case 'plate_not_visible':
      return 'Incident Created';
    default:
      return notification.title && !/^alert\s*\d+$/i.test(notification.title)
        ? notification.title
        : 'Notification';
  }
}

export function getLeftIcon(notification: NotificationDisplayModel): {
  Icon: LucideIcon;
  className: string;
} {
  const kind = getNotificationKind(notification);
  switch (kind) {
    case 'warning_expired':
      return { Icon: Clock, className: 'text-red-600' };
    case 'vehicle_detected':
      return { Icon: Camera, className: 'text-amber-600' };
    case 'incident_created':
    case 'plate_not_visible':
      return { Icon: AlertTriangle, className: 'text-warning' };
    default:
      return { Icon: AlertTriangle, className: 'text-muted-foreground' };
  }
}

export function getReasonPill(
  notification: NotificationDisplayModel
): { label: string; className: string } | null {
  const kind = getNotificationKind(notification);
  const rawReason = (notification.reason || '').trim();

  if (kind === 'warning_expired') {
    return { label: rawReason || 'Expired Warning', className: 'bg-red-100 text-red-700' };
  }
  if (kind === 'vehicle_detected') {
    return { label: rawReason || 'New Detection', className: 'bg-amber-100 text-amber-700' };
  }
  if (rawReason) {
    return { label: rawReason, className: 'bg-muted text-muted-foreground' };
  }
  return null;
}

export function getMainDescription(notification: NotificationDisplayModel): ReactNode {
  const plate =
    notification.plateNumber && notification.plateNumber !== 'NONE' ? notification.plateNumber : null;
  const kind = getNotificationKind(notification);

  const Plate = plate ? (
    <span className="font-mono font-semibold text-foreground">{plate}</span>
  ) : (
    <span className="font-semibold text-foreground">Unknown plate</span>
  );

  switch (kind) {
    case 'vehicle_detected':
      return <>Vehicle detected: {Plate}.</>;
    case 'warning_expired':
      return <>Warning expired for {Plate}.</>;
    case 'incident_created':
    case 'plate_not_visible':
      return <>Incident created for {Plate}.</>;
    default:
      return notification.message;
  }
}

export function getTimestampText(notification: NotificationDisplayModel): string | null {
  const dt = notification.timeDetected || notification.timestamp;
  if (!dt) return null;
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return null;
  }
}
