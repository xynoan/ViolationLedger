import express from 'express';
import db from '../database.js';
import { analyzeImageWithAI } from '../ai_detection_service.js';
import monitoringService from '../monitoring_service.js';
import cleanupService from '../cleanup_service.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs-extra';
import { spawn } from 'child_process';
import { getSmsServiceStatus } from '../utils/smsService.js';
import { getPythonExecutable } from '../python_executable.js';
import {
  getGracePeriodMinutes,
  getRuntimeConfig,
  setGracePeriodMinutes,
  setOwnerSmsDelayMinutes,
} from '../runtime_config.js';

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
    
    const pythonCmd = getPythonExecutable();

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
  const ownerSmsDelay = monitoringService.getOwnerSmsDelayConfig();
  const gracePeriodMinutes = getGracePeriodMinutes();
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
    ownerSmsDelay,
    gracePeriodMinutes,
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

router.get('/owner-sms-delay', (req, res) => {
  try {
    const config = monitoringService.getOwnerSmsDelayConfig();
    res.json(config);
  } catch (error) {
    console.error('Get owner SMS delay config error:', error);
    res.status(500).json({
      error: error.message || 'Failed to load owner SMS delay config',
    });
  }
});

router.post('/owner-sms-delay', (req, res) => {
  try {
    const { disabledForDemo, delayMinutes } = req.body || {};
    if (disabledForDemo !== undefined && typeof disabledForDemo !== 'boolean') {
      return res.status(400).json({
        error: 'disabledForDemo must be a boolean',
      });
    }
    if (delayMinutes !== undefined) {
      const parsedDelayMinutes = Number.parseInt(String(delayMinutes), 10);
      if (!Number.isFinite(parsedDelayMinutes) || parsedDelayMinutes <= 0) {
        return res.status(400).json({
          error: 'delayMinutes must be a positive integer',
        });
      }
      setOwnerSmsDelayMinutes(parsedDelayMinutes);
    }
    if (disabledForDemo !== undefined) {
      monitoringService.setDisableOwnerSmsDelayForDemo(disabledForDemo);
    }
    const updated = monitoringService.getOwnerSmsDelayConfig();
    res.json({
      success: true,
      ...updated,
    });
  } catch (error) {
    console.error('Update owner SMS delay config error:', error);
    res.status(500).json({
      error: error.message || 'Failed to update owner SMS delay config',
    });
  }
});

router.get('/runtime-config', (req, res) => {
  try {
    const config = getRuntimeConfig();
    res.json({
      ...config,
      ownerSmsDelayConfig: monitoringService.getOwnerSmsDelayConfig(),
      gracePeriodMinutes: getGracePeriodMinutes(),
    });
  } catch (error) {
    console.error('Get runtime config error:', error);
    res.status(500).json({
      error: error.message || 'Failed to load runtime config',
    });
  }
});

router.post('/runtime-config', (req, res) => {
  try {
    const { ownerSmsDelayMinutes, ownerSmsDelayDisabledForDemo, gracePeriodMinutes } = req.body || {};
    if (ownerSmsDelayMinutes !== undefined) {
      const parsedOwnerDelay = Number.parseInt(String(ownerSmsDelayMinutes), 10);
      if (!Number.isFinite(parsedOwnerDelay) || parsedOwnerDelay <= 0) {
        return res.status(400).json({ error: 'ownerSmsDelayMinutes must be a positive integer' });
      }
      setOwnerSmsDelayMinutes(parsedOwnerDelay);
    }
    if (ownerSmsDelayDisabledForDemo !== undefined) {
      if (typeof ownerSmsDelayDisabledForDemo !== 'boolean') {
        return res.status(400).json({ error: 'ownerSmsDelayDisabledForDemo must be a boolean' });
      }
      monitoringService.setDisableOwnerSmsDelayForDemo(ownerSmsDelayDisabledForDemo);
    }
    if (gracePeriodMinutes !== undefined) {
      const parsedGracePeriod = Number.parseInt(String(gracePeriodMinutes), 10);
      if (!Number.isFinite(parsedGracePeriod) || parsedGracePeriod <= 0) {
        return res.status(400).json({ error: 'gracePeriodMinutes must be a positive integer' });
      }
      setGracePeriodMinutes(parsedGracePeriod);
    }
    const config = getRuntimeConfig();
    res.json({
      success: true,
      ...config,
      ownerSmsDelayConfig: monitoringService.getOwnerSmsDelayConfig(),
      gracePeriodMinutes: getGracePeriodMinutes(),
    });
  } catch (error) {
    console.error('Update runtime config error:', error);
    res.status(500).json({
      error: error.message || 'Failed to update runtime config',
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
    const messagingService = getSmsServiceStatus();
    
    const statuses = [
      database.status,
      aiService.status,
      messagingService.status,
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
        messaging: messagingService,
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

