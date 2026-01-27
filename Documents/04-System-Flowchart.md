# System Flowchart - How the System Works Step-by-Step

This document explains the step-by-step process of how the Park Smart Monitor system detects violations and sends warnings. Think of it as a recipe that shows exactly what happens from start to finish.

## Main System Flow - Violation Detection Process

```
┌─────────────────────────────────────────────────────────────┐
│                    START: System Running                     │
│              (Monitoring cameras every 5 minutes)            │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 1: Camera Takes Photo                                 │
│  • Camera automatically captures image of monitored area    │
│  • Image is sent to computer/server                          │
│  • Image is saved with timestamp and camera ID              │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 2: Send Image to AI Service                           │
│  • Computer uploads image to Google Gemini AI              │
│  • AI service receives the image                             │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 3: AI Analyzes Image                                  │
│  • AI looks for vehicles in the image                       │
│  • AI checks if vehicles are illegally parked               │
│  • AI tries to read license plate numbers                   │
│  • AI returns results:                                      │
│    - Vehicle detected: YES or NO                            │
│    - License plate number (if readable)                    │
│    - Vehicle type (car, motorcycle, truck, bus)             │
│    - Confidence level (how sure AI is)                      │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
                    ┌───────┴───────┐
                    │               │
            ┌───────▼───────┐ ┌─────▼──────┐
            │ Vehicle       │ │ No Vehicle  │
            │ Detected?     │ │ Detected   │
            │ YES           │ │ NO         │
            └───────┬───────┘ └─────┬──────┘
                    │               │
                    │               └──────────────┐
                    │                              │
                    ▼                              │
┌─────────────────────────────────────────────┐   │
│  STEP 4: Check License Plate               │   │
│  • Was license plate readable?              │   │
│  • What is the plate number?                │   │
└───────────┬─────────────────────────────────┘   │
            │                                      │
    ┌───────┴───────┐                             │
    │               │                             │
┌───▼───┐     ┌─────▼─────┐                       │
│ Plate │     │ Plate Not │                       │
│ Read  │     │ Readable  │                       │
│ YES   │     │ (NONE)    │                       │
└───┬───┘     └─────┬─────┘                       │
    │              │                              │
    │              └──────────┐                   │
    │                         │                   │
    ▼                         ▼                   ▼
┌──────────────────────────────────────────────────────────┐
│  STEP 5: Check Vehicle Registration                      │
│  • Search database for this license plate number         │
│  • Is vehicle registered in system?                      │
└───────────┬──────────────────────────────────────────────┘
            │
    ┌───────┴───────┐
    │               │
┌───▼──────┐  ┌─────▼──────┐
│ Vehicle  │  │ Vehicle    │
│ Found in │  │ NOT Found  │
│ Database │  │ in Database│
└───┬──────┘  └─────┬──────┘
    │               │
    │               └──────────────┐
    │                              │
    ▼                              ▼
┌──────────────────────────────────────────────────────────┐
│  STEP 6: Create Violation Record                         │
│  • Save violation in database                            │
│  • Record: plate number, location, time, photo          │
│  • Set status: "warning" (first violation)              │
└───────────┬──────────────────────────────────────────────┘
            │
    ┌───────┴───────┐
    │               │
┌───▼──────┐  ┌─────▼──────┐
│ Vehicle  │  │ Vehicle    │
│ Found    │  │ NOT Found  │
│ (Has     │  │ (No        │
│ Contact) │  │ Contact)   │
└───┬──────┘  └─────┬──────┘
    │               │
    │               └──────────────┐
    │                              │
    ▼                              ▼
┌──────────────────────────────────────────────────────────┐
│  STEP 7: Send SMS Warning                                │
│  • Get vehicle owner's phone number from database        │
│  • Prepare SMS message with violation details            │
│  • Send SMS via PhilSMS service                          │
│  • Message: "Warning: Your vehicle [PLATE] is           │
│    illegally parked at [LOCATION]. Please move it."      │
└───────────┬──────────────────────────────────────────────┘
            │
            │
            ▼
┌──────────────────────────────────────────────────────────┐
│  STEP 8: Create Notification for Officials               │
│  • If SMS sent: Log SMS status                           │
│  • If no SMS (plate not readable or vehicle not found):  │
│    Create notification for Barangay officials            │
│  • Officials can see violation on dashboard              │
└───────────┬──────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────┐
│  STEP 9: Wait for Next Cycle                             │
│  • System waits 5 minutes                                │
│  • Then returns to STEP 1                                │
│  • Process repeats automatically                         │
└──────────────────────────────────────────────────────────┘
```

## Warning Expiration Flow

```
┌──────────────────────────────────────────────────────────┐
│  Warning Sent to Vehicle Owner                           │
│  (15-minute warning period starts)                       │
└───────────┬──────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────┐
│  System Checks Every 15 Minutes:                        │
│  • Is vehicle still parked?                              │
│  • Has 15 minutes passed since warning?                  │
└───────────┬──────────────────────────────────────────────┘
            │
    ┌───────┴───────┐
    │               │
┌───▼──────┐  ┌─────▼──────┐
│ Vehicle  │  │ Vehicle    │
│ Moved    │  │ Still      │
│ (Gone)   │  │ Parked     │
└───┬──────┘  └─────┬──────┘
    │               │
    │               │
    ▼               ▼
┌──────────┐  ┌──────────────────────────────────────────┐
│ Mark as  │  │ Warning Expired - Vehicle Still There   │
│ Resolved │  │ • Change status to "pending"            │
│ (No      │  │ • Notify Barangay officials              │
│ Further  │  │ • Ready for ticket issuance              │
│ Action)  │  └──────────────────────────────────────────┘
└──────────┘
```

## Manual Ticket Issuance Flow

```
┌──────────────────────────────────────────────────────────┐
│  Barangay Official Views Violation on Dashboard           │
└───────────┬──────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────┐
│  Official Reviews:                                        │
│  • Violation photo                                        │
│  • Vehicle information                                    │
│  • Location and time                                      │
└───────────┬──────────────────────────────────────────────┘
            │
    ┌───────┴───────┐
    │               │
┌───▼──────┐  ┌─────▼──────┐
│ Issue    │  │ Cancel     │
│ Ticket   │  │ Violation  │
└───┬──────┘  └─────┬──────┘
    │               │
    │               ▼
    │       ┌───────────────┐
    │       │ Mark as       │
    │       │ Cancelled     │
    │       └───────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│  Generate Ticket                                         │
│  • Create unique ticket ID                               │
│  • Set violation status to "issued"                      │
│  • Record ticket details                                 │
│  • Save ticket in database                               │
└───────────┬──────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────┐
│  Ticket Issued Successfully                              │
│  • Can be viewed in violations history                   │
│  • Can be printed or exported                            │
└──────────────────────────────────────────────────────────┘
```

## Vehicle Registration Flow

```
┌──────────────────────────────────────────────────────────┐
│  Encoder or Barangay Official Adds Vehicle               │
└───────────┬──────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────┐
│  Enter Vehicle Information:                               │
│  • License plate number                                  │
│  • Owner name                                            │
│  • Contact number (mobile phone)                         │
│  • Address (optional)                                     │
└───────────┬──────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────┐
│  Save to Database                                        │
│  • Vehicle is now registered                             │
│  • System can now send SMS if this vehicle is detected   │
└──────────────────────────────────────────────────────────┘
```

## Camera Status Monitoring Flow

```
┌──────────────────────────────────────────────────────────┐
│  System Checks Camera Status Every Minute                │
└───────────┬──────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────┐
│  Test Camera Connection                                   │
│  • Can computer communicate with camera?                 │
└───────────┬──────────────────────────────────────────────┘
            │
    ┌───────┴───────┐
    │               │
┌───▼──────┐  ┌─────▼──────┐
│ Camera   │  │ Camera     │
│ Online   │  │ Offline    │
│ (Working)│  │ (Not       │
│          │  │ Working)   │
└───┬──────┘  └─────┬──────┘
    │               │
    │               ▼
    │       ┌──────────────────┐
    │       │ Mark as Offline  │
    │       │ Show warning on  │
    │       │ dashboard        │
    │       └──────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│  Camera Ready for Next Capture                           │
│  • Will be used in next 5-minute cycle                   │
└──────────────────────────────────────────────────────────┘
```

## Key Decision Points

### Decision 1: Vehicle Detected?
- **YES** → Continue to license plate check
- **NO** → Wait for next cycle (no action needed)

### Decision 2: License Plate Readable?
- **YES** → Continue to vehicle registration check
- **NO** → Create notification for officials (no SMS sent)

### Decision 3: Vehicle Registered?
- **YES** → Send SMS to vehicle owner
- **NO** → Create notification for officials (no SMS sent)

### Decision 4: Vehicle Moved After Warning?
- **YES** → Mark violation as resolved
- **NO** → After 15 minutes, notify officials for ticket issuance

## Time Intervals

- **Image Capture:** Every 5 minutes (automatic)
- **Warning Period:** 15 minutes (vehicle owner has time to move vehicle)
- **Status Check:** Every 15 minutes (check if vehicle moved)
- **Camera Status Check:** Every 1 minute (monitor camera health)

## Summary

The system works like an automated security guard:
1. **Watches** - Cameras take photos every 5 minutes
2. **Analyzes** - AI checks for illegally parked vehicles
3. **Identifies** - Tries to read license plates
4. **Notifies** - Sends SMS to registered owners or alerts officials
5. **Tracks** - Records everything in the database
6. **Repeats** - Does this continuously, 24/7

All of this happens automatically without human intervention, making it an efficient and cost-effective solution for monitoring parking violations.

---

*This flowchart shows the main processes. The actual system may have additional checks and validations for accuracy and reliability.*

