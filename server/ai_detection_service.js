import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs-extra';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { getPythonExecutable } from './python_executable.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const AI_SERVICE_PATH = join(__dirname, 'ai_service.py');
const VIDEO_ANALYSIS_SERVICE_PATH = join(__dirname, 'video_analysis_service.py');
const YOLO_DETECTION_SERVICE_PATH = join(__dirname, 'yolo_detection_service.py');

/**
 * Call Python AI service to analyze an image
 * @param {string} imageBase64 - Base64 encoded image data
 * @param {string} imagePath - Optional file path to image (alternative to base64)
 * @returns {Promise<Object>} Detection results with vehicles array
 */
export async function analyzeImageWithAI(imageBase64 = null, imagePath = null) {
  console.log('🤖 AI detection disabled - using OCR only');
  return {
    vehicles: [],
    error: 'AI detection disabled - using OCR only',
    timestamp: new Date().toISOString()
  };
}

    // Check if Python service exists
    if (!fs.existsSync(AI_SERVICE_PATH)) {
      console.warn('⚠️  AI service not found, returning placeholder detection');
      return resolve({
        vehicles: [],
        error: 'AI service not available',
        timestamp: new Date().toISOString()
      });
    }

    let tempBase64File = null;
    const args = [];
    const AI_PROCESS_TIMEOUT = 90000; // 90 seconds timeout for AI analysis
    let timeoutId = null;
    let processCompleted = false;

    const cleanup = async () => {
      if (tempBase64File) {
        try {
          await fs.remove(tempBase64File);
        } catch (cleanupError) {
          console.warn('Failed to cleanup temp file:', cleanupError);
        }
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };

    try {
      if (imageBase64) {
        // Write base64 to temporary file to avoid ENAMETOOLONG error on Windows
        // Windows has a command-line argument length limit (~8KB), and base64 images can be much larger
        tempBase64File = join(tmpdir(), `ai-base64-${randomUUID()}.txt`);
        await fs.writeFile(tempBase64File, imageBase64, 'utf8');
        args.push('--base64-file', tempBase64File);
      } else if (imagePath) {
        args.push('--image', imagePath);
      }
    } catch (fileError) {
      console.error('Error creating temp file for base64:', fileError);
      return resolve({
        vehicles: [],
        error: `Failed to prepare image data: ${fileError.message}`,
        timestamp: new Date().toISOString()
      });
    }

    const pythonCmd = getPythonExecutable();

    // Verify Python version before running
    await new Promise((resolve) => {
      const versionCheck = spawn(pythonCmd, ['--version'], { timeout: 5000 });
      let versionOutput = '';
      versionCheck.stdout.on('data', (data) => {
        versionOutput += data.toString();
      });
      versionCheck.on('close', (code) => {
        if (code === 0) {
          console.log(`🤖 Using Python: ${versionOutput.trim()}`);
        } else {
          console.warn(`⚠️  Could not verify Python version. Using: ${pythonCmd}`);
        }
        resolve();
      });
      versionCheck.on('error', () => {
        console.warn(`⚠️  Could not verify Python version. Using: ${pythonCmd}`);
        resolve();
      });
      setTimeout(() => {
        versionCheck.kill();
        resolve();
      }, 5000);
    });
    
    console.log(`🤖 Starting AI analysis with ${pythonCmd}...`);

    // Spawn Python process
    const pythonProcess = spawn(pythonCmd, [AI_SERVICE_PATH, ...args], {
      cwd: __dirname,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1' // Ensure real-time output
      }
    });

    let stdout = '';
    let stderr = '';

    // Set timeout for the process
    timeoutId = setTimeout(async () => {
      if (!processCompleted) {
        processCompleted = true;
        console.error('⏱️  AI analysis timeout after 90 seconds');
        
        // Kill the process
        try {
          pythonProcess.kill('SIGTERM');
          // Force kill after 5 seconds if still running
          setTimeout(() => {
            if (!pythonProcess.killed) {
              pythonProcess.kill('SIGKILL');
            }
          }, 5000);
        } catch (killError) {
          console.error('Error killing Python process:', killError);
        }
        
        await cleanup();
        resolve({
          vehicles: [],
          error: 'AI analysis timed out after 90 seconds. The image may be too large or the API is slow.',
          timestamp: new Date().toISOString()
        });
      }
    }, AI_PROCESS_TIMEOUT);

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log('📝 AI stdout:', data.toString().substring(0, 100)); // Log first 100 chars
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error('⚠️  AI stderr:', data.toString().substring(0, 200)); // Log first 200 chars
    });

    pythonProcess.on('close', async (code) => {
      if (processCompleted) return; // Already handled by timeout
      processCompleted = true;
      
      await cleanup();

      if (code !== 0) {
        console.error(`❌ AI Service Error (exit code ${code}):`, stderr);
        
        // Provide helpful error message for missing packages
        let errorMessage = stderr.substring(0, 500);
        if (stderr.includes('Missing required package') || stderr.includes('ImportError')) {
          const pythonPath = stderr.match(/Python Executable: (.+)/)?.[1] || pythonCmd;
          errorMessage = `Missing Python packages. The packages need to be installed in the Python environment that Node.js is using.

Current Python: ${pythonCmd}
${stderr.includes('Python Executable:') ? '' : `\nTo fix this, run:\n  ${pythonPath} -m pip install google-generativeai pillow\n\nOr if you have multiple Python installations, make sure the packages are installed in the Python that Node.js is calling.`}

Full error: ${stderr.substring(0, 300)}`;
        }
        
        // Return empty result instead of rejecting (graceful degradation)
        return resolve({
          vehicles: [],
          error: errorMessage,
          timestamp: new Date().toISOString()
        });
      }

      try {
        if (!stdout || stdout.trim() === '') {
          throw new Error('Empty response from AI service');
        }
        const result = JSON.parse(stdout);
        console.log('✅ AI analysis completed successfully');
        resolve(result);
      } catch (parseError) {
        console.error('❌ Failed to parse AI service output:', parseError);
        console.error('Output was:', stdout.substring(0, 500));
        resolve({
          vehicles: [],
          error: `Failed to parse AI service response: ${parseError.message}`,
          timestamp: new Date().toISOString()
        });
      }
    });

    pythonProcess.on('error', async (error) => {
      if (processCompleted) return; // Already handled
      processCompleted = true;
      
      await cleanup();

      console.error('❌ Failed to spawn Python process:', error);
      // Check if Python is installed
      if (error.code === 'ENOENT') {
        console.warn('⚠️  Python3 not found. Install Python 3.9+ to enable AI detection.');
      }
      resolve({
        vehicles: [],
        error: `Python process error: ${error.message}`,
        timestamp: new Date().toISOString()
      });
    });
  });
}

/**
 * Plate recognition via PlateRecognizer Snapshot Cloud (no local OCR/Gemini).
 * @param {string} imageBase64 - Base64 encoded image data (raw or data URL)
 * @returns {Promise<{ plates: Array<{ plateNumber: string, confidence: number, bbox: number[] }>, error: string | null }>}
 */
export async function runOCROnly(imageBase64) {
  console.log('🤖 OCR detection disabled - no plates detected');
  return { plates: [], error: 'OCR detection disabled' };
}

  const token = process.env.PLATERECOGNIZER_TOKEN || process.env.PLATE_RECOGNIZER_TOKEN;
  const endpoint =
    process.env.PLATERECOGNIZER_ENDPOINT ||
    'https://api.platerecognizer.com/v1/plate-reader/';

  if (!token) {
    console.warn('[PlateRecognizer] Missing PLATERECOGNIZER_TOKEN/PLATE_RECOGNIZER_TOKEN');
    return { plates: [], error: 'PlateRecognizer token not configured' };
  }

  try {
    const raw = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
    const buffer = Buffer.from(raw, 'base64');

    const blob = new Blob([buffer], { type: 'image/jpeg' });
    const formData = new FormData();
    formData.append('upload', blob, 'frame.jpg');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Token ${token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text();
      console.warn('[PlateRecognizer] Non-200 response:', response.status, text.slice(0, 300));
      return {
        plates: [],
        error: `PlateRecognizer error ${response.status}`,
      };
    }

    const payload = await response.json();
    const results = Array.isArray(payload.results) ? payload.results : [];

    const plates = results
      .map((r) => {
        const plate = (r.plate || '').toString().toUpperCase();
        const score = Number(r.score || 0);
        const box = r.box || {};
        const x1 = Number(box.x1 || 0);
        const y1 = Number(box.y1 || 0);
        const x2 = Number(box.x2 || 0);
        const y2 = Number(box.y2 || 0);
        if (!plate) return null;
        return {
          plateNumber: plate,
          confidence: Number.isFinite(score) ? score : 0,
          // Absolute pixel bbox from PlateRecognizer, forwarded as-is.
          bbox: [x1, y1, x2, y2],
          class_name: 'plate',
        };
      })
      .filter(Boolean);

    if (plates.length > 0) {
      console.log('[PlateRecognizer] Plates:', plates.map((p) => p.plateNumber).join(', '));
    } else {
      console.log('[PlateRecognizer] No plates detected.');
    }

    return { plates, error: null };
  } catch (err) {
    console.error('[PlateRecognizer] Request failed:', err);
    return {
      plates: [],
      error: err && err.message ? err.message : 'PlateRecognizer request failed',
    };
  }
}

/**
 * Run YOLO vehicle detection (yolov8n.pt only). Plate extraction is done via Gemini
 * in the detection_worker when vehicles are detected.
 * @param {string} imageBase64 - Base64 encoded image data (raw or data URL)
 * @returns {Promise<{ vehicles: Array, plates: Array }>}
 */
export async function runYoloDetection(imageBase64) {
  console.log('🤖 YOLO detection disabled - no vehicles detected');
  return { vehicles: [], plates: [], error: 'YOLO detection disabled' };
}

export async function analyzeVideoStream(videoStreamUrl, cameraConfig) {
  console.log('📹 Video analysis disabled - no detections');
  return {
    detections: [],
    error: 'Video analysis disabled',
    timestamp: new Date().toISOString()
  };
}

/**
 * Process detection results and create detection records
 * @param {Object} aiResult - Result from AI service
 * @param {string} cameraId - Camera ID
 * @param {string} imageUrl - Image filename
 * @param {string} imageBase64 - Base64 image data
 * @returns {Array} Array of detection objects ready for database
 */
export function processDetectionResults(aiResult, cameraId, imageUrl, imageBase64) {
  const detections = [];
  const timestamp = new Date().toISOString();
  const timestampId = timestamp.replace(/[-:]/g, '').split('.')[0];

  if (!aiResult.vehicles || aiResult.vehicles.length === 0) {
    // No vehicles detected - create a single "none" detection
    const detectionId = `DET-${cameraId}-${timestampId}-0`;
    detections.push({
      id: detectionId,
      cameraId,
      plateNumber: 'NONE',
      timestamp,
      confidence: 0.0,
      imageUrl,
      bbox: null,
      class_name: 'none',
      imageBase64
    });
    return detections;
  }

  // Process each detected vehicle
  aiResult.vehicles.forEach((vehicle, index) => {
    const detectionId = `DET-${cameraId}-${timestampId}-${index}`;
    let plateNumber = vehicle.plateNumber || 'NONE';
    
    // Normalize plate number: handle "BLUR" for visible but unreadable plates
    if (plateNumber.toUpperCase() === 'BLUR' || plateNumber.toUpperCase() === 'UNCLEAR') {
      plateNumber = 'BLUR';
    }
    
    // Determine plate visibility:
    // - 'NONE' = plate area not visible at all
    // - 'BLUR' = plate area visible but blurry/unclear/unreadable
    // - valid plate = plate is readable
    const plateVisible = plateNumber !== 'NONE' && 
                        plateNumber !== 'BLUR' &&
                        plateNumber !== null && 
                        plateNumber !== '' &&
                        (vehicle.plateVisible !== false);
    
    detections.push({
      id: detectionId,
      cameraId,
      plateNumber,
      timestamp,
      confidence: vehicle.confidence || 0.0,
      imageUrl,
      bbox: vehicle.bbox ? JSON.stringify(vehicle.bbox) : null,
      class_name: vehicle.class_name || 'vehicle',
      imageBase64,
      plateVisible
    });
  });

  return detections;
}

export function processVideoDetectionResults(videoResult, cameraId) {
  const detections = [];
  const timestamp = new Date().toISOString();
  const timestampId = timestamp.replace(/[-:]/g, '').split('.')[0];

  if (!videoResult.detections || videoResult.detections.length === 0) {
    return detections;
  }

  videoResult.detections.forEach((detection, index) => {
    const detectionId = `DET-${cameraId}-${timestampId}-${index}`;
    detections.push({
      id: detectionId,
      cameraId,
      plateNumber: detection.plateNumber,
      timestamp,
      confidence: detection.confidence,
      imageUrl: detection.imageUrl,
      bbox: detection.bbox ? JSON.stringify(detection.bbox) : null,
      class_name: detection.class_name,
      imageBase64: null, // No base64 from video service
      plateVisible: detection.plateVisible
    });
  });

  return detections;
}

