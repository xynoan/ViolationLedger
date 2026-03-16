# Entity Relationship Diagram (ERD)

## LedgerMonitor System Database Schema

This document describes the complete entity relationship model for the LedgerMonitor parking violation monitoring system.

---

## ER Diagram

```mermaid
erDiagram
    USERS ||--o{ AUDIT_LOGS : creates
    USERS ||--|| NOTIFICATION_PREFERENCES : has
    USERS ||--o{ TRUSTED_DEVICES : trusts
    
    HOSTS ||--o{ VEHICLES : accommodates
    
    VEHICLES ||--o{ DETECTIONS : has
    VEHICLES ||--o{ VIOLATIONS : associated-with
    VEHICLES ||--o{ SMS_LOGS : notified-via
    
    CAMERAS ||--o{ DETECTIONS : captures
    CAMERAS ||--o{ INCIDENTS : monitors
    CAMERAS ||--o{ NOTIFICATIONS : generates
    
    DETECTIONS ||--o{ VIOLATIONS : triggers
    DETECTIONS ||--o{ INCIDENTS : related-to
    DETECTIONS ||--o{ NOTIFICATIONS : creates
    
    VIOLATIONS ||--o{ INCIDENTS : linked-to
    VIOLATIONS ||--o{ NOTIFICATIONS : generates
    VIOLATIONS ||--o{ SMS_LOGS : sends
    
    INCIDENTS ||--o{ NOTIFICATIONS : triggers
    
    AUDIT_LOGS : tracks user actions
```

---

## Entity Details

### 1. **USERS**
Core user/admin entities in the system

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | TEXT | PRIMARY KEY | Unique user identifier |
| `email` | TEXT | UNIQUE, NOT NULL | User login email |
| `password` | TEXT | NOT NULL | Hashed password |
| `name` | TEXT | | User display name |
| `role` | TEXT | NOT NULL, DEFAULT 'barangay_user' | Role: barangay_user, admin, etc. |
| `createdAt` | TEXT | NOT NULL | ISO timestamp |
| `viberNumber` | TEXT | | (Legacy) Unused Viber contact field |
| `status` | TEXT | NOT NULL, DEFAULT 'active' | Account status: active/inactive |
| `contactNumber` | TEXT | | Secondary contact number (2FA, recovery) |
| `mustResetPassword` | INTEGER | NOT NULL, DEFAULT 1 | 1=must reset on next login |

**Relationships:**
- Has many `AUDIT_LOGS` (1:N)
- Has one `NOTIFICATION_PREFERENCES` (1:1)
- Has many `TRUSTED_DEVICES` (1:N)

---

### 2. **NOTIFICATION_PREFERENCES**
User notification configuration settings

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `userId` | TEXT | PRIMARY KEY, FK → users | Foreign key to USERS |
| `plate_not_visible` | INTEGER | NOT NULL, DEFAULT 1 | Enable/disable notifications |
| `warning_expired` | INTEGER | NOT NULL, DEFAULT 1 | Enable/disable notifications |
| `vehicle_detected` | INTEGER | NOT NULL, DEFAULT 1 | Enable/disable notifications |
| `incident_created` | INTEGER | NOT NULL, DEFAULT 1 | Enable/disable notifications |
| `updatedAt` | TEXT | NOT NULL | ISO timestamp |

**Relationships:**
- Belongs to one `USERS` (N:1)

---

### 3. **HOSTS**
Establishment/parking lot owners/operators

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | TEXT | PRIMARY KEY | Unique host identifier |
| `name` | TEXT | NOT NULL | Host/establishment name |
| `contactNumber` | TEXT | NOT NULL | Contact phone number |
| `address` | TEXT | | Physical address |
| `createdAt` | TEXT | NOT NULL | ISO timestamp |

**Relationships:**
- Has many `VEHICLES` (1:N)

---

### 4. **VEHICLES**
Registered or detected vehicles in the system

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | TEXT | PRIMARY KEY | Unique vehicle identifier |
| `plateNumber` | TEXT | UNIQUE, NOT NULL | License plate number |
| `ownerName` | TEXT | NOT NULL | Vehicle owner name |
| `contactNumber` | TEXT | NOT NULL | Owner contact number |
| `registeredAt` | TEXT | NOT NULL | ISO timestamp |
| `dataSource` | TEXT | DEFAULT 'barangay' | Source: barangay, host, manual, etc. |
| `hostId` | TEXT | FK → hosts | Associated host (if applicable) |
| `rented` | TEXT | | Rental status |
| `purposeOfVisit` | TEXT | | Purpose of parking |

**Relationships:**
- Belongs to one `HOSTS` (N:1, optional)
- Has many `DETECTIONS` (1:N)
- Associated with many `VIOLATIONS` (1:N)
- Referenced in many `SMS_LOGS` (1:N)

**Indexes:**
- `idx_vehicles_plateNumber` (plateNumber)

---

### 5. **CAMERAS**
Surveillance camera devices and their configurations

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | TEXT | PRIMARY KEY | Unique camera identifier |
| `name` | TEXT | NOT NULL | Camera display name |
| `locationId` | TEXT | NOT NULL | Location identifier |
| `status` | TEXT | NOT NULL, CHECK IN ('online', 'offline') | Current camera status |
| `lastCapture` | TEXT | NOT NULL | ISO timestamp of last capture |
| `deviceId` | TEXT | | Physical device identifier |
| `isFixed` | INTEGER | DEFAULT 1 | 1=fixed, 0=mobile camera |
| `illegalParkingZone` | INTEGER | DEFAULT 1 | 1=monitors illegal zone, 0=otherwise |

**Relationships:**
- Has many `DETECTIONS` (1:N)
- Has many `INCIDENTS` (1:N)
- Generates many `NOTIFICATIONS` (1:N)

**Indexes:**
- `idx_cameras_locationId` (locationId)

---

### 6. **DETECTIONS**
Vehicle detection events from AI/ML processing

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | TEXT | PRIMARY KEY | Unique detection identifier |
| `cameraId` | TEXT | NOT NULL, FK → cameras | Source camera |
| `plateNumber` | TEXT | NOT NULL | Detected license plate |
| `timestamp` | TEXT | NOT NULL | ISO timestamp of detection |
| `confidence` | REAL | NOT NULL | Detection confidence score (0-1) |
| `imageUrl` | TEXT | | URL to captured image |
| `imageBase64` | TEXT | | Base64 encoded image |
| `bbox` | TEXT | | Bounding box coordinates (JSON) |
| `class_name` | TEXT | | Vehicle class: car, motorcycle, truck, etc. |

**Relationships:**
- Belongs to one `CAMERAS` (N:1)
- Associated with one `VEHICLES` via plateNumber (N:1)
- Triggers many `VIOLATIONS` (1:N)
- Related to many `INCIDENTS` (1:N)
- Creates many `NOTIFICATIONS` (1:N)

**Indexes:**
- `idx_detections_cameraId` (cameraId)
- `idx_detections_timestamp` (timestamp)
- `idx_detections_plateNumber` (plateNumber)
- `idx_detections_class_name` (class_name)

---

### 7. **VIOLATIONS**
Parking violation records and their lifecycle

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | TEXT | PRIMARY KEY | Unique violation identifier |
| `ticketId` | TEXT | | Associated ticket identifier |
| `plateNumber` | TEXT | NOT NULL | License plate of violating vehicle |
| `cameraLocationId` | TEXT | NOT NULL | Location where violation occurred |
| `timeDetected` | TEXT | NOT NULL | ISO timestamp of detection |
| `timeIssued` | TEXT | | ISO timestamp when ticket was issued |
| `status` | TEXT | NOT NULL, CHECK IN ('warning', 'pending', 'issued', 'cancelled', 'cleared', 'resolved') | Violation status |
| `warningExpiresAt` | TEXT | | ISO timestamp when warning expires |

**Relationships:**
- Associated with one `VEHICLES` via plateNumber (N:1, logical relationship)
- Triggered by many `DETECTIONS` (1:N, logical relationship)
- Generates many `INCIDENTS` (1:N)
- Triggers many `NOTIFICATIONS` (1:N)
- Sends many `SMS_LOGS` (1:N, via `violationId`)

**Status Flow:** warning → pending → issued → (cancelled | cleared | resolved)

**Indexes:**
- `idx_violations_status` (status)
- `idx_violations_location` (cameraLocationId)
- `idx_violations_plate` (plateNumber)
- `idx_violations_timeDetected` (timeDetected)

---

### 8. **INCIDENTS**
Incident records created from violations or detections

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | TEXT | PRIMARY KEY | Unique incident identifier |
| `cameraId` | TEXT | NOT NULL, FK → cameras | Source camera |
| `locationId` | TEXT | NOT NULL | Incident location |
| `detectionId` | TEXT | | Associated detection |
| `plateNumber` | TEXT | | License plate involved |
| `timestamp` | TEXT | NOT NULL | ISO timestamp of incident |
| `reason` | TEXT | NOT NULL | Reason for incident: illegal_parking, speeding, etc. |
| `imageUrl` | TEXT | | Incident image URL |
| `imageBase64` | TEXT | | Base64 encoded image |
| `status` | TEXT | DEFAULT 'open' | Status: open, resolved, closed, etc. |

**Relationships:**
- Belongs to one `CAMERAS` (N:1)
- Related to one `DETECTIONS` (N:1, optional)
- Linked from many `VIOLATIONS` (1:N)
- Triggers many `NOTIFICATIONS` (1:N)

---

### 9. **NOTIFICATIONS**
Notification records for system alerts and events

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | TEXT | PRIMARY KEY | Unique notification identifier |
| `type` | TEXT | NOT NULL | Notification type: incident, violation, detection, etc. |
| `title` | TEXT | NOT NULL | Notification title |
| `message` | TEXT | NOT NULL | Notification message |
| `cameraId` | TEXT | | Related camera |
| `locationId` | TEXT | | Related location |
| `incidentId` | TEXT | | Related incident |
| `detectionId` | TEXT | | Related detection |
| `imageUrl` | TEXT | | Notification image URL |
| `imageBase64` | TEXT | | Base64 encoded image |
| `plateNumber` | TEXT | | Vehicle plate number |
| `timeDetected` | TEXT | | Detection timestamp |
| `reason` | TEXT | | Reason/context |
| `timestamp` | TEXT | NOT NULL | ISO timestamp |
| `read` | INTEGER | DEFAULT 0 | 1=read, 0=unread |

**Relationships:**
- Generated from one `CAMERAS` (1:N)
- Generated from one `DETECTIONS` (1:N)
- Generated from one `VIOLATIONS` (1:N)
- Generated from one `INCIDENTS` (1:N)
- Logged in `SMS_LOGS` (1:N)

**Indexes:**
- `idx_notifications_read` (read)
- `idx_notifications_timestamp` (timestamp)
- `idx_notifications_locationId` (locationId)

---

### 10. **SMS_LOGS**
SMS communication records for violation notifications

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | TEXT | PRIMARY KEY | Unique SMS log identifier |
| `violationId` | TEXT | | Related violation |
| `plateNumber` | TEXT | NOT NULL | Vehicle plate |
| `contactNumber` | TEXT | NOT NULL | SMS recipient phone number |
| `message` | TEXT | NOT NULL | SMS message content |
| `status` | TEXT | NOT NULL | Status: pending, sent, delivered, failed |
| `statusMessage` | TEXT | | Additional status details |
| `sentAt` | TEXT | NOT NULL | ISO timestamp when SMS was sent |
| `deliveredAt` | TEXT | | ISO timestamp when SMS was delivered |
| `error` | TEXT | | Error message if failed |
| `retryCount` | INTEGER | DEFAULT 0 | Number of retry attempts |
| `lastRetryAt` | TEXT | | ISO timestamp of last retry |

**Relationships:**
- References one `VIOLATIONS` via `violationId` (N:1, optional)
- Associated with one `VEHICLES` via `plateNumber` (N:1, logical relationship)

---

### 11. **AUDIT_LOGS**
User activity and system action tracking

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | TEXT | PRIMARY KEY | Unique audit log identifier |
| `userId` | TEXT | NOT NULL, FK → users | User performing action |
| `userEmail` | TEXT | NOT NULL | User email at time of action |
| `userName` | TEXT | | User name at time of action |
| `userRole` | TEXT | NOT NULL | User role at time of action |
| `action` | TEXT | NOT NULL | Action type: CREATE, UPDATE, DELETE, VIEW, etc. |
| `resource` | TEXT | | Resource type: violation, vehicle, incident, etc. |
| `resourceId` | TEXT | | ID of affected resource |
| `details` | TEXT | | Additional context/details (JSON) |
| `ipAddress` | TEXT | | Request origin IP address |
| `userAgent` | TEXT | | Browser/client user agent |
| `timestamp` | TEXT | NOT NULL | ISO timestamp |

**Relationships:**
- Belongs to one `USERS` (N:1)

**Indexes:**
- `idx_audit_logs_userId` (userId)
- `idx_audit_logs_timestamp` (timestamp)
- `idx_audit_logs_action` (action)

---

### 12. **TRUSTED_DEVICES**
Trusted devices to skip 2FA for a limited time

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | TEXT | PRIMARY KEY | Unique trusted device identifier |
| `userId` | TEXT | NOT NULL, FK → users | Owning user |
| `tokenHash` | TEXT | NOT NULL, UNIQUE | Hashed device token |
| `createdAt` | INTEGER | NOT NULL | Creation timestamp (epoch ms) |
| `expiresAt` | INTEGER | NOT NULL | Expiration timestamp (epoch ms) |
| `lastUsedAt` | INTEGER | | Last used timestamp (epoch ms) |

**Relationships:**
- Belongs to one `USERS` (N:1)

**Indexes:**
- `idx_trusted_devices_tokenHash` (tokenHash, UNIQUE)
- `idx_trusted_devices_userId` (userId)
- `idx_trusted_devices_expiresAt` (expiresAt)

---

## Key Relationships Summary

| From | To | Type | Description |
|------|-----|------|-------------|
| USERS | AUDIT_LOGS | 1:N | User performs audit-tracked actions |
| USERS | NOTIFICATION_PREFERENCES | 1:1 | User has notification settings |
| USERS | TRUSTED_DEVICES | 1:N | User has trusted browser/devices |
| HOSTS | VEHICLES | 1:N | Host accommodates multiple vehicles |
| VEHICLES | DETECTIONS | 1:N | Vehicle has multiple detections |
| VEHICLES | VIOLATIONS | 1:N | Vehicle has multiple violations |
| CAMERAS | DETECTIONS | 1:N | Camera captures multiple detections |
| CAMERAS | INCIDENTS | 1:N | Camera observes multiple incidents |
| DETECTIONS | VIOLATIONS | 1:N | Detection triggers violations |
| VIOLATIONS | INCIDENTS | 1:N | Violation generates incidents |
| VIOLATIONS | SMS_LOGS | 1:N | Violation triggers SMS notifications |

---

## Data Flow

1. **Detection → Violation → Incident → Notification → SMS**
   - Camera detects vehicle (DETECTION)
   - Detection triggers violation record (VIOLATION)
   - Violation generates incident (INCIDENT)
   - Incident creates notification (NOTIFICATION)
   - Notification triggers SMS (SMS_LOG)

2. **User Activity Tracking**
   - User performs action → AUDIT_LOG records action
   - Audit logs track: who, what, when, where, how

3. **Host Management**
   - Host created with contact info
   - Vehicles associated with host
   - Vehicles tracked and monitored

---

## Database Constraints

### Foreign Keys
- `notification_preferences.userId` → `users.id` (CASCADE DELETE)
- `vehicles.hostId` → `hosts.id` (SET NULL)
- `audit_logs.userId` → `users.id` (CASCADE DELETE)
- `trusted_devices.userId` → `users.id` (CASCADE DELETE)
- `detections.cameraId` → `cameras.id` (implied)
- `incidents.cameraId` → `cameras.id` (implied)

### Unique Constraints
- `users.email` (UNIQUE)
- `vehicles.plateNumber` (UNIQUE)

### Check Constraints
- `cameras.status` IN ('online', 'offline')
- `violations.status` IN ('warning', 'pending', 'issued', 'cancelled', 'cleared', 'resolved')

### Indexes (Performance Optimization)
- Audit logs: userId, timestamp, action
- Violations: status, cameraLocationId, plateNumber, timeDetected
- Detections: cameraId, timestamp, plateNumber, class_name
- Notifications: read, timestamp, locationId
- Vehicles: plateNumber
- Cameras: locationId
- Trusted devices: tokenHash, userId, expiresAt

---

## Statistics & Cardinality

- **Users**: Low cardinality (tens to hundreds)
- **Cameras**: Low cardinality (tens)
- **Vehicles**: Medium cardinality (thousands)
- **Detections**: High cardinality (potentially millions over time)
- **Violations**: High cardinality (thousands)
- **Incidents**: Medium cardinality (hundreds to thousands)
- **Notifications**: High cardinality (hundreds of thousands)
- **SMS_Logs**: High cardinality (potentially millions)
- **Audit_Logs**: High cardinality (hundreds of thousands)
- **Trusted_Devices**: Medium cardinality (per active user base)

---

## Performance Considerations

1. **Frequently Accessed**
   - Violations (filtered by status, location, time)
   - Detections (filtered by camera, time, plate)
   - Notifications (filtered by read status, time)

2. **Optimization Strategies**
   - Multi-column indexes on common filter combinations
   - Timestamp indexes for time-range queries
   - Status indexes for state-machine queries

3. **Data Retention**
   - SMS_LOGS may grow very large - consider archiving old records
   - DETECTIONS may grow large - consider partitioning by date
   - AUDIT_LOGS for compliance - may require long-term storage

---

*Last Updated: March 11, 2026*
