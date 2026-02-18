import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs-extra';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const AI_SERVICE_PATH = join(__dirname, 'ai_service.py');
const VIDEO_ANALYSIS_SERVICE_PATH = join(__dirname, 'video_analysis_service.py');
const OCR_ONLY_PATH = join(__dirname, 'ocr_only.py');
const YOLO_DETECTION_SERVICE_PATH = join(__dirname, 'yolo_detection_service.py');

/**
 * Call Python AI service to analyze an image
 * @param {string} imageBase64 - Base64 encoded image data
 * @param {string} imagePath - Optional file path to image (alternative to base64)
 * @returns {Promise<Object>} Detection results with vehicles array
 */
export async function analyzeImageWithAI(imageBase64 = null, imagePath = null) {
  return new Promise(async (resolve, reject) => {
    if (!imageBase64 && !imagePath) {
      return reject(new Error('Either imageBase64 or imagePath must be provided'));
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

    // Try python3 first, fallback to python
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    
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
        // Use environment variable if set, otherwise use fallback (matches Python service)
        GEMINI_API_KEY: process.env.GEMINI_API_KEY,
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
 * Run OCR-only plate recognition (EasyOCR + Tesseract). No Gemini - for 24/7 live dashboard.
 * @param {string} imageBase64 - Base64 encoded image data (raw or data URL)
 * @returns {Promise<{ plates: Array<{ plateNumber: string, confidence: number, bbox: number[] }> }>}
 */
export async function runOCROnly(imageBase64) {
  return new Promise(async (resolve) => {
    if (!imageBase64) {
      return resolve({ plates: [], error: 'imageBase64 required' });
    }

    if (!fs.existsSync(OCR_ONLY_PATH)) {
      console.warn('⚠️  ocr_only.py not found, returning empty plates');
      return resolve({ plates: [], error: 'OCR service not available' });
    }

    const raw = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
    let tempBase64File = null;
    const OCR_TIMEOUT_MS = 30000;
    let timeoutId = null;
    let processCompleted = false;

    const cleanup = async () => {
      if (tempBase64File) {
        try { await fs.remove(tempBase64File); } catch (e) { /* ignore */ }
      }
      if (timeoutId) clearTimeout(timeoutId);
    };

    try {
      tempBase64File = join(tmpdir(), `ocr-base64-${randomUUID()}.txt`);
      await fs.writeFile(tempBase64File, raw, 'utf8');
    } catch (e) {
      return resolve({ plates: [], error: e.message });
    }

    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const pythonProcess = spawn(pythonCmd, [OCR_ONLY_PATH, '--base64-file', tempBase64File], {
      cwd: __dirname,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    let stdout = '';
    let stderr = '';

    timeoutId = setTimeout(async () => {
      if (!processCompleted) {
        processCompleted = true;
        try { pythonProcess.kill('SIGTERM'); } catch (_) {}
        await cleanup();
        resolve({ plates: [], error: 'OCR timeout' });
      }
    }, OCR_TIMEOUT_MS);

    pythonProcess.stdout.on('data', (data) => { stdout += data.toString(); });
    pythonProcess.stderr.on('data', (data) => { stderr += data.toString(); });

    pythonProcess.on('close', async (code) => {
      if (processCompleted) return;
      processCompleted = true;
      await cleanup();

      try {
        const out = stdout.trim();
        if (!out) {
          console.warn('[OCR] Empty stdout from ocr_only.py', stderr.slice(0, 200));
          return resolve({ plates: [], error: stderr.slice(0, 200) || 'Empty OCR output' });
        }
        const result = JSON.parse(out);
        const plates = Array.isArray(result.plates) ? result.plates : [];
        if (plates.length === 0 && (stderr || result.error)) {
          console.warn('[OCR] No plates. stderr:', stderr.slice(0, 500), 'result.error:', result.error);
        }
        resolve({
          plates,
          error: result.error || null,
        });
      } catch (e) {
        console.warn('[OCR] Parse error:', e.message, 'stdout preview:', stdout.slice(0, 300));
        resolve({ plates: [], error: e.message });
      }
    });

    pythonProcess.on('error', async (err) => {
      if (!processCompleted) {
        processCompleted = true;
        await cleanup();
        resolve({ plates: [], error: err.message });
      }
    });
  });
}

/**
 * Run YOLO vehicle + license plate detection (yolov8n.pt + license_detection.pt).
 * Plate OCR results are logged to stderr by the Python service.
 * @param {string} imageBase64 - Base64 encoded image data (raw or data URL)
 * @returns {Promise<{ vehicles: Array, plates: Array }>}
 */
export async function runYoloDetection(imageBase64) {
  return new Promise(async (resolve) => {
    if (!imageBase64) {
      return resolve({ vehicles: [], plates: [], error: 'imageBase64 required' });
    }

    if (!fs.existsSync(YOLO_DETECTION_SERVICE_PATH)) {
      console.warn('⚠️  yolo_detection_service.py not found, returning empty detections');
      return resolve({ vehicles: [], plates: [], error: 'YOLO detection service not available' });
    }

    const raw = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
    let tempBase64File = null;
    const YOLO_TIMEOUT_MS = 15000;
    let timeoutId = null;
    let processCompleted = false;

    const cleanup = async () => {
      if (tempBase64File) {
        try { await fs.remove(tempBase64File); } catch (e) { /* ignore */ }
      }
      if (timeoutId) clearTimeout(timeoutId);
    };

    try {
      tempBase64File = join(tmpdir(), `yolo-base64-${randomUUID()}.txt`);
      await fs.writeFile(tempBase64File, raw, 'utf8');
    } catch (e) {
      return resolve({ vehicles: [], plates: [], error: e.message });
    }

    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const pythonProcess = spawn(pythonCmd, [YOLO_DETECTION_SERVICE_PATH, '--base64-file', tempBase64File], {
      cwd: __dirname,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    let stdout = '';
    let stderr = '';

    timeoutId = setTimeout(async () => {
      if (!processCompleted) {
        processCompleted = true;
        try { pythonProcess.kill('SIGTERM'); } catch (_) {}
        await cleanup();
        resolve({ vehicles: [], plates: [], error: 'YOLO detection timeout' });
      }
    }, YOLO_TIMEOUT_MS);

    pythonProcess.stdout.on('data', (data) => { stdout += data.toString(); });
    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      // Forward stderr to console so plate logs appear in server output
      const str = data.toString().trim();
      if (str) console.log(str);
    });

    pythonProcess.on('close', async (code) => {
      if (processCompleted) return;
      processCompleted = true;
      await cleanup();

      try {
        const out = stdout.trim();
        if (!out) {
          console.warn('[YOLO] Empty stdout from yolo_detection_service.py', stderr.slice(0, 200));
          return resolve({
            vehicles: [],
            plates: [],
            error: stderr.slice(0, 200) || 'Empty YOLO output',
          });
        }
        const result = JSON.parse(out);
        resolve({
          vehicles: Array.isArray(result.vehicles) ? result.vehicles : [],
          plates: Array.isArray(result.plates) ? result.plates : [],
          error: result.error || null,
        });
      } catch (e) {
        console.warn('[YOLO] Parse error:', e.message, 'stdout preview:', stdout.slice(0, 300));
        resolve({ vehicles: [], plates: [], error: e.message });
      }
    });

    pythonProcess.on('error', async (err) => {
      if (!processCompleted) {
        processCompleted = true;
        await cleanup();
        resolve({ vehicles: [], plates: [], error: err.message });
      }
    });
  });
}

export async function analyzeVideoStream(videoStreamUrl, cameraConfig) {
  return new Promise(async (resolve, reject) => {
    // Check if Python service exists
    if (!fs.existsSync(VIDEO_ANALYSIS_SERVICE_PATH)) {
      console.warn('⚠️  Video analysis service not found, skipping');
      return resolve({
        detections: [],
        error: 'Video analysis service not available',
        timestamp: new Date().toISOString()
      });
    }

    const args = ['--stream-url', videoStreamUrl, '--config', JSON.stringify(cameraConfig)];
    const AI_PROCESS_TIMEOUT = 300000; // 5 minutes timeout for video analysis
    let timeoutId = null;
    let processCompleted = false;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };

    // Try python3 first, fallback to python
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    
    console.log(`📹 Starting video analysis with ${pythonCmd}...`);
    
    // Spawn Python process
    const pythonProcess = spawn(pythonCmd, [VIDEO_ANALYSIS_SERVICE_PATH, ...args], {
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
        console.error('⏱️  Video analysis timeout after 5 minutes');
        
        try {
          pythonProcess.kill('SIGTERM');
          setTimeout(() => {
            if (!pythonProcess.killed) {
              pythonProcess.kill('SIGKILL');
            }
          }, 5000);
        } catch (killError) {
          console.error('Error killing Python process:', killError);
        }
        
        cleanup();
        resolve({
          detections: [],
          error: 'Video analysis timed out after 5 minutes.',
          timestamp: new Date().toISOString()
        });
      }
    }, AI_PROCESS_TIMEOUT);

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log('📹 Video Analysis stdout:', data.toString().substring(0, 100));
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error('⚠️  Video Analysis stderr:', data.toString().substring(0, 200));
    });

    pythonProcess.on('close', async (code) => {
      if (processCompleted) return;
      processCompleted = true;
      
      cleanup();

      if (code !== 0) {
        console.error(`❌ Video Analysis Error (exit code ${code}):`, stderr);
        return resolve({
          detections: [],
          error: stderr.substring(0, 500),
          timestamp: new Date().toISOString()
        });
      }

      try {
        if (!stdout || stdout.trim() === '') {
          throw new Error('Empty response from video analysis service');
        }
        const result = JSON.parse(stdout);
        console.log('✅ Video analysis completed successfully');
        resolve(result);
      } catch (parseError) {
        console.error('❌ Failed to parse video analysis service output:', parseError);
        console.error('Output was:', stdout.substring(0, 500));
        resolve({
          detections: [],
          error: `Failed to parse video analysis service response: ${parseError.message}`,
          timestamp: new Date().toISOString()
        });
      }
    });

    pythonProcess.on('error', async (error) => {
      if (processCompleted) return;
      processCompleted = true;
      
      cleanup();

      console.error('❌ Failed to spawn Python process for video analysis:', error);
      if (error.code === 'ENOENT') {
        console.warn('⚠️  Python3 not found. Install Python 3.9+ to enable video analysis.');
      }
      resolve({
        detections: [],
        error: `Python process error: ${error.message}`,
        timestamp: new Date().toISOString()
      });
    });
  });
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

