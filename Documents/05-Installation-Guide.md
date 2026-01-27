# Installation Guide - Setting Up the System

This guide will help you set up the Park Smart Monitor system step by step. Follow these instructions carefully to ensure everything works correctly.

## Before You Begin

### What You Need
- All hardware components (see Bill of Materials document)
- Internet connection
- Basic computer knowledge (or IT support person)
- 2-4 hours for complete setup

### Important Notes
- **Backup Important Data:** If using an existing computer, backup your files first
- **Stable Internet:** Ensure internet connection is stable before starting
- **Power Supply:** Make sure you have reliable power (UPS recommended)
- **Patience:** Take your time - rushing can cause mistakes

---

## Step 1: Install Hardware Components

### 1.1 Install Cameras

**Location Selection:**
- Choose locations with clear view of no-parking zones
- Ensure cameras are high enough to see license plates
- Avoid direct sunlight or backlighting
- Make sure cameras are protected from weather

**Installation Steps:**
1. Mount camera bracket on pole, wall, or ceiling
2. Attach camera to bracket
3. Connect power supply (or PoE cable if using Power over Ethernet)
4. Connect network cable (or configure Wi-Fi)
5. Adjust camera angle to cover monitoring area
6. Secure all cables with cable clips

**Testing:**
- Check if camera has power (LED lights should be on)
- Access camera's web interface to verify it's working
- Take a test photo to ensure image quality is good

### 1.2 Set Up Computer/Server

**Initial Setup:**
1. Connect computer to power and turn on
2. Connect computer to internet (Ethernet cable recommended)
3. Install operating system if not already installed
4. Install all system updates
5. Set up user account with password

**Network Configuration:**
1. Connect computer to same network as cameras
2. Note the computer's IP address (you'll need this later)
3. Ensure firewall allows necessary connections

### 1.3 Connect Network Equipment

**If Using Wired Cameras:**
1. Connect cameras to network switch using Ethernet cables
2. Connect network switch to router
3. Connect router to internet modem
4. Connect computer to router

**If Using Wireless Cameras:**
1. Configure cameras to connect to Wi-Fi network
2. Ensure cameras and computer are on same network
3. Test connectivity

---

## Step 2: Install Software

### 2.1 Install Node.js

**What is Node.js?**
- It's the programming language the system uses
- Required for the system to run

**Installation Steps:**
1. Go to website: https://nodejs.org/
2. Download the "LTS" (Long Term Support) version
3. Run the installer
4. Follow installation wizard (accept defaults)
5. Restart computer after installation

**Verify Installation:**
- Open Command Prompt (Windows) or Terminal (Mac/Linux)
- Type: `node --version`
- You should see a version number (e.g., v18.17.0)
- If you see an error, installation failed - try again

### 2.2 Install Python

**What is Python?**
- Required for the AI image analysis service

**Installation Steps:**
1. Go to website: https://www.python.org/downloads/
2. Download latest Python 3.x version
3. Run the installer
4. **IMPORTANT:** Check the box "Add Python to PATH"
5. Follow installation wizard
6. Restart computer after installation

**Verify Installation:**
- Open Command Prompt or Terminal
- Type: `python --version`
- You should see a version number (e.g., Python 3.11.5)
- If you see an error, installation failed - try again

### 2.3 Install System Files

**Download System Files:**
1. Get the Park Smart Monitor system files
2. Extract files to a folder (e.g., `C:\ParkSmartMonitor` or `~/ParkSmartMonitor`)
3. Remember this location - you'll need it

**Install Frontend Dependencies:**
1. Open Command Prompt or Terminal
2. Navigate to the system folder:
   - Windows: `cd C:\ParkSmartMonitor`
   - Mac/Linux: `cd ~/ParkSmartMonitor`
3. Type: `npm install`
4. Wait for installation to complete (may take 5-10 minutes)

**Install Backend Dependencies:**
1. Still in the system folder, type: `npm run server:install`
2. Wait for installation to complete

**Install Python Dependencies:**
1. Navigate to server folder:
   - Windows: `cd server`
   - Mac/Linux: `cd server`
2. Type: `pip install -r requirements.txt`
3. Wait for installation to complete

---

## Step 3: Configure System Settings

### 3.1 Set Up Environment Variables

**What are Environment Variables?**
- Settings that tell the system how to connect to services
- Like giving the system a phone book with important numbers

**Create Configuration File:**
1. In the main system folder, create a file named `.env`
2. Open the file in a text editor (Notepad, TextEdit, etc.)
3. Add these lines:

```
VITE_API_URL=http://localhost:3001/api
PORT=3001
PHILSMS_API_TOKEN=your_sms_api_token_here
GEMINI_API_KEY=your_ai_api_key_here
```

**Get API Keys:**

**For SMS Service (PhilSMS):**
1. Go to https://app.philsms.com/
2. Create an account or log in
3. Go to API settings
4. Copy your API token
5. Replace `your_sms_api_token_here` with your actual token

**For AI Service (Google Gemini):**
1. Go to https://makersuite.google.com/app/apikey
2. Sign in with Google account
3. Create a new API key
4. Copy the API key
5. Replace `your_ai_api_key_here` with your actual key

**Save the .env file**

### 3.2 Configure Cameras in System

**Add Cameras to Database:**
1. Start the system (see Step 4)
2. Open web browser
3. Go to: http://localhost:8080
4. Log in (default: admin@admin.com / admin123!)
5. Go to "Cameras" page
6. Click "Add Camera"
7. Enter camera information:
   - Camera name (e.g., "Main Street Camera")
   - Location ID (e.g., "LOC-001")
   - Camera device ID or IP address
8. Save camera

**Test Camera Connection:**
1. Click on the camera in the list
2. Try to view live feed
3. If it works, camera is connected correctly
4. If not, check camera settings and network connection

---

## Step 4: Start the System

### 4.1 Start Backend Server

**Option A: Start Everything Together (Recommended)**
1. Open Command Prompt or Terminal
2. Navigate to system folder
3. Type: `npm run dev:all`
4. Wait for both servers to start
5. You should see messages like:
   - "Server running on http://localhost:3001"
   - "Frontend server running on http://localhost:8080"

**Option B: Start Separately**

**Terminal 1 - Backend:**
1. Navigate to system folder
2. Type: `npm run dev:server`
3. Wait for server to start

**Terminal 2 - Frontend:**
1. Open new Terminal/Command Prompt
2. Navigate to system folder
3. Type: `npm run dev`
4. Wait for server to start

### 4.2 Access the Dashboard

1. Open web browser (Chrome, Firefox, Edge, etc.)
2. Go to: http://localhost:8080
3. You should see the login page
4. Log in with default credentials:
   - **Email:** admin@admin.com
   - **Password:** admin123!

**Important:** Change the default password after first login!

### 4.3 Verify System is Working

**Check System Health:**
1. Go to "Settings" page
2. Check system status:
   - ✅ Database: Should show "Connected"
   - ✅ AI Service: Should show "Online"
   - ✅ SMS Service: Should show "Configured"
   - ✅ Cameras: Should show online cameras

**Test Image Capture:**
1. Go to "Cameras" page
2. Select a camera
3. Click "Capture" button
4. Wait for image to be captured and analyzed
5. Check if vehicle detection works

---

## Step 5: Initial Configuration

### 5.1 Register Vehicles

**Add Vehicles to Database:**
1. Go to "Vehicles" page
2. Click "Add Vehicle"
3. Enter vehicle information:
   - License plate number (exact format)
   - Owner name
   - Contact number (mobile phone, format: 09XXXXXXXXX)
   - Address (optional)
4. Save vehicle
5. Repeat for all vehicles you want to register

**Import Vehicles (If you have a list):**
- Contact system administrator for bulk import options

### 5.2 Set Up User Accounts

**Create User Accounts:**
1. Go to "User Management" page (Admin only)
2. Click "Add User"
3. Enter user information:
   - Email address
   - Name
   - Role (Barangay User, Encoder, or Admin)
   - Password
4. Save user

**User Roles:**
- **Admin:** Full access to all features
- **Barangay User:** Can view violations, issue tickets, manage vehicles
- **Encoder:** Can only add/edit vehicles

### 5.3 Configure Notification Settings

**Set Up Notifications:**
1. Go to "Settings" page
2. Go to "Notifications" section
3. Enable/disable notification types:
   - Plate not visible
   - Warning expired
   - Vehicle detected
   - Incident created
4. Save settings

---

## Step 6: Test the Complete System

### 6.1 Test Camera Monitoring

1. Ensure camera is pointing at a test area
2. Place a test vehicle (or use existing vehicle) in no-parking zone
3. Wait 5 minutes for automatic capture
4. Check "Tickets" or "Violations" page
5. Verify violation was detected

### 6.2 Test SMS Sending

1. Register a test vehicle with your phone number
2. Place vehicle in no-parking zone (or upload test image)
3. Wait for system to detect and send SMS
4. Check your phone for SMS message
5. Verify SMS was received

### 6.3 Test Dashboard Features

**Test Each Feature:**
- ✅ View cameras and live feeds
- ✅ View violations and tickets
- ✅ View vehicle registry
- ✅ View analytics and reports
- ✅ Issue a test ticket
- ✅ View audit logs

---

## Step 7: Production Setup (For 24/7 Operation)

### 7.1 Set Up Auto-Start

**Windows:**
1. Create a batch file (.bat) with start command
2. Add to Windows Startup folder
3. Or use Task Scheduler to start on boot

**Mac/Linux:**
1. Create a service file
2. Configure to start on system boot
3. Use systemd or launchd

### 7.2 Set Up Monitoring

**Monitor System Health:**
- Check system status daily
- Monitor camera status
- Check internet connection
- Review error logs

**Set Up Alerts:**
- Configure email alerts for system errors
- Set up notifications for camera failures
- Monitor disk space

### 7.3 Backup Configuration

**Regular Backups:**
1. Backup database file: `server/parking.db`
2. Backup configuration files: `.env` file
3. Backup captured images (optional)
4. Schedule automatic backups (daily recommended)

---

## Troubleshooting Common Issues

### Issue: System Won't Start

**Solutions:**
- Check if Node.js and Python are installed correctly
- Verify all dependencies are installed (`npm install`)
- Check if ports 3001 and 8080 are available
- Review error messages in terminal

### Issue: Cameras Not Connecting

**Solutions:**
- Verify cameras have power
- Check network cables are connected
- Verify cameras and computer are on same network
- Check camera IP addresses
- Test camera web interface directly

### Issue: AI Service Not Working

**Solutions:**
- Verify GEMINI_API_KEY is set correctly in .env file
- Check internet connection
- Verify API key is valid and has credits
- Check Python dependencies are installed

### Issue: SMS Not Sending

**Solutions:**
- Verify PHILSMS_API_TOKEN is set correctly
- Check SMS service account has credits
- Verify phone numbers are in correct format (09XXXXXXXXX)
- Check internet connection

### Issue: Dashboard Not Loading

**Solutions:**
- Verify frontend server is running (port 8080)
- Check browser console for errors
- Clear browser cache
- Try different browser
- Verify backend server is running (port 3001)

---

## Getting Help

If you encounter problems:

1. **Check Logs:**
   - Backend logs: Check terminal where server is running
   - Browser console: Press F12 in browser, check Console tab

2. **Review Documentation:**
   - Read other documents in this folder
   - Check system README file

3. **Contact Support:**
   - Contact your IT support person
   - Contact system developer/contractor

---

## Next Steps After Installation

1. **Train Users:**
   - Train Barangay officials on using dashboard
   - Train encoders on adding vehicles
   - Provide user manual

2. **Monitor System:**
   - Check system daily for first week
   - Verify all cameras are working
   - Test SMS sending regularly

3. **Optimize Settings:**
   - Adjust camera angles if needed
   - Fine-tune detection sensitivity
   - Configure notification preferences

4. **Expand System:**
   - Add more cameras as needed
   - Register more vehicles
   - Train additional users

---

## Summary Checklist

Use this checklist to ensure everything is set up:

- [ ] Hardware installed (cameras, computer, network equipment)
- [ ] Internet connection working
- [ ] Node.js installed and verified
- [ ] Python installed and verified
- [ ] System files downloaded and extracted
- [ ] Dependencies installed (npm install, pip install)
- [ ] Environment variables configured (.env file)
- [ ] API keys obtained and configured
- [ ] System starts successfully
- [ ] Dashboard accessible in browser
- [ ] Cameras added and connected
- [ ] Test vehicles registered
- [ ] Test capture and detection working
- [ ] Test SMS sending working
- [ ] User accounts created
- [ ] System running 24/7
- [ ] Backups configured

---

*Congratulations! If you've completed all steps, your Park Smart Monitor system should be up and running. Remember to change default passwords and regularly monitor the system for optimal performance.*

