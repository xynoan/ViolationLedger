# LedgerMonitor - System Schematic Diagram

## Complete System Architecture

This document provides a clear and precise schematic diagram of the LedgerMonitor parking violation detection system, showing all components, connections, and data flows.

---

## Main System Schematic

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    LEDGERMONITOR SYSTEM                                      │
│                          Parking Violation Detection & Management                            │
└─────────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    HARDWARE LAYER                                            │
└─────────────────────────────────────────────────────────────────────────────────────────────┘

    ┌──────────────┐         ┌──────────────┐         ┌──────────────┐
    │   Camera 1   │         │   Camera 2   │         │   Camera 3   │
    │  (IP Camera) │         │  (IP Camera) │         │  (IP Camera) │
    │              │         │              │         │              │
    │ Location:    │         │ Location:    │         │ Location:    │
    │ Street Area 1│         │ Street Area 2│         │ Street Area 3│
    └──────┬───────┘         └──────┬───────┘         └──────┬───────┘
           │                        │                        │
           │  Ethernet/Wi-Fi        │  Ethernet/Wi-Fi        │  Ethernet/Wi-Fi
           │                        │                        │
           └────────────────────────┼────────────────────────┘
                                    │
                    ┌───────────────▼───────────────┐
                    │      Network Infrastructure   │
                    │                               │
                    │  ┌─────────────────────────┐ │
                    │  │   Network Switch/Router │ │
                    │  └─────────────────────────┘ │
                    │                               │
                    └───────────────┬───────────────┘
                                    │
                                    │ Network Connection
                                    │
┌───────────────────────────────────▼─────────────────────────────────────────────────────────┐
│                                    SERVER LAYER                                              │
│                                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                         Node.js Express Server (Port 3001)                          │   │
│  │                                                                                       │   │
│  │  ┌───────────────────────────────────────────────────────────────────────────────┐ │   │
│  │  │                            API Routes                                         │ │   │
│  │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │ │   │
│  │  │  │ /cameras │ │/vehicles │ │/violations│ │/captures │ │/detections│          │ │   │
│  │  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘          │ │   │
│  │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │ │   │
│  │  │  │  /auth   │ │/analytics│ │  /users  │ │/notifications│/audit-logs│       │ │   │
│  │  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘          │ │   │
│  │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐                                    │ │   │
│  │  │  │  /upload │ │ /health  │ │  /hosts  │                                    │ │   │
│  │  │  └──────────┘ └──────────┘ └──────────┘                                    │ │   │
│  │  └───────────────────────────────────────────────────────────────────────────────┘ │   │
│  │                                                                                       │   │
│  │  ┌───────────────────────────────────────────────────────────────────────────────┐ │   │
│  │  │                         Core Services                                         │ │   │
│  │  │                                                                               │ │   │
│  │  │  • Monitoring Service    - Camera health checks (every 1 min)                │ │   │
│  │  │  • Cleanup Service       - Database maintenance & cleanup                    │ │   │
│  │  │  • Capture Service       - Image capture scheduling (every 5 min)           │ │   │
│  │  │  • Detection Service     - Violation detection & processing                 │ │   │
│  │  │  • Notification Service  - SMS/Viber message sending                        │ │   │
│  │  │  • Audit Service        - Activity logging & tracking                       │ │   │
│  │  └───────────────────────────────────────────────────────────────────────────────┘ │   │
│  │                                                                                       │   │
│  │  ┌───────────────────────────────────────────────────────────────────────────────┐ │   │
│  │  │                         Middleware Layer                                      │ │   │
│  │  │                                                                               │ │   │
│  │  │  • Authentication Middleware  - JWT token validation                         │ │   │
│  │  │  • Authorization Middleware   - Role-based access control                    │ │   │
│  │  │  • Audit Middleware          - Activity logging                             │ │   │
│  │  │  • CORS Middleware           - Cross-origin resource sharing                │ │   │
│  │  └───────────────────────────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                         SQLite Database                                            │   │
│  │                                                                                       │   │
│  │  Tables:                                                                             │   │
│  │  • users          - System users (admin, barangay_user, encoder)                    │   │
│  │  • cameras        - Camera configurations & status                                 │   │
│  │  • vehicles       - Registered vehicle information                                 │   │
│  │  • violations     - Parking violation records                                     │   │
│  │  • detections     - AI detection results                                           │   │
│  │  • notifications  - SMS/Viber notification logs                                    │   │
│  │  • audit_logs     - System activity audit trail                                    │   │
│  │  • hosts          - Network host configurations                                    │   │
│  │  • incidents      - System incident records                                       │   │
│  └─────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                         Python AI Service Interface                                │   │
│  │                                                                                       │   │
│  │  • ai_service.py       - Main AI processing service                                 │   │
│  │  • Hugging Face Models - Vehicle detection & license plate recognition             │   │
│  │  • Google Gemini API   - Advanced image analysis                                    │   │
│  │                                                                                       │   │
│  │  Functions:                                                                          │   │
│  │  • analyze_image_with_gemini()  - AI image analysis                                │   │
│  │  • process_image()              - Image processing pipeline                        │   │
│  │  • detect_vehicles()            - Vehicle detection                                │   │
│  │  • read_license_plate()         - License plate recognition                        │   │
│  └─────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                         File Storage                                                │   │
│  │                                                                                       │   │
│  │  • /captured_images/  - Stored camera capture images                                │   │
│  │  • Image metadata     - Timestamps, camera IDs, locations                           │   │
│  └─────────────────────────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────┬─────────────────────────────────────────────────────────┘
                                    │
                                    │ Internet Connection
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
        │                           │                           │
┌───────▼────────┐        ┌─────────▼────────┐        ┌─────────▼────────┐
│                │        │                  │        │                  │
│ Google Gemini  │        │ Viber/Infobip   │        │ React Frontend   │
│   AI Service   │        │   SMS Service   │        │   Dashboard      │
│   (Cloud)      │        │     (Cloud)     │        │   (Port 8080)    │
│                │        │                  │        │                  │
│ • Image        │        │ • SMS/Viber     │        │ • Dashboard      │
│   Analysis     │        │   Messaging     │        │ • Camera Mgmt    │
│ • Vehicle      │        │ • Warning       │        │ • Violations     │
│   Detection    │        │   Delivery      │        │ • Analytics      │
│ • License      │        │ • Notification  │        │ • User Mgmt      │
│   Plate OCR    │        │   Logging       │        │ • Settings       │
│                │        │                  │        │                  │
└────────────────┘        └─────────┬────────┘        └─────────┬────────┘
                                    │                           │
                                    │                           │
┌───────────────────────────────────▼───────────────────────────▼───────────────────────────┐
│                                    USER LAYER                                                │
│                                                                                               │
│  ┌──────────────────────┐                        ┌──────────────────────┐                    │
│  │   Vehicle Owners     │                        │  Barangay Officials │                    │
│  │                      │                        │                      │                    │
│  │  • Receive SMS       │                        │  • View Dashboard   │                    │
│  │    Warnings          │                        │  • Manage Violations│                    │
│  │  • Mobile Phone      │                        │  • Issue Tickets    │                    │
│  │  • Viber Messages    │                        │  • View Analytics   │                    │
│  └──────────────────────┘                        └──────────────────────┘                    │
│                                                                                               │
│  ┌──────────────────────┐                        ┌──────────────────────┐                    │
│  │   System Admins      │                        │     Encoders         │                    │
│  │                      │                        │                      │                    │
│  │  • System Config     │                        │  • Register Vehicles │                    │
│  │  • User Management   │                        │  • Update Records    │                    │
│  │  • Camera Management │                        │  • Data Entry        │                    │
│  │  • Audit Logs        │                        │                      │                    │
│  └──────────────────────┘                        └──────────────────────┘                    │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Diagram

### 1. Image Capture & Analysis Flow

```
┌──────────┐
│ Camera   │
│ (Every   │
│ 5 min)   │
└────┬─────┘
     │
     │ 1. Capture Image
     ▼
┌─────────────────┐
│  Server         │
│  - Save Image   │
│  - Store in DB  │
└────┬────────────┘
     │
     │ 2. Send to AI Service
     ▼
┌─────────────────┐
│ Google Gemini   │
│ AI Service      │
│                 │
│ • Detect Vehicle│
│ • Read Plate    │
│ • Analyze Image │
└────┬────────────┘
     │
     │ 3. Return Results
     ▼
┌─────────────────┐
│  Server         │
│  - Process      │
│  - Check DB     │
└────┬────────────┘
     │
     │ 4. Decision Logic
     ▼
```

### 2. Violation Processing Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    AI Detection Results                      │
│  • Vehicle Detected: YES/NO                                  │
│  • License Plate: ABC-1234 (or NONE)                         │
│  • Confidence: 0.95                                          │
└────────────────────┬──────────────────────────────────────────┘
                     │
                     ▼
        ┌────────────────────────┐
        │  License Plate Read?   │
        └────┬───────────┬───────┘
             │           │
        YES  │           │ NO
             │           │
             ▼           ▼
    ┌──────────────┐  ┌──────────────────────┐
    │ Check Vehicle│  │ Create Notification  │
    │ Registration │  │ for Officials        │
    │ in Database  │  │ (No SMS sent)        │
    └────┬─────────┘  └──────────────────────┘
         │
         │ Vehicle Found?
         │
    ┌────┴────┐
    │         │
 YES│         │NO
    │         │
    ▼         ▼
┌────────┐ ┌──────────────────────┐
│ Send   │ │ Create Notification   │
│ SMS    │ │ for Officials        │
│ Warning│ │ (No SMS sent)        │
└───┬────┘ └──────────────────────┘
    │
    │
    ▼
┌──────────────────────┐
│ Create Violation     │
│ Record in Database   │
│                      │
│ Status: "warning"    │
│ Timestamp: Now       │
│ Photo: Stored        │
└──────────────────────┘
```

### 3. Warning Expiration & Ticket Flow

```
┌──────────────────────┐
│ Violation Status:    │
│ "warning"            │
│ (15 min timer)       │
└──────┬───────────────┘
       │
       │ Every 15 minutes
       ▼
┌──────────────────────┐
│ Check if Vehicle     │
│ Still Parked         │
└──────┬───────────────┘
       │
   ┌───┴───┐
   │       │
  NO│       │YES
   │       │
   ▼       ▼
┌──────┐ ┌──────────────────────┐
│Mark  │ │ Warning Expired      │
│as    │ │                      │
│Resolved│ │ Status: "pending"   │
│      │ │ Notify Officials    │
└──────┘ └──────┬───────────────┘
                │
                │ Official Reviews
                ▼
        ┌───────────────┐
        │ Issue Ticket? │
        └───┬───────┬───┘
            │       │
         YES│       │NO
            │       │
            ▼       ▼
    ┌──────────┐ ┌──────────┐
    │ Generate │ │ Cancel   │
    │ Ticket   │ │ Violation│
    │          │ │          │
    │ Status:  │ │ Status:  │
    │ "issued" │ │ "cancelled"│
    └──────────┘ └──────────┘
```

---

## Component Interaction Matrix

| Component | Interacts With | Protocol/Interface | Purpose |
|-----------|---------------|-------------------|---------|
| **Cameras** | Network Switch | Ethernet/Wi-Fi | Image capture & transmission |
| **Network Switch** | Server | Ethernet | Network connectivity |
| **Express Server** | SQLite DB | SQL | Data persistence |
| **Express Server** | Python AI Service | HTTP/Subprocess | Image analysis |
| **Express Server** | Google Gemini | HTTPS/REST API | AI image processing |
| **Express Server** | Viber/Infobip | HTTPS/REST API | SMS/Viber messaging |
| **Express Server** | React Frontend | HTTP/REST API | Web interface |
| **React Frontend** | Express Server | HTTP/REST API | Data retrieval & updates |
| **Monitoring Service** | Cameras | HTTP/RTSP | Health checks |
| **Cleanup Service** | SQLite DB | SQL | Database maintenance |

---

## Technology Stack Summary

### Frontend
- **Framework:** React 18 + TypeScript
- **Build Tool:** Vite
- **Styling:** Tailwind CSS
- **UI Components:** shadcn/ui
- **Routing:** React Router
- **State Management:** React Hooks
- **HTTP Client:** Fetch API

### Backend
- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** SQLite3
- **Authentication:** JWT (JSON Web Tokens)
- **File Storage:** Local filesystem
- **Image Processing:** Python + Hugging Face + Google Gemini

### External Services
- **AI Service:** Google Gemini API
- **Messaging:** Viber/Infobip API
- **Models:** Hugging Face ML Models

### Infrastructure
- **Network:** Ethernet/Wi-Fi
- **Protocols:** HTTP, HTTPS, RTSP (cameras)
- **Ports:** 3001 (Backend), 8080 (Frontend)

---

## Security Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Security Layers                          │
└─────────────────────────────────────────────────────────────┘

1. Network Security
   • Firewall configuration
   • Network isolation
   • VPN support (optional)

2. Application Security
   • JWT authentication
   • Role-based access control (RBAC)
   • Password hashing (bcrypt)
   • CORS protection
   • Input validation

3. Data Security
   • SQL injection prevention (prepared statements)
   • Audit logging
   • Secure file storage
   • API key encryption

4. Communication Security
   • HTTPS for external APIs
   • Secure token storage
   • Session management
```

---

## System Timing & Scheduling

| Service | Interval | Purpose |
|---------|----------|---------|
| **Image Capture** | Every 5 minutes | Automatic violation detection |
| **Camera Health Check** | Every 1 minute | Monitor camera status |
| **Warning Expiration Check** | Every 15 minutes | Check if warnings expired |
| **Database Cleanup** | Daily | Maintain database performance |
| **System Health Check** | On-demand | Monitor system status |

---

## Key System Metrics

- **Image Capture Frequency:** 5 minutes
- **Warning Period:** 15 minutes
- **Camera Status Check:** 1 minute
- **API Response Time:** < 2 seconds (typical)
- **AI Processing Time:** 3-5 seconds per image
- **SMS Delivery Time:** < 10 seconds

---

*This schematic diagram provides a comprehensive overview of the LedgerMonitor system architecture. For detailed implementation information, refer to the source code and other documentation files.*
