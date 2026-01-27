import express from 'express';
import db from '../database.js';
import { fileURLToPath } from 'url';
import path from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { analyzeImageWithAI, processDetectionResults } from '../ai_detection_service.js';
import { createViolationFromDetection } from './violations.js';
import { shouldCreateNotification } from './notifications.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CAPTURED_IMAGES_DIR = path.join(__dirname, '..', 'captured_images');

async function ensureCapturedImagesDir() {
  if (!existsSync(CAPTURED_IMAGES_DIR)) {
    await mkdir(CAPTURED_IMAGES_DIR, { recursive: true });
  }
}

ensureCapturedImagesDir().catch(console.error);

const router = express.Router();
function getStatements() {
  return {
    createDetection: db.prepare(`
      INSERT INTO detections (id, cameraId, plateNumber, timestamp, confidence, imageUrl, bbox, class_name, imageBase64)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    createIncident: db.prepare(`
      INSERT INTO incidents (id, cameraId, locationId, detectionId, plateNumber, timestamp, reason, imageUrl, imageBase64, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    createNotification: db.prepare(`
      INSERT INTO notifications (id, type, title, message, cameraId, locationId, incidentId, detectionId, imageUrl, imageBase64, plateNumber, timeDetected, reason, timestamp, read)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
  };
}

router.post('/analyze', async (req, res) => {
  try {
    await ensureCapturedImagesDir();
    
    const { imageData, locationId } = req.body;
    
    if (!imageData) {
      return res.status(400).json({ error: 'Image data is required' });
    }

    // Default location if not provided
    const uploadLocationId = locationId || 'MANUAL-UPLOAD';
    
    let imageUrl = null;
    let imageBase64 = null;

    try {
      // Extract base64 data (remove data:image/jpeg;base64, prefix if present)
      const base64Data = imageData.includes(',') 
        ? imageData.split(',')[1] 
        : imageData;
      
      // Convert base64 to buffer
      const imageBuffer = Buffer.from(base64Data, 'base64');
      
      // Generate filename
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
      const filename = `upload-${timestamp}.jpg`;
      const filepath = path.join(CAPTURED_IMAGES_DIR, filename);
      
      // Save image to file
      await writeFile(filepath, imageBuffer);
      
      // Store filename in database (relative path)
      imageUrl = filename;
      
      // Store base64 in database for easy retrieval
      imageBase64 = imageData;
      
      console.log(`✅ Uploaded image saved: ${filename}`);
    } catch (imageError) {
      console.error('Error saving uploaded image:', imageError);
      return res.status(500).json({ error: 'Failed to save image' });
    }

    // Analyze image with AI (Gemini 2.5 Flash)
    let detections = [];
    let aiAnalysisError = null;
    // Use a placeholder camera ID for manual uploads
    const placeholderCameraId = 'MANUAL-UPLOAD-CAM';
    
    try {
      console.log('🤖 Analyzing uploaded image with AI (Gemini 2.5 Flash)...');
      const aiResult = await analyzeImageWithAI(imageBase64);
      
      if (aiResult.error) {
        console.warn('⚠️  AI analysis error:', aiResult.error);
        aiAnalysisError = aiResult.error;
      } else {
        console.log(`✅ AI detected ${aiResult.vehicles?.length || 0} vehicle(s)`);
      }
      
      // Process AI results into detection records
      detections = processDetectionResults(aiResult, placeholderCameraId, imageUrl, imageBase64);
      
    } catch (aiError) {
      console.error('❌ AI analysis failed:', aiError);
      aiAnalysisError = aiError.message;
      // Fallback: create placeholder detection
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
      const detectionId = `DET-UPLOAD-${timestamp}-0`;
      detections = [{
        id: detectionId,
        cameraId: placeholderCameraId,
        plateNumber: 'NONE',
        timestamp: new Date().toISOString(),
        confidence: 0.0,
        imageUrl,
        bbox: null,
        class_name: 'none',
        imageBase64
      }];
    }

    // Process detections and handle violations/notifications
    const statements = getStatements();
    const savedDetections = [];
    const incidentsCreated = [];
    const notificationsCreated = [];
    const violationsCreated = [];
    const detectedVehicles = []; // Store detected vehicles with owner info
    let actualMessageSent = false; // Track if Viber message was actually sent successfully
    
    for (const detection of detections) {
      try {
        // Save detection
        statements.createDetection.run(
          detection.id,
          detection.cameraId,
          detection.plateNumber,
          detection.timestamp,
          detection.confidence,
          detection.imageUrl,
          detection.bbox,
          detection.class_name,
          detection.imageBase64
        );
        savedDetections.push(detection.id);
        
        // Check if plate is NOT visible/readable
        // 'NONE' = not visible, 'BLUR' = visible but blurry/unclear
        const plateNotVisible = (
          detection.plateNumber === 'NONE' || 
          detection.plateNumber === 'BLUR' ||
          detection.plateNumber === null || 
          detection.plateNumber === '' ||
          detection.plateVisible === false
        );
        const plateIsBlurry = detection.plateNumber === 'BLUR';
        
        // Check if it's a real vehicle (not 'none' class)
        const isRealVehicle = detection.class_name && detection.class_name.toLowerCase() !== 'none';
        
        // Case 1: Real vehicle with visible plate - check database and send Viber message
        if (isRealVehicle && !plateNotVisible) {
          try {
            // Check if vehicle exists in database
            const vehicle = db.prepare('SELECT * FROM vehicles WHERE plateNumber = ?').get(detection.plateNumber);
            
            // Add to detected vehicles list for response
            detectedVehicles.push({
              plateNumber: detection.plateNumber,
              ownerName: vehicle ? vehicle.ownerName : null,
              contactNumber: vehicle ? vehicle.contactNumber : null,
              registered: !!vehicle,
              vehicleType: detection.class_name
            });
            
            if (vehicle) {
              // Vehicle exists - create violation and send Viber message
              const violation = await createViolationFromDetection(
                detection.plateNumber,
                uploadLocationId,
                detection.id
              );
              if (violation) {
                violationsCreated.push(violation.id);
                // Check if Viber message was actually sent (from violation object)
                if (violation.messageSent) {
                  actualMessageSent = true;
                  console.log(`✅ Violation created and Viber message sent to owner for plate ${detection.plateNumber}`);
                } else {
                  console.log(`⚠️  Violation created but Viber message was not sent for plate ${detection.plateNumber}`);
                }
              }
            } else {
              // Vehicle not registered - create incident and notify barangay
              const incidentId = `INC-UPLOAD-${Date.now()}`;
              try {
                statements.createIncident.run(
                  incidentId,
                  detection.cameraId,
                  uploadLocationId,
                  detection.id,
                  detection.plateNumber,
                  detection.timestamp,
                  'Vehicle not registered in system',
                  detection.imageUrl,
                  detection.imageBase64,
                  'open'
                );
                incidentsCreated.push(incidentId);
                console.log(`📝 Incident logged: ${incidentId} - Vehicle not registered`);
              } catch (incidentError) {
                console.error(`Failed to create incident:`, incidentError);
              }
              
              // Notify barangay about unregistered vehicle
              const user = db.prepare('SELECT id FROM users LIMIT 1').get();
              const userId = user ? user.id : null;
              
              if (userId && shouldCreateNotification(userId, 'vehicle_detected')) {
                const notificationId = `NOTIF-UPLOAD-${Date.now()}`;
                const notificationTitle = 'Unregistered Vehicle Detected';
                const notificationMessage = `Vehicle with plate ${detection.plateNumber} detected at ${uploadLocationId} but is not registered in the system. Immediate Barangay attention required.`;
                
                try {
                  statements.createNotification.run(
                    notificationId,
                    'vehicle_detected',
                    notificationTitle,
                    notificationMessage,
                    detection.cameraId,
                    uploadLocationId,
                    incidentId,
                    detection.id,
                    detection.imageUrl,
                    detection.imageBase64,
                    detection.plateNumber,
                    detection.timestamp,
                    'Vehicle not registered in system',
                    new Date().toISOString(),
                    0 // not read
                  );
                  notificationsCreated.push(notificationId);
                  console.log(`🔔 Notification created: ${notificationId} - Unregistered vehicle`);
                } catch (notifError) {
                  console.error(`Failed to create notification:`, notifError);
                }
              }
            }
          } catch (violationError) {
            console.error(`Failed to process violation for detection ${detection.id}:`, violationError);
          }
        }
        
        // Case 2: Real vehicle with unreadable plate - create incident and notify barangay
        if (isRealVehicle && plateNotVisible) {
          // Determine plate status
          const plateStatus = plateIsBlurry ? 'BLUR' : 'NONE';
          const plateStatusText = plateIsBlurry 
            ? 'Unclear or Blur Plate Number Detected' 
            : 'Plate Not Visible';
          const plateReason = plateIsBlurry
            ? 'Plate area is visible but blurry/unclear/unreadable'
            : 'Plate not visible or absent';
          const plateMessage = plateIsBlurry
            ? `Vehicle detected at ${uploadLocationId}. License plate is visible but unclear or blurry - cannot be read. Immediate Barangay attention required.`
            : `Vehicle detected at ${uploadLocationId} but license plate is not visible or readable. Immediate Barangay attention required.`;
          
          // Add to detected vehicles list (plate not visible)
          detectedVehicles.push({
            plateNumber: plateStatus,
            ownerName: null,
            contactNumber: null,
            registered: false,
            vehicleType: detection.class_name
          });
          
          // Create incident record
          const incidentId = `INC-UPLOAD-${Date.now()}`;
          try {
            statements.createIncident.run(
              incidentId,
              detection.cameraId,
              uploadLocationId,
              detection.id,
              detection.plateNumber || plateStatus,
              detection.timestamp,
              plateReason,
              detection.imageUrl,
              detection.imageBase64,
              'open'
            );
            incidentsCreated.push(incidentId);
            console.log(`📝 Incident logged: ${incidentId} - ${plateStatusText}`);
          } catch (incidentError) {
            console.error(`Failed to create incident:`, incidentError);
          }
          
          // ALWAYS notify Barangay (no preference check)
          const user = db.prepare('SELECT id FROM users LIMIT 1').get();
          const userId = user ? user.id : null;
          
          if (userId) {
            // Create notification for Barangay
            const notificationId = `NOTIF-UPLOAD-${Date.now()}`;
            const notificationTitle = plateIsBlurry
              ? 'Illegally Parked Vehicle - Unclear/Blur Plate'
              : 'Unreadable License Plate Detected';
            
            try {
              statements.createNotification.run(
                notificationId,
                'plate_not_visible',
                notificationTitle,
                plateMessage,
                detection.cameraId,
                uploadLocationId,
                incidentId,
                detection.id,
                detection.imageUrl,
                detection.imageBase64,
                detection.plateNumber || plateStatus,
                detection.timestamp,
                plateReason,
                new Date().toISOString(),
                0 // not read
              );
              notificationsCreated.push(notificationId);
              console.log(`🔔 Notification ALWAYS sent to authorities: ${notificationId} - ${plateStatusText}`);
            } catch (notifError) {
              console.error(`Failed to create notification:`, notifError);
            }
          } else {
            console.error(`❌ No user found - cannot send notification to authorities`);
          }
        }
      } catch (dbError) {
        console.error(`Failed to save detection ${detection.id}:`, dbError);
      }
    }

    res.json({ 
      success: true, 
      message: 'Image analyzed successfully',
      imageUrl: imageUrl,
      detections: savedDetections,
      vehicleCount: detections.filter(d => d.class_name !== 'none').length,
      violationsCreated: violationsCreated.length,
      violations: violationsCreated,
      incidentsCreated: incidentsCreated.length,
      notificationsCreated: notificationsCreated.length,
      aiAnalysisError: aiAnalysisError || undefined,
      detectedVehicles: detectedVehicles, // Include detected vehicles with owner info
      results: {
        plateDetected: detections.some(d => d.plateNumber && d.plateNumber !== 'NONE'),
        vehicleDetected: detections.some(d => d.class_name && d.class_name.toLowerCase() !== 'none'),
        smsSent: actualMessageSent, // Viber message send status (kept as smsSent for frontend compatibility)
        barangayNotified: notificationsCreated.length > 0 || incidentsCreated.length > 0
      }
    });

  } catch (error) {
    console.error('Upload and analyze error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to analyze image',
      message: error.message || 'An unexpected error occurred while analyzing the image'
    });
  }
});

export default router;

