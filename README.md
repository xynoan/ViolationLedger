# ViolationLedger

A parking monitoring system with camera surveillance, vehicle tracking, and violation management.

## Tech Stack

### Frontend
- React + TypeScript
- Vite
- Tailwind CSS
- shadcn/ui components
- React Router

### Backend
- Node.js + Express
- SQLite database
- REST API
- Python image analysis service (Hugging Face ML models)

## Setup Instructions

### 1. Install Frontend Dependencies
```bash
npm install
```

### 2. Install Backend Dependencies
```bash
npm run server:install
```

### 3. Install Python Dependencies (for Image Analysis)
```bash
cd server
pip install -r requirements.txt
huggingface-cli login
```

**Note**: You need a Hugging Face account and token to access the dataset. Get your token at https://huggingface.co/settings/tokens

### 4. Start Development Servers

**Option A: Run both servers together**
```bash
npm run dev:all
```

**Option B: Run separately**

Terminal 1 - Backend:
```bash
npm run dev:server
```

Terminal 2 - Frontend:
```bash
npm run dev
```

### 5. Access the Application
- Frontend: http://localhost:8080
- Backend API: http://localhost:3001/api

## API Endpoints

### Cameras
- `GET /api/cameras` - Get all cameras
- `GET /api/cameras/:id` - Get camera by ID
- `POST /api/cameras` - Create new camera
- `PUT /api/cameras/:id` - Update camera
- `DELETE /api/cameras/:id` - Delete camera

### Vehicles
- `GET /api/vehicles` - Get all vehicles (optional `?search=query`)
- `GET /api/vehicles/:id` - Get vehicle by ID
- `POST /api/vehicles` - Create new vehicle
- `PUT /api/vehicles/:id` - Update vehicle
- `DELETE /api/vehicles/:id` - Delete vehicle

### Violations
- `GET /api/violations` - Get all violations (optional `?status=warning`)
- `GET /api/violations/:id` - Get violation by ID
- `POST /api/violations` - Create new violation
- `PUT /api/violations/:id` - Update violation
- `DELETE /api/violations/:id` - Delete violation

### Captures
- `POST /api/captures` - Trigger image capture for all online cameras
- `POST /api/captures/:cameraId` - Trigger image capture for a specific camera

## Database

The SQLite database (`server/parking.db`) is automatically created on first server start with the following tables:
- `vehicles` - Registered vehicles
- `cameras` - Surveillance cameras
- `violations` - Parking violations
- `detections` - Vehicle detections from cameras

## Image Analysis Service

The system includes an automated image analysis service that:
- Captures images from online cameras every 5 minutes
- Analyzes images for illegally parked vehicles using Hugging Face ML models
- Recognizes license plates (when visible)
- Automatically creates violations/warnings in the system

See `server/README_PYTHON_SETUP.md` for detailed setup instructions.

## Environment Variables

Create a `.env` file in the server directory:
```
VITE_API_URL=http://localhost:3001/api
GEMINI_API_KEY=your_gemini_api_key_here
PHILSMS_API_TOKEN=your_philsms_api_token_here
```

**Viber Business Messages Configuration (Primary):**
- `INFOBIP_API_KEY`: Your Infobip API key (default: configured)
- `INFOBIP_BASE_URL`: Your Infobip base URL (default: `api.infobip.com`)
- `VIBER_SENDER`: Your registered Viber Business Messages sender name (default: `IBSelfServe` - shared sender available in free trial)
- The Viber Business Messages service will automatically send notifications to vehicle owners when illegal parking is detected
- Messages are sent only for registered vehicles with valid contact numbers
- Uses Infobip Viber Business Messages API v2 endpoint (`/viber/2/messages`)
- Supports messages up to 1,000 characters

**SMS Configuration (Legacy/Backup):**
- `PHILSMS_API_TOKEN`: Your PhilSMS API token (Bearer token format: `895|H7NndPV0RXF7RUgXRYEbUJXHAqnq7lsydykFXsNT1af7cccb`)
- `SEMAPHORE_API_KEY`: Your Semaphore SMS API key (alternative SMS provider)
- SMS service is available as a backup option

## Production Build

```bash
# Build frontend
npm run build

# Start backend
npm run server:start
```
