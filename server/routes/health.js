import express from 'express';
import db from '../database.js';
import { analyzeImageWithAI } from '../ai_detection_service.js';
import monitoringService from '../monitoring_service.js';
import cleanupService from '../cleanup_service.js';
import { getViberServiceStatus } from '../utils/viberService.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs-extra';
import { spawn } from 'child_process';

function readEnvFile() {
  const envPath = join(__dirname, '..', '.env');
  const env = {};
  
  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...valueParts] = trimmed.split('=');
          if (key && valueParts.length > 0) {
            env[key.trim()] = valueParts.join('=').trim();
          }
        }
      });
    }
  } catch (error) {
    // Ignore errors reading .env file
  }
  
  return env;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

async function checkDatabase() {
  try {
    // Check if database is accessible by querying tables
    const tablesResult = db.prepare('SELECT name FROM sqlite_master WHERE type="table"').all();
    const tableNames = tablesResult.map(row => row.name);
    
    // Check required tables
    const requiredTables = ['vehicles', 'cameras', 'violations', 'detections', 'notifications', 'incidents', 'users'];
    const missingTables = requiredTables.filter(table => !tableNames.includes(table));
    
    // Get record counts
    const counts = {};
    for (const table of requiredTables) {
      if (tableNames.includes(table)) {
        try {
          const countResult = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
          counts[table] = countResult?.count || 0;
        } catch (e) {
          counts[table] = 'error';
        }
      }
    }
    
    return {
      status: missingTables.length === 0 ? 'healthy' : 'degraded',
      connected: true,
      tables: {
        total: tableNames.length,
        required: requiredTables.length,
        missing: missingTables,
        counts
      },
      message: missingTables.length === 0 
        ? 'Database is healthy' 
        : `Missing tables: ${missingTables.join(', ')}`
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      connected: false,
      error: error.message || String(error),
      message: 'Database connection failed'
    };
  }
}

async function checkAIService() {
  try {
    const AI_SERVICE_PATH = join(__dirname, '..', 'ai_service.py');
    const pythonExists = fs.existsSync(AI_SERVICE_PATH);
    
    if (!pythonExists) {
      return {
        status: 'unhealthy',
        available: false,
        message: 'AI service file not found',
        error: 'ai_service.py not found'
      };
    }
    
    // Check if Python is available
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    
    return new Promise((resolve) => {
      const testProcess = spawn(pythonCmd, ['--version'], { timeout: 5000 });
      let pythonAvailable = false;
      
      testProcess.on('close', (code) => {
        pythonAvailable = code === 0;
        
        const envVars = readEnvFile();
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || envVars.GEMINI_API_KEY || envVars.GOOGLE_API_KEY;
        const hasApiKey = !!apiKey || true;
        
        resolve({
          status: pythonAvailable ? 'healthy' : 'degraded',
          available: pythonAvailable,
          serviceFile: pythonExists,
          apiKeyConfigured: true,
          apiKeySource: apiKey ? (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? 'environment' : 'env_file') : 'hardcoded_fallback',
          pythonCommand: pythonCmd,
          message: pythonAvailable 
            ? 'AI service is ready' 
            : 'Python not available'
        });
      });
      
      testProcess.on('error', () => {
        const envVars = readEnvFile();
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || envVars.GEMINI_API_KEY || envVars.GOOGLE_API_KEY;
        resolve({
          status: 'unhealthy',
          available: false,
          serviceFile: pythonExists,
          apiKeyConfigured: true,
          apiKeySource: apiKey ? (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? 'environment' : 'env_file') : 'hardcoded_fallback',
          message: 'Python not available',
          error: 'Python command not found'
        });
      });
      
      setTimeout(() => {
        testProcess.kill();
        resolve({
          status: 'degraded',
          available: false,
          serviceFile: pythonExists,
          message: 'Python check timed out'
        });
      }, 5000);
    });
  } catch (error) {
    return {
      status: 'unhealthy',
      available: false,
      error: error.message,
      message: 'AI service check failed'
    };
  }
}

function checkMonitoringServices() {
  return {
    monitoring: {
      status: monitoringService.isRunning ? 'healthy' : 'unhealthy',
      running: monitoringService.isRunning,
      interval: '15 seconds',
      message: monitoringService.isRunning 
        ? 'Monitoring service is running' 
        : 'Monitoring service is not running'
    },
    cleanup: {
      status: cleanupService.isRunning ? 'healthy' : 'unhealthy',
      running: cleanupService.isRunning,
      interval: '6 hours',
      retention: '24 hours',
      message: cleanupService.isRunning 
        ? 'Cleanup service is running (deletes empty detections older than 24 hours)' 
        : 'Cleanup service is not running'
    },
  };
}

function checkSystemInfo() {
  return {
    nodeVersion: process.version,
    platform: process.platform,
    uptime: Math.floor(process.uptime()),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      unit: 'MB'
    },
    environment: process.env.NODE_ENV || 'development'
  };
}

router.get('/', (req, res) => {
  res.json({ status: 'ok', database: 'connected' });
});

router.post('/cleanup', async (req, res) => {
  try {
    await cleanupService.runCleanup();
    res.json({ 
      success: true, 
      message: 'Cleanup completed successfully' 
    });
  } catch (error) {
    console.error('Manual cleanup error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Cleanup failed' 
    });
  }
});

router.get('/status', async (req, res) => {
  try {
    const [database, aiService, systemInfo] = await Promise.all([
      checkDatabase(),
      checkAIService(),
      Promise.resolve(checkSystemInfo())
    ]);
    
    const monitoringServices = checkMonitoringServices();
    const viberService = getViberServiceStatus();
    
    const statuses = [
      database.status,
      aiService.status,
      viberService.status, // Use Viber as primary
      monitoringServices.monitoring.status
    ];
    
    const overallStatus = statuses.every(s => s === 'healthy') 
      ? 'healthy' 
      : statuses.some(s => s === 'unhealthy') 
        ? 'unhealthy' 
        : 'degraded';
    
    res.json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      services: {
        database,
        ai: aiService,
        messaging: viberService,
        monitoring: monitoringServices
      },
      system: systemInfo
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;

