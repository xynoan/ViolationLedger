# Network Architecture - How Everything Connects

This document explains how all the components of the Park Smart Monitor system connect to each other. Think of it as a map showing how information flows through the system.

## Simple Explanation

Imagine the system like a postal service:
- **Cameras** are like mailboxes that collect information (photos)
- **Computer/Server** is like the post office that processes everything
- **Internet** is like the roads that deliver information
- **AI Service** is like a smart assistant that reads and understands the photos
- **SMS Service** is like a messenger that delivers warnings to vehicle owners

## Network Diagram (Text Format)

```
┌─────────────────────────────────────────────────────────────────┐
│                    PARK SMART MONITOR SYSTEM                    │
└─────────────────────────────────────────────────────────────────┘

                    ┌──────────────┐
                    │   Camera 1   │  ← Monitors Street Area 1
                    │  (Location)  │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   Camera 2   │  ← Monitors Street Area 2
                    │  (Location)  │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   Camera 3   │  ← Monitors Street Area 3
                    │  (Location)  │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │              │
                    │   Network    │  ← Connects all cameras
                    │   Switch/    │     (via cables or Wi-Fi)
                    │   Router     │
                    │              │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │              │
                    │   Computer/  │  ← Main system (runs software)
                    │   Server     │     Stores database and images
                    │              │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │              │
                    │   Internet   │  ← Connects to external services
                    │  Connection  │
                    │              │
                    └──────┬───────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼───────┐  ┌───────▼───────┐  ┌───────▼───────┐
│               │  │               │  │               │
│  AI Service   │  │  SMS Service  │  │   Web Browser │
│  (Google      │  │  (PhilSMS)    │  │   (Dashboard) │
│  Gemini)      │  │               │  │               │
│               │  │               │  │               │
└───────────────┘  └───────┬───────┘  └───────────────┘
                           │
                    ┌──────▼───────┐
                    │              │
                    │  Vehicle     │  ← Receives SMS warnings
                    │  Owner's     │
                    │  Mobile      │
                    │  Phone       │
                    │              │
                    └──────────────┘
```

## Detailed Component Connections

### 1. Camera to Network Connection

**Option A: Wired Connection (Recommended)**
```
Camera → Ethernet Cable → Network Switch → Computer
```
- **Pros:** More stable, faster, more secure
- **Cons:** Requires running cables
- **Best for:** Permanent installations

**Option B: Wireless Connection (Wi-Fi)**
```
Camera → Wi-Fi Signal → Router → Computer
```
- **Pros:** No cables needed, easier installation
- **Cons:** Can be affected by interference, less stable
- **Best for:** Temporary setups or hard-to-reach locations

### 2. Computer to Internet Connection

```
Computer → Router → Internet Service Provider (ISP) → Internet
```

**What flows through this connection:**
- Images from cameras → AI Service (for analysis)
- Analysis results → Computer (violation data)
- Violation data → SMS Service (to send warnings)
- Dashboard access → Web browsers (for officials to view)

### 3. Data Flow - How Information Moves

#### Step 1: Image Capture
```
Camera takes photo → Sends to Computer → Computer saves image
```

#### Step 2: AI Analysis
```
Computer sends image → Internet → AI Service (Google Gemini)
AI analyzes image → Detects vehicles → Reads license plates
AI sends results → Internet → Computer
```

#### Step 3: Violation Processing
```
Computer receives AI results → Checks if vehicle is registered
If registered → Prepares SMS warning
If not registered → Creates notification for Barangay officials
```

#### Step 4: SMS Sending
```
Computer prepares SMS → Internet → SMS Service (PhilSMS)
SMS Service → Mobile Network → Vehicle Owner's Phone
```

#### Step 5: Dashboard Viewing
```
Barangay Official opens web browser → Internet → Computer
Computer sends dashboard data → Browser displays violations, cameras, etc.
```

## Network Requirements

### Internet Speed Requirements

**Minimum Requirements:**
- **Download Speed:** 5 Mbps (megabits per second)
- **Upload Speed:** 2 Mbps
- **Why:** Images need to be uploaded to AI service, and results downloaded

**Recommended:**
- **Download Speed:** 10 Mbps or higher
- **Upload Speed:** 5 Mbps or higher
- **Why:** Faster speeds mean quicker processing and better performance

**For Multiple Cameras:**
- Add 2-3 Mbps upload speed per additional camera
- Example: 3 cameras need at least 6-9 Mbps upload speed

### Network Security

**Important Security Measures:**
1. **Password Protection** - All cameras and network equipment should have strong passwords
2. **Firewall** - Computer should have firewall enabled to block unauthorized access
3. **VPN (Optional)** - For remote access, use VPN for secure connection
4. **Regular Updates** - Keep all software updated to prevent security vulnerabilities

## Physical Layout Example

### Single Location Setup
```
                    [Electricity Post]
                           │
                    ┌──────▼───────┐
                    │   Camera     │  ← Mounted on post
                    │  (Pointing   │     pointing at street
                    │   at street) │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ Network Cable│  ← Runs down post
                    │  (or Wi-Fi)  │     to building
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   Building   │
                    │              │
                    │  [Router]    │
                    │      │       │
                    │  [Computer]  │  ← System runs here
                    │              │
                    └──────────────┘
```

### Multiple Location Setup
```
Location 1:          Location 2:          Location 3:
[Camera 1]          [Camera 2]          [Camera 3]
    │                   │                   │
    └───────────────────┼───────────────────┘
                        │
                ┌───────▼───────┐
                │   Network     │
                │   Switch      │
                └───────┬───────┘
                        │
                ┌───────▼───────┐
                │   Computer/   │
                │   Server      │
                └───────────────┘
```

## Troubleshooting Network Issues

### Common Problems and Solutions

**Problem: Cameras not connecting**
- **Check:** Network cables are properly connected
- **Check:** Cameras have power
- **Check:** Network switch/router is working
- **Solution:** Restart cameras and network equipment

**Problem: Slow image processing**
- **Check:** Internet speed (run speed test)
- **Check:** Too many devices using internet at same time
- **Solution:** Upgrade internet plan or limit other internet usage

**Problem: SMS not sending**
- **Check:** Internet connection is working
- **Check:** SMS service account has credits
- **Check:** Phone numbers are in correct format
- **Solution:** Contact SMS service provider or check account balance

**Problem: Cannot access dashboard**
- **Check:** Computer/server is running
- **Check:** Internet connection is active
- **Check:** Correct web address (URL)
- **Solution:** Restart computer/server or check firewall settings

---

## Summary

The network architecture is like a highway system:
- **Cameras** are the entry points (collecting information)
- **Computer** is the central hub (processing everything)
- **Internet** is the highway (delivering information)
- **AI and SMS Services** are specialized destinations (providing services)
- **Dashboard** is the control center (where officials view everything)

All components must be properly connected and working for the system to function correctly.

---

*This document provides a simplified explanation of the network architecture. For technical implementation details, consult with your IT support team.*

