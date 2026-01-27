import { useState, useEffect, useCallback, useRef } from 'react';

type CaptureStatus = 'counting' | 'sending' | 'waiting' | 'processing';

interface UseCaptureTimerOptions {
  cameraId: string;
  isOnline: boolean;
  lastCapture: Date | string; // Server timestamp for synchronization
  onCapture: () => Promise<void>;
}

const COUNTDOWN_SECONDS = 10;
const WAIT_SECONDS = 15; // 15 seconds wait before countdown
const AI_PROCESSING_SECONDS = 15; // 15 seconds for AI to process deeply

export function useCaptureTimer({ cameraId, isOnline, lastCapture, onCapture }: UseCaptureTimerOptions) {
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>('waiting');
  const [nextCaptureTime, setNextCaptureTime] = useState(0);
  const [isCapturing, setIsCapturing] = useState(false);
  const lastTriggeredRef = useRef<number>(0); // Track when we last triggered capture to prevent duplicates

  // Calculate timer based on server's lastCapture timestamp
  // Cycle: Wait (15 sec) -> Countdown/Capture (10 sec) -> AI Processing (15 sec) -> Wait (repeat)
  // Total cycle: 40 seconds
  const calculateTimeRemaining = useCallback(() => {
    if (!isOnline) {
      setNextCaptureTime(0);
      return;
    }

    const lastCaptureDate = new Date(lastCapture);
    const now = Date.now();
    const lastCaptureTime = lastCaptureDate.getTime();
    
    // Calculate time since last capture (in seconds)
    const timeSinceLastCapture = Math.floor((now - lastCaptureTime) / 1000);
    const totalCycleTime = WAIT_SECONDS + COUNTDOWN_SECONDS + AI_PROCESSING_SECONDS;
    
    // Phase 1: AI Processing (first 15 seconds after capture)
    if (timeSinceLastCapture < AI_PROCESSING_SECONDS) {
      const remaining = AI_PROCESSING_SECONDS - timeSinceLastCapture;
      setNextCaptureTime(remaining);
      setCaptureStatus('processing');
    }
    // Phase 2: Wait period (15 seconds)
    else if (timeSinceLastCapture < AI_PROCESSING_SECONDS + WAIT_SECONDS) {
      const remaining = (AI_PROCESSING_SECONDS + WAIT_SECONDS) - timeSinceLastCapture;
      setNextCaptureTime(remaining);
      setCaptureStatus('waiting');
    }
    // Phase 3: Countdown/Capture (10 seconds)
    else {
      const timeInCycle = timeSinceLastCapture - (AI_PROCESSING_SECONDS + WAIT_SECONDS);
      if (timeInCycle < COUNTDOWN_SECONDS) {
        const countdownRemaining = COUNTDOWN_SECONDS - timeInCycle;
        setNextCaptureTime(countdownRemaining);
        setCaptureStatus('counting');
      } else {
        // Past countdown, should trigger capture immediately
        setNextCaptureTime(0);
        setCaptureStatus('counting');
      }
    }
  }, [lastCapture, isOnline]);

  const triggerCapture = useCallback(async () => {
    const now = Date.now();
    const MIN_CAPTURE_INTERVAL = 35000; // Minimum 35 seconds between captures (slightly less than 40s cycle)
    
    // Prevent multiple simultaneous captures
    if (isCapturing) {
      console.log('⏸️  Capture already in progress, skipping...');
      return;
    }
    
    // Prevent captures too soon after last trigger (safety check)
    if (now - lastTriggeredRef.current < MIN_CAPTURE_INTERVAL) {
      console.log(`⏸️  Too soon since last capture (${Math.floor((now - lastTriggeredRef.current) / 1000)}s), skipping...`);
      return;
    }
    
    lastTriggeredRef.current = now;
    setIsCapturing(true);
    setCaptureStatus('sending');

    try {
      console.log(`📸 Triggering capture for camera ${cameraId} at ${new Date().toISOString()}`);
      await onCapture();
      // After capture, the server will update lastCapture, and we'll recalculate on next render
      // Set status to processing - the timer will update based on new lastCapture from server
      setCaptureStatus('processing');
    } catch (error) {
      console.error('❌ Error triggering capture:', error);
      setCaptureStatus('waiting');
      lastTriggeredRef.current = 0; // Reset on error so we can retry
    } finally {
      setIsCapturing(false);
    }
  }, [onCapture, isCapturing, cameraId]);

  const resetTimer = useCallback(() => {
    // Reset just recalculates based on current lastCapture
    calculateTimeRemaining();
  }, [calculateTimeRemaining]);

  // Recalculate when lastCapture changes (from server)
  useEffect(() => {
    // Reset trigger tracking when lastCapture updates (means server processed the capture)
    const lastCaptureTime = new Date(lastCapture).getTime();
    if (Math.abs(lastCaptureTime - lastTriggeredRef.current) < 5000) {
      // If lastCapture is close to when we triggered, it's likely the server response
      // Don't reset, but log for debugging
      console.log(`✅ Server updated lastCapture: ${new Date(lastCapture).toISOString()}`);
    }
    calculateTimeRemaining();
  }, [lastCapture, calculateTimeRemaining]);

  // Update timer every second
  useEffect(() => {
    if (!isOnline) {
      setNextCaptureTime(0);
      return;
    }

    const MIN_CAPTURE_INTERVAL = 35000; // Minimum 35 seconds between captures

    const updateTimer = () => {
      const lastCaptureDate = new Date(lastCapture);
      const now = Date.now();
      const lastCaptureTime = lastCaptureDate.getTime();
      
      // Calculate time since last capture (in seconds)
      const timeSinceLastCapture = Math.floor((now - lastCaptureTime) / 1000);
      
      // Phase 1: AI Processing (first 15 seconds after capture)
      if (timeSinceLastCapture < AI_PROCESSING_SECONDS) {
        const remaining = AI_PROCESSING_SECONDS - timeSinceLastCapture;
        setNextCaptureTime(remaining);
        setCaptureStatus('processing');
      }
      // Phase 2: Wait period (15 seconds)
      else if (timeSinceLastCapture < AI_PROCESSING_SECONDS + WAIT_SECONDS) {
        const remaining = (AI_PROCESSING_SECONDS + WAIT_SECONDS) - timeSinceLastCapture;
        setNextCaptureTime(remaining);
        setCaptureStatus('waiting');
      }
      // Phase 3: Countdown/Capture (10 seconds)
      else {
        const timeInCountdownPhase = timeSinceLastCapture - (AI_PROCESSING_SECONDS + WAIT_SECONDS);
        
        if (timeInCountdownPhase < COUNTDOWN_SECONDS) {
          // In countdown phase
          const countdownRemaining = COUNTDOWN_SECONDS - timeInCountdownPhase;
          setNextCaptureTime(countdownRemaining);
          setCaptureStatus('counting');
          
          // Trigger capture when countdown reaches 0 or less
          // Use lastTriggeredRef to ensure we only trigger once per cycle
          if (countdownRemaining <= 0 && !isCapturing && (now - lastTriggeredRef.current) >= MIN_CAPTURE_INTERVAL) {
            triggerCapture();
          }
        } else {
          // Past countdown, should trigger capture immediately (but only once)
          setNextCaptureTime(0);
          setCaptureStatus('counting');
          // Only trigger if we haven't triggered recently
          if (!isCapturing && (now - lastTriggeredRef.current) >= MIN_CAPTURE_INTERVAL) {
            triggerCapture();
          }
        }
      }
    };

    updateTimer();
    const timer = setInterval(updateTimer, 1000);

    return () => clearInterval(timer);
  }, [isOnline, lastCapture, triggerCapture, isCapturing]);

  return {
    captureStatus,
    nextCaptureTime,
    resetTimer,
  };
}


