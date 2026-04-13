import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Python used for ai_service, detection_worker, YOLO, etc.
 * Order: PYTHON_EXECUTABLE → server/.venv → python / python3 on PATH.
 */
export function getPythonExecutable() {
  const fromEnv = process.env.PYTHON_EXECUTABLE?.trim();
  if (fromEnv) return fromEnv;

  if (process.platform === 'win32') {
    const winVenv = join(__dirname, '.venv', 'Scripts', 'python.exe');
    if (fs.existsSync(winVenv)) return winVenv;
    return 'python';
  }

  for (const name of ['python3', 'python']) {
    const nixVenv = join(__dirname, '.venv', 'bin', name);
    if (fs.existsSync(nixVenv)) return nixVenv;
  }
  return 'python3';
}
