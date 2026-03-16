# LedgerMonitor - System Architecture Diagram

## Overview
LedgerMonitor is a full-stack parking management and violation detection system combining real-time camera monitoring, AI-powered vehicle detection, and comprehensive analytics.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER (Frontend)                             │
│                          React + TypeScript + Vite                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                   │
│  ┌──────────────────────────────────────┬──────────────────────────────────┐    │
│  │         Main Application             │      UI Components Layer         │    │
│  │      (src/App.tsx, main.tsx)         │   (Shadcn/ui Component Library)  │    │
│  │                                      │                                  │    │
│  │  • AuthProvider                      │  • Forms & Inputs               │    │
│  │  • QueryClientProvider               │  • Tables & Data Display        │    │
│  │  • Router (React Router)             │  • Cards & Alerts              │    │
│  │  • Protected Routes                  │  • Dialogs & Modals            │    │
│  │                                      │  • Dropdowns & Menus           │    │
│  └──────────────────────────────────────┴──────────────────────────────────┘    │
│                                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                          Pages (Views)                                   │    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐  │    │
│  │  │  Dashboard   │ │   Cameras    │ │   Vehicles   │ │   Analytics  │  │    │
│  │  │              │ │              │ │              │ │              │  │    │
│  │  │ • Live Feeds │ │ • Feed List  │ │ • Registry   │ │ • Charts     │  │    │
│  │  │ • Stats      │ │ • Status     │ │ • Details    │ │ • Metrics    │  │    │
│  │  │ • Alerts     │ │ • Controls   │ │ • Mgmt       │ │ • Reports    │  │    │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘  │    │
│  │                                                                         │    │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐  │    │
│  │  │   Tickets    │ │  Violations  │ │  Warnings    │ │     Users    │  │    │
│  │  │              │ │              │ │              │ │              │  │    │
│  │  │ • List View  │ │ • History    │ │ • Alerts     │ │ • Mgmt       │  │    │
│  │  │ • Details    │ │ • Filters    │ │ • Timers     │ │ • Roles      │  │    │
│  │  │ • Actions    │ │ • Export     │ │ • Logs       │ │ • Audit      │  │    │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘  │    │
│  │                                                                         │    │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                  │    │
│  │  │    Hosts     │ │ Upload Image │ │  Settings    │                  │    │
│  │  │              │ │              │ │              │                  │    │
│  │  │ • Network    │ │ • Manual     │ │ • Config     │                  │    │
│  │  │ • Status     │ │  Detection   │ │ • Preferences│                  │    │
│  │  │ • Monitoring │ │              │ │              │                  │    │
│  │  └──────────────┘ └──────────────┘ └──────────────┘                  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                   │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                  Hooks & State Management Layer                          │   │
│  ├──────────────────────────────────────────────────────────────────────────┤   │
│  │  • useAuth: Authentication state & user data                            │   │
│  │  • useCameraStream: Real-time camera feed management                    │   │
│  │  • useDetections: Vehicle detection handling                            │   │
│  │  • useCaptureTimer: Capture timing control                              │   │
│  │  • usePageTracking: Navigation & page analytics                         │   │
│  │  • React Query: Server state sync & caching                             │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                   │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                       API Client Layer (lib/api.ts)                      │   │
│  ├──────────────────────────────────────────────────────────────────────────┤   │
│  │  • REST API client                                                       │   │
│  │  • Request/Response interceptors                                         │   │
│  │  • Authentication token management                                       │   │
│  │  • Error handling                                                        │   │
│  │  • Base URL: http://localhost:3001/api                                 │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                   │
└─────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ HTTPS/HTTP
                                       │ REST API Calls
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         API GATEWAY / BACKEND LAYER                              │
│                       Express.js Server (server/server.js)                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                   │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                           Middleware Stack                                │   │
│  ├──────────────────────────────────────────────────────────────────────────┤   │
│  │  • CORS: Cross-origin resource handling                                  │   │
│  │  • Body Parser: JSON/URL-encoded request parsing (50MB limit)            │   │
│  │  • Request Timeout: 30-second timeout handler                            │   │
│  │  • Error Handler: Global exception handling                              │   │
│  │  • Audit Middleware: Comprehensive action logging                        │   │
│  │  • Auth Middleware: JWT validation & authorization                       │   │
│  │  • Static Files: Captured images serving                                 │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                   │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                         API Routes & Controllers                         │   │
│  ├──────────────────────────────────────────────────────────────────────────┤   │
│  │                                                                           │   │
│  │  ┌────────────────────┐  ┌────────────────────┐  ┌──────────────────┐  │   │
│  │  │  Auth Routes       │  │  Camera Routes     │  │  Vehicle Routes  │  │   │
│  │  │  /api/auth         │  │  /api/cameras      │  │  /api/vehicles   │  │   │
│  │  │                    │  │                    │  │                  │  │   │
│  │  │ • Login            │  │ • Get cameras      │  │ • Get vehicles   │  │   │
│  │  │ • Register         │  │ • Add camera       │  │ • Add vehicle    │  │   │
│  │  │ • Logout           │  │ • Update camera    │  │ • Update vehicle │  │   │
│  │  │ • Token refresh    │  │ • Delete camera    │  │ • Delete vehicle │  │   │
│  │  │ • Verify token     │  │ • Camera status    │  │ • Search         │  │   │
│  │  └────────────────────┘  └────────────────────┘  └──────────────────┘  │   │
│  │                                                                           │   │
│  │  ┌────────────────────┐  ┌────────────────────┐  ┌──────────────────┐  │   │
│  │  │ Capture Routes     │  │ Detection Routes   │  │ Violation Routes │  │   │
│  │  │ /api/captures      │  │ /api/detections    │  │ /api/violations  │  │   │
│  │  │                    │  │                    │  │                  │  │   │
│  │  │ • Get captures     │  │ • Get detections   │  │ • Get violations │  │   │
│  │  │ • Create capture   │  │ • Create detection │  │ • Create ticket  │  │   │
│  │  │ • Filter/Search    │  │ • Filter/Search    │  │ • Update ticket  │  │   │
│  │  │ • Analytics        │  │ • Analytics        │  │ • Filter/Search  │  │   │
│  │  │ • Export           │  │ • Confidence levels│  │ • Export         │  │   │
│  │  └────────────────────┘  └────────────────────┘  └──────────────────┘  │   │
│  │                                                                           │   │
│  │  ┌────────────────────┐  ┌────────────────────┐  ┌──────────────────┐  │   │
│  │  │ User Routes        │  │ Notification Routes│  │ Host Routes      │  │   │
│  │  │ /api/users         │  │ /api/notifications│  │ /api/hosts       │  │   │
│  │  │                    │  │                    │  │                  │  │   │
│  │  │ • User management  │  │ • Send alerts      │  │ • Network status │  │   │
│  │  │ • Roles/Permissions│  │ • Notification log │  │ • Server status  │  │   │
│  │  │ • Profile          │  │ • Preferences      │  │ • Uptime check   │  │   │
│  │  │ • Audit            │  │ • Multi-channel    │  │ • System info    │  │   │
│  │  └────────────────────┘  └────────────────────┘  └──────────────────┘  │   │
│  │                                                                           │   │
│  │  ┌────────────────────┐  ┌────────────────────┐  ┌──────────────────┐  │   │
│  │  │ Analytics Routes   │  │ Upload Routes      │  │ Audit Log Routes │  │   │
│  │  │ /api/analytics     │  │ /api/upload        │  │ /api/audit-logs  │  │   │
│  │  │                    │  │                    │  │                  │  │   │
│  │  │ • Dashboard stats  │  │ • Image upload     │  │ • Log retrieval  │  │   │
│  │  │ • Historical data  │  │ • File processing  │  │ • Audit trail    │  │   │
│  │  │ • Reports          │  │ • Validation       │  │ • Actions log    │  │   │
│  │  │ • Trends           │  │ • Detection run    │  │ • Compliance     │  │   │
│  │  └────────────────────┘  └────────────────────┘  └──────────────────┘  │   │
│  │                                                                           │   │
│  │  ┌────────────────────┐  ┌────────────────────┐                         │   │
│  │  │ Health Routes      │  │ Incident Routes    │                         │   │
│  │  │ /api/health        │  │ /api/incidents     │                         │   │
│  │  │                    │  │                    │                         │   │
│  │  │ • System health    │  │ • Incident tracking│                         │   │
│  │  │ • Database status  │  │ • Incident details │                         │   │
│  │  │ • Service checks   │  │ • Resolution       │                         │   │
│  │  └────────────────────┘  └────────────────────┘                         │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                   │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                         Background Services                               │   │
│  ├──────────────────────────────────────────────────────────────────────────┤   │
│  │  • Monitoring Service: Continuous system monitoring & health checks      │   │
│  │  • Cleanup Service: Periodic image cleanup & maintenance                 │   │
│  │  • AI Detection Service: Vehicle detection & plate recognition           │   │
│  │  • Notification Service: SMS alerting (iProgSMS)                         │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                   │
└─────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ SQL Queries
                                       │ File I/O
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           DATA PERSISTENCE LAYER                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                   │
│  ┌──────────────────────────────┬──────────────────────────────────────────┐   │
│  │    SQL.js Database            │    File System Storage                  │   │
│  │    (parking.db - SQLite)       │    (File-based)                         │   │
│  │                               │                                        │   │
│  │  Tables:                       │  Directories:                          │   │
│  │  • users                       │  • captured_images/                    │   │
│  │  • cameras                     │  • server/captured_images/             │   │
│  │  • vehicles                    │  • Uploaded files                      │   │
│  │  • violations                  │  • Temporary processing files          │   │
│  │  • captures                    │  • Database backup files               │   │
│  │  • detections                  │  • Logs                                │   │
│  │  • notifications               │                                        │   │
│  │  • audit_logs                  │                                        │   │
│  │  • incidents                   │                                        │   │
│  │  • hosts                        │                                        │   │
│  └──────────────────────────────┴──────────────────────────────────────────┘   │
│                                                                                   │
└─────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ HTTP/gRPC
                                       │ API Calls
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        EXTERNAL SERVICES LAYER                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                   │
│  ┌──────────────────────────────┬──────────────────────────────────────────┐   │
│  │   AI Detection Service        │    Notification Services                │   │
│  │   (Python - ai_service.py)    │                                        │   │
│  │                               │  • iProgSMS API: SMS messaging        │   │
│  │  Features:                    │  • GEMINI_API_KEY: AI processing       │   │
│  │  • Vehicle Detection          │  • Email Service (optional)            │   │
│  │  • License Plate Recognition  │  • SMS Service (optional)              │   │
│  │  • Confidence Scoring         │                                        │   │
│  │  • Image Processing           │                                        │   │
│  │  • ML Model Integration       │                                        │   │
│  │                               │                                        │   │
│  │  Tech Stack:                  │                                        │   │
│  │  • Python 3.x                 │                                        │   │
│  │  • TensorFlow/PyTorch         │                                        │   │
│  │  • OpenCV                     │                                        │   │
│  │  • ComputerVision APIs        │                                        │   │
│  └──────────────────────────────┴──────────────────────────────────────────┘   │
│                                                                                   │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                    External Service Dependencies                         │   │
│  │                                                                          │   │
│  │  • GEMINI_API_KEY: Google Gemini for AI vision tasks                    │   │
│  │  • IPROGSMS_API_TOKEN: SMS notifications                               │   │
│  │  • Environment Variables: Loaded from .env files                        │   │
│  │  • Port Fallback: Automatic port detection (3001, 3002, 3003...)       │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Details

### Frontend Architecture

**Client Entry Point:**
- `src/main.tsx` - React app initialization
- `src/App.tsx` - Main router & provider setup

**Page Layer (src/pages/):**
- Dashboard, Cameras, Vehicles, Analytics
- Tickets, Violations, Warnings, Users
- Hosts, Upload, Settings, Audit Logs

**Component Layer (src/components/):**
- Layout: Header, Sidebar, MainLayout
- Dashboard: Video feeds, stats, alerts
- UI: 40+ Shadcn/ui components

**State Management:**
- React Query: Server state & caching
- React Context: Auth & global state
- Hooks: Custom hooks for features

**Styling:**
- Tailwind CSS: Utility-first styling
- PostCSS: CSS processing

### Backend Architecture

**Server Setup (server/server.js):**
- Express.js framework
- CORS enabled
- 50MB request limit
- Request timeout: 30 seconds
- Global error handling

**Route Handlers:**
- 14 main route modules
- RESTful API design
- Authentication middleware
- Audit logging on all actions

**Database (server/database.js):**
- SQL.js (SQLite in-memory with persistence)
- parking.db file storage
- Multi-table schema

**Services:**
- `ai_service.py`: Vehicle/plate detection
- `monitoring_service.js`: System monitoring
- `cleanup_service.js`: Image cleanup
*** End Patch

---

## Data Flow

### Authentication Flow
```
Login Page
    ↓
/api/auth/login
    ↓
Database Lookup
    ↓
JWT Token Generation
    ↓
Token Stored in Client
    ↓
Subsequent Requests Include Token
    ↓
Auth Middleware Validation
```

### Detection Flow
```
Camera Feed
    ↓
Capture Image
    ↓
Send to AI Service (Python)
    ↓
Vehicle Detection & Plate Recognition
    ↓
Store Detection in Database
    ↓
Generate Violation/Ticket if Needed
    ↓
Send Notification (SMS/Email)
    ↓
Update Dashboard in Real-time
```

### Upload Flow
```
Manual Image Upload
    ↓
File Validation
    ↓
Send to AI Service
    ↓
Get Detection Results
    ↓
Store in Database
    ↓
Create Incident if Needed
    ↓
Update UI
```

---

## Technology Stack

### Frontend
| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | - |
| Build Tool | Vite | - |
| Framework | React | 18+ |
| Language | TypeScript | 5+ |
| Routing | React Router | 6+ |
| State Mgmt | React Query | 5.83+ |
| UI Library | Shadcn/ui | - |
| Styling | Tailwind CSS | 3+ |
| Forms | React Hook Form | 7+ |
| Package Mgr | Bun/npm | - |

### Backend
| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 18+ |
| Framework | Express.js | 4.18+ |
| Database | SQL.js/SQLite | - |
| Language | JavaScript (ES6+) | - |
| Auth | JWT | - |
| CORS | CORS Middleware | 2.8+ |
| File Handling | fs-extra | 11+ |

### External Services
| Service | Purpose | Provider |
|---------|---------|----------|
| AI Vision | Detection & Recognition | Custom Python/Google |
| Notifications | SMS | iProgSMS API |
| AI Processing | Vision Tasks | Google Gemini API |

---

## Security Features

1. **Authentication**
   - JWT token-based auth
   - Protected routes
   - Role-based access control

2. **Authorization**
   - Auth middleware on API routes
   - User role validation
   - Action-level permissions

3. **Audit Trail**
   - Audit middleware logging
   - Complete action history
   - User activity tracking

4. **Data Protection**
   - Database encryption ready
   - File access control
   - API input validation

---

## Scalability Considerations

1. **Database**: SQL.js can be replaced with PostgreSQL/MySQL
2. **File Storage**: Can migrate to cloud (AWS S3, Azure Blob)
3. **AI Service**: Python service can run on GPU servers
4. **Notifications**: Scalable message queue (RabbitMQ, Redis)
5. **Frontend**: Static hosting on CDN possible
6. **Backend**: Containerizable with Docker/Kubernetes

---

## Deployment Architecture

```
┌─────────────────────────────────┐
│      Docker Containers          │
├─────────────────────────────────┤
│                                 │
│  Frontend Container             │
│  • Vite build output            │
│  • Nginx/Static Server          │
│                                 │
│  Backend Container              │
│  • Node.js Express Server       │
│  • Port: 3001 (default)         │
│                                 │
│  AI Service Container           │
│  • Python 3.x runtime          │
│  • TensorFlow/Models           │
│                                 │
│  Database Volume                │
│  • parking.db persistence      │
│                                 │
│  File Storage Volume            │
│  • Captured images             │
│  • Logs                        │
│                                 │
└─────────────────────────────────┘
```

---

## Environment Configuration

**Frontend (.env):**
- `VITE_API_URL`: Backend API endpoint

**Backend (.env in /server):**
- `PORT`: Server port (default: 3001)
- `NODE_ENV`: Environment (development/production)
- `GEMINI_API_KEY`: Google AI vision API
- `IPROGSMS_API_TOKEN`: Notification SMS service API token
- Database connection strings (if not SQLite)

---

## Key Features by Component

### Dashboard
- Real-time camera feeds
- Live statistics
- Recent tickets/violations
- System alerts

### Analytics
- Historical data analysis
- Reports generation
- Trend visualization
- Export capabilities

### User Management
- Admin controls
- Role assignment
- Audit logging
- Access management

### Monitoring
- System health checks
- Service availability
- Performance metrics
- Alert generation
