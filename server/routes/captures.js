import express from 'express';
import db from '../database.js';
import { fileURLToPath } from 'url';
import path from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { analyzeImageWithAI, processDetectionResults } from '../ai_detection_service.js';
import { createViolationFromDetection } from './violations.js';
import monitoringService from '../monitoring_service.js';
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
    getCamera: db.prepare('SELECT * FROM cameras WHERE id = ?'),
    updateLastCapture: db.prepare('UPDATE cameras SET lastCapture = ? WHERE id = ?'),
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
    getOnlineCameras: db.prepare('SELECT * FROM cameras WHERE status = ?'),
  };
}

router.post('/:cameraId', async (req, res) => {
  try {
    await ensureCapturedImagesDir();
    
    const statements = getStatements();
    const camera = statements.getCamera.get(req.params.cameraId);
    
    if (!camera) {
      return res.status(404).json({ error: 'Camera not found' });
    }

    if (camera.status !== 'online') {
      return res.status(400).json({ error: 'Camera is not online' });
    }

    // Update camera last capture time
    const now = new Date().toISOString();
    statements.updateLastCapture.run(now, req.params.cameraId);

    // Get image data from request body (base64)
    const { imageData } = req.body;
    let imageUrl = null;
    let imageBase64 = null;

    console.log(`📸 Capture triggered for camera ${req.params.cameraId}, imageData present: ${!!imageData}`);

    if (imageData) {
      try {
        // Extract base64 data (remove data:image/jpeg;base64, prefix if present)
        const base64Data = imageData.includes(',') 
          ? imageData.split(',')[1] 
          : imageData;
        
        // Convert base64 to buffer
        const imageBuffer = Buffer.from(base64Data, 'base64');
        
        // Generate filename
        const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
        const filename = `capture-${req.params.cameraId}-${timestamp}.jpg`;
        const filepath = path.join(CAPTURED_IMAGES_DIR, filename);
        
        // Save image to file
        await writeFile(filepath, imageBuffer);
        
        // Store filename in database (relative path)
        imageUrl = filename;
        
        // Store base64 in database for easy retrieval
        imageBase64 = imageData;
        
        console.log(`✅ Image saved: ${filename} (${Math.round(imageBuffer.length / 1024)}KB)`);
      } catch (imageError) {
        console.error('❌ Error saving image:', imageError);
        // Continue without image if saving fails
      }
    } else {
      console.warn('⚠️  No imageData provided in capture request - video may not be ready');
    }

    // Analyze image with AI (Gemini 2.5 Flash)
    let detections = [];
    let aiAnalysisError = null;
    let aiProcessingComplete = false;
    const aiProcessingStartTime = Date.now();
    
    // Check for recent detections at this location to improve consistency
    const locationId = camera ? camera.locationId : 'UNKNOWN';
    
    // Get recent detections from last 5 minutes to check for stationary vehicles
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const recentDetections = db.prepare(`
      SELECT * FROM detections 
      WHERE cameraId = ? 
      AND timestamp > ?
      AND class_name != 'none'
      ORDER BY timestamp DESC
      LIMIT 10
    `).all(req.params.cameraId, fiveMinutesAgo);
    
    const hasRecentVehicleDetections = recentDetections.length > 0;
    if (hasRecentVehicleDetections) {
      console.log(`📊 Found ${recentDetections.length} recent vehicle detection(s) at this location - expecting consistent results`);
      const recentPlates = [...new Set(recentDetections.map(d => d.plateNumber).filter(p => p && p !== 'NONE'))];
      if (recentPlates.length > 0) {
        console.log(`   Recent plates detected: ${recentPlates.join(', ')}`);
      }
    }
    
    if (imageBase64) {
      try {
        console.log('🤖 Starting AI analysis (Gemini 2.5 Flash)...');
        const aiResult = await analyzeImageWithAI(imageBase64);
        const aiProcessingTime = Date.now() - aiProcessingStartTime;
        aiProcessingComplete = true;
        
        if (aiResult.error) {
          console.warn(`⚠️  AI analysis error (${aiProcessingTime}ms):`, aiResult.error);
          aiAnalysisError = aiResult.error;
        } else {
          const vehicleCount = aiResult.vehicles?.length || 0;
          console.log(`✅ AI analysis complete (${aiProcessingTime}ms) - detected ${vehicleCount} vehicle(s)`);
          
          // Check for inconsistency
          if (hasRecentVehicleDetections && vehicleCount === 0) {
            console.warn(`⚠️  INCONSISTENCY DETECTED: Recent captures showed vehicles, but this capture shows 0 vehicles`);
            console.warn(`   This may indicate a detection issue - vehicle might still be present`);
          }
          
          if (vehicleCount > 0) {
            aiResult.vehicles.forEach((v, idx) => {
              console.log(`   Vehicle ${idx + 1}: ${v.class_name || 'unknown'} - Plate: ${v.plateNumber || 'NONE'} - Confidence: ${((v.confidence || 0) * 100).toFixed(1)}%`);
            });
          } else {
            console.warn(`⚠️  AI returned 0 vehicles (confidence threshold: ≥70%) - check if vehicles are actually present in the image`);
            console.warn(`   If a vehicle is clearly visible but not detected, the AI confidence may be below threshold`);
          }
        }
        
        // Process AI results into detection records
        detections = processDetectionResults(aiResult, req.params.cameraId, imageUrl, imageBase64);
        
      } catch (aiError) {
        const aiProcessingTime = Date.now() - aiProcessingStartTime;
        aiProcessingComplete = true;
        console.error(`❌ AI analysis failed (${aiProcessingTime}ms):`, aiError);
        aiAnalysisError = aiError.message;
        // Fallback: create placeholder detection
        const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
        const detectionId = `DET-${req.params.cameraId}-${timestamp}-0`;
        detections = [{
          id: detectionId,
          cameraId: req.params.cameraId,
          plateNumber: 'NONE',
          timestamp: new Date().toISOString(),
          confidence: 0.0,
          imageUrl,
          bbox: null,
          class_name: 'none',
          imageBase64
        }];
      }
    } else {
      aiProcessingComplete = true; // No image, so no AI processing needed
      // No image data - create placeholder detection
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
      const detectionId = `DET-${req.params.cameraId}-${timestamp}-0`;
      detections = [{
        id: detectionId,
        cameraId: req.params.cameraId,
        plateNumber: 'NONE',
        timestamp: new Date().toISOString(),
        confidence: 0.0,
        imageUrl: null,
        bbox: null,
        class_name: 'none',
        imageBase64: null
      }];
    }

    // Save all detections to database and check for plate visibility
    const savedDetections = [];
    const incidentsCreated = [];
    const notificationsCreated = [];
    const violationsCreated = [];
    
    // Track detected plates by location for real-time vehicle removal check
    const detectedPlatesByLocation = new Map();
    
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
        
        // Get camera location
        const camera = statements.getCamera.get(detection.cameraId);
        const locationId = camera ? camera.locationId : 'UNKNOWN';
        
        // Track detected plates for real-time removal check
        // Plate is not readable if it's 'NONE' (not visible) or 'BLUR' (blurry/unclear)
        const plateNotVisible = (
          detection.plateNumber === 'NONE' || 
          detection.plateNumber === 'BLUR' ||
          detection.plateNumber === null || 
          detection.plateNumber === '' ||
          detection.plateVisible === false
        );
        const plateIsBlurry = detection.plateNumber === 'BLUR';
        const isRealVehicle = detection.class_name && detection.class_name.toLowerCase() !== 'none';
        
        // Only track real vehicles with visible plates for removal detection
        if (isRealVehicle && !plateNotVisible && detection.plateNumber) {
          if (!detectedPlatesByLocation.has(locationId)) {
            detectedPlatesByLocation.set(locationId, []);
          }
          detectedPlatesByLocation.get(locationId).push(detection.plateNumber);
        }
        
        // Case 1: Real vehicle with visible plate - automatically create violation
        if (isRealVehicle && !plateNotVisible) {
          try {
            console.log(`📋 Creating violation for plate ${detection.plateNumber} at location ${locationId}...`);
            const violation = await createViolationFromDetection(
              detection.plateNumber,
              locationId,
              detection.id
            );
            if (violation) {
              violationsCreated.push(violation.id);
              console.log(`✅ Violation created: ${violation.id} for plate ${detection.plateNumber}`);
              
              // Check if Viber message was actually sent (from violation object)
              if (violation.messageSent) {
                console.log(`✅ Viber message sent successfully to owner for plate ${detection.plateNumber}`);
              } else {
                console.log(`⚠️  Violation created but Viber message was NOT sent for plate ${detection.plateNumber}`);
                console.log(`   Message Status: ${violation.messageSent ? 'sent' : 'not sent'}`);
                console.log(`   Message Log ID: ${violation.messageLogId || 'N/A'}`);
              }
              
              // ALWAYS notify authorities when a registered vehicle is detected
              const user = db.prepare('SELECT id FROM users LIMIT 1').get();
              const userId = user ? user.id : null;
              
              if (userId) {
                const notificationId = `NOTIF-${Date.now()}-${violation.id}`;
                const notificationTitle = 'Illegal Parking Violation Detected';
                const notificationMessage = `Vehicle with plate ${detection.plateNumber} detected illegally parked at ${locationId}. ${violation.messageSent ? 'Viber message sent to owner.' : 'Viber message could not be sent to owner.'} Barangay attention may be required.`;
                
                try {
                  statements.createNotification.run(
                    notificationId,
                    'vehicle_detected',
                    notificationTitle,
                    notificationMessage,
                    detection.cameraId,
                    locationId,
                    null, // incidentId
                    detection.id,
                    detection.imageUrl,
                    detection.imageBase64,
                    detection.plateNumber,
                    detection.timestamp,
                    'Illegal parking violation detected',
                    new Date().toISOString(),
                    0 // not read
                  );
                  notificationsCreated.push(notificationId);
                  console.log(`🔔 Notification ALWAYS sent to authorities: ${notificationId} - Vehicle ${detection.plateNumber} detected`);
                } catch (notifError) {
                  console.error(`Failed to create notification:`, notifError);
                }
              }
            } else {
              // Vehicle not registered - create violation anyway and notify barangay
              console.log(`⚠️  Vehicle ${detection.plateNumber} not registered - creating violation and notifying barangay`);
              
              // Check if violation already exists
              const existingViolation = db.prepare(`
                SELECT * FROM violations 
                WHERE plateNumber = ? 
                AND cameraLocationId = ?
                AND status IN ('warning', 'pending')
                ORDER BY timeDetected DESC
                LIMIT 1
              `).get(detection.plateNumber, locationId);
              
              let violationId;
              if (existingViolation) {
                violationId = existingViolation.id;
                console.log(`ℹ️  Active violation already exists: ${violationId}`);
              } else {
                // Create new violation for unregistered vehicle
                violationId = `VIOL-${detection.plateNumber}-${Date.now()}`;
                const timeDetected = new Date().toISOString();
                const expiresDate = new Date();
                expiresDate.setMinutes(expiresDate.getMinutes() + 30); // 30 minutes grace period
                
                db.prepare(`
                  INSERT INTO violations (id, plateNumber, cameraLocationId, timeDetected, status, warningExpiresAt)
                  VALUES (?, ?, ?, ?, ?, ?)
                `).run(
                  violationId,
                  detection.plateNumber,
                  locationId,
                  timeDetected,
                  'warning',
                  expiresDate.toISOString()
                );
                violationsCreated.push(violationId);
                console.log(`✅ Violation created for unregistered vehicle: ${violationId}`);
              }
              
              // Create incident for unregistered vehicle
              const incidentId = `INC-${detection.cameraId}-${Date.now()}`;
              try {
                statements.createIncident.run(
                  incidentId,
                  detection.cameraId,
                  locationId,
                  detection.id,
                  detection.plateNumber,
                  detection.timestamp,
                  'Vehicle not registered in system',
                  detection.imageUrl,
                  detection.imageBase64,
                  'open'
                );
                incidentsCreated.push(incidentId);
                console.log(`📝 Incident logged: ${incidentId} - Unregistered vehicle`);
              } catch (incidentError) {
                console.error(`Failed to create incident:`, incidentError);
              }
              
              // ALWAYS notify barangay about unregistered vehicle (no preference check)
              const user = db.prepare('SELECT id FROM users LIMIT 1').get();
              const userId = user ? user.id : null;
              
              if (userId) {
                const notificationId = `NOTIF-${Date.now()}-${violationId}`;
                const notificationTitle = 'Unregistered Vehicle Detected';
                const notificationMessage = `Vehicle with plate ${detection.plateNumber} detected illegally parked at ${locationId}. Vehicle is not registered in the system. Immediate Barangay attention required.`;
                
                try {
                  statements.createNotification.run(
                    notificationId,
                    'vehicle_detected',
                    notificationTitle,
                    notificationMessage,
                    detection.cameraId,
                    locationId,
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
                  console.log(`🔔 Notification ALWAYS sent to authorities: ${notificationId} - Unregistered vehicle ${detection.plateNumber} detected`);
                } catch (notifError) {
                  console.error(`Failed to create notification:`, notifError);
                }
              } else {
                console.error(`❌ No user found - cannot send notification to authorities`);
              }
            }
          } catch (violationError) {
            console.error(`Failed to create automatic violation for detection ${detection.id}:`, violationError);
            
            // Even if violation creation fails, ALWAYS notify authorities
            const user = db.prepare('SELECT id FROM users LIMIT 1').get();
            const userId = user ? user.id : null;
            
            if (userId) {
              const notificationId = `NOTIF-${Date.now()}-ERROR-${detection.id}`;
              const notificationTitle = 'Vehicle Detected - Processing Error';
              const notificationMessage = `Vehicle with plate ${detection.plateNumber || 'UNKNOWN'} detected illegally parked at ${locationId}, but violation creation failed. Immediate Barangay attention required. Error: ${violationError.message}`;
              
              try {
                statements.createNotification.run(
                  notificationId,
                  'vehicle_detected',
                  notificationTitle,
                  notificationMessage,
                  detection.cameraId,
                  locationId,
                  null,
                  detection.id,
                  detection.imageUrl,
                  detection.imageBase64,
                  detection.plateNumber || 'NONE',
                  detection.timestamp,
                  'Error creating violation - manual review required',
                  new Date().toISOString(),
                  0 // not read
                );
                notificationsCreated.push(notificationId);
                console.log(`🔔 Notification ALWAYS sent to authorities (error case): ${notificationId}`);
              } catch (notifError) {
                console.error(`Failed to create notification after error:`, notifError);
              }
            }
          }
        }
        
        // Case 2: Real vehicle with unreadable plate - create violation, incident and notification
        if (isRealVehicle && plateNotVisible) {
          // Determine plate status message
          const plateStatus = plateIsBlurry ? 'BLUR' : 'NONE';
          const plateStatusText = plateIsBlurry 
            ? 'Unclear or Blur Plate Number Detected' 
            : 'Plate Not Visible';
          const plateReason = plateIsBlurry
            ? 'Plate area is visible but blurry/unclear/unreadable'
            : 'Plate not visible or absent';
          const plateMessage = plateIsBlurry
            ? `Vehicle illegally parked at location ${locationId}. License plate is visible but unclear or blurry - cannot be read. Immediate Barangay attention required at ${locationId}.`
            : `Vehicle illegally parked at location ${locationId}. License plate is not visible or readable. Immediate Barangay attention required at ${locationId}.`;
          
          // Create violation so it appears in Warnings section
          const violationId = `VIOL-UNREADABLE-${detection.cameraId}-${Date.now()}`;
          const timeDetected = new Date().toISOString();
          const expiresDate = new Date();
          expiresDate.setMinutes(expiresDate.getMinutes() + 30); // 30 minutes grace period
          
          try {
            // Check if violation already exists for this location with same plate status
            const existingViolation = db.prepare(`
              SELECT * FROM violations 
              WHERE cameraLocationId = ? 
              AND plateNumber = ?
              AND status IN ('warning', 'pending')
              ORDER BY timeDetected DESC
              LIMIT 1
            `).get(locationId, plateStatus);
            
            let finalViolationId = violationId;
            if (existingViolation) {
              finalViolationId = existingViolation.id;
              console.log(`ℹ️  Active violation already exists for ${plateStatusText.toLowerCase()} plate at ${locationId}: ${finalViolationId}`);
            } else {
              // Create new violation for unreadable plate
              db.prepare(`
                INSERT INTO violations (id, plateNumber, cameraLocationId, timeDetected, status, warningExpiresAt)
                VALUES (?, ?, ?, ?, ?, ?)
              `).run(
                finalViolationId,
                plateStatus, // 'BLUR' or 'NONE'
                locationId,
                timeDetected,
                'warning',
                expiresDate.toISOString()
              );
              violationsCreated.push(finalViolationId);
              console.log(`✅ Violation created for ${plateStatusText.toLowerCase()} plate at ${locationId}: ${finalViolationId}`);
            }
          } catch (violationError) {
            console.error(`Failed to create violation for unreadable plate:`, violationError);
          }
          
          // Create incident record
          const incidentId = `INC-${detection.cameraId}-${Date.now()}`;
          try {
            statements.createIncident.run(
              incidentId,
              detection.cameraId,
              locationId,
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
          
          // ALWAYS notify Barangay about unreadable plates (no preference check)
          const user = db.prepare('SELECT id FROM users LIMIT 1').get();
          const userId = user ? user.id : null;
          
          if (userId) {
            // Create notification for Barangay with location ID clearly stated
            const notificationId = `NOTIF-${Date.now()}`;
            const notificationTitle = plateIsBlurry 
              ? 'Illegally Parked Vehicle - Unclear/Blur Plate'
              : 'Illegally Parked Vehicle - Unreadable Plate';
            
            try {
              statements.createNotification.run(
                notificationId,
                'plate_not_visible',
                notificationTitle,
                plateMessage,
                detection.cameraId,
                locationId,
                incidentId,
                detection.id,
                detection.imageUrl,
                detection.imageBase64,
                detection.plateNumber || plateStatus,
                detection.timestamp,
                `Illegally parked at ${locationId} - ${plateReason}`,
                new Date().toISOString(),
                0 // not read
              );
              notificationsCreated.push(notificationId);
              console.log(`🔔 Notification ALWAYS sent to authorities: ${notificationId} - ${plateStatusText} detected at ${locationId}`);
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

    // Real-time vehicle removal detection - check immediately after saving detections
    let resolvedCount = 0;
    
    // Get camera location for this capture (camera already retrieved at line 55)
    const cameraLocationId = camera ? camera.locationId : null;
    
    if (cameraLocationId) {
      // If we have detected plates for this location, check for removals
      if (detectedPlatesByLocation.has(cameraLocationId)) {
        const detectedPlates = detectedPlatesByLocation.get(cameraLocationId);
        const resolved = monitoringService.checkVehicleRemovalRealTime(cameraLocationId, detectedPlates);
        resolvedCount += resolved;
      } else {
        // No vehicles detected at this location - check if any active warnings should be resolved
        // This handles the case where a capture shows no vehicles (empty parking zone)
        const resolved = monitoringService.checkVehicleRemovalRealTime(cameraLocationId, []);
        resolvedCount += resolved;
      }
    }

    // Ensure all processing is complete before sending response
    const totalProcessingTime = Date.now() - aiProcessingStartTime;
    console.log(`✅ Capture processing complete (${totalProcessingTime}ms) - AI: ${aiProcessingComplete ? 'Done' : 'Skipped'}, Vehicles: ${detections.filter(d => d.class_name !== 'none').length}, Violations: ${violationsCreated.length}`);
    
    res.json({ 
      success: true, 
      message: 'Capture triggered successfully',
      imageUrl: imageUrl,
      detections: savedDetections,
      vehicleCount: detections.filter(d => d.class_name !== 'none').length,
      violationsCreated: violationsCreated.length,
      violations: violationsCreated,
      violationsResolved: resolvedCount,
      incidentsCreated: incidentsCreated.length,
      notificationsCreated: notificationsCreated.length,
      aiProcessingComplete: aiProcessingComplete,
      aiAnalysisError: aiAnalysisError || undefined,
      processingTime: totalProcessingTime
    });

  } catch (error) {
    console.error('Capture error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST trigger capture for all online cameras
router.post('/', async (req, res) => {
  try {
    const statements = getStatements();
    const cameras = statements.getOnlineCameras.all('online');
    const now = new Date().toISOString();

    for (const camera of cameras) {
      // Update camera last capture time
      statements.updateLastCapture.run(now, camera.id);

      // Create a placeholder detection record
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
      const detectionId = `DET-${camera.id}-${timestamp}-0`;
      
      statements.createDetection.run(
        detectionId,
        camera.id,
        'NONE',
        new Date().toISOString(),
        0.0,
        null,
        null,
        'none',
        null // No base64 for batch captures without image data
      );
    }

    res.json({ 
      success: true, 
      message: 'Capture cycle triggered successfully',
      camerasProcessed: cameras.length
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

