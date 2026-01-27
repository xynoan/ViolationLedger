import { useState, useEffect, useRef, useCallback } from 'react';

interface UseCameraStreamOptions {
  deviceId?: string;
  isOnline: boolean;
}

export function useCameraStream({ deviceId, isOnline }: UseCameraStreamOptions) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previousDeviceIdRef = useRef<string | undefined>(undefined);
  const isCreatingStreamRef = useRef<boolean>(false);
  const trackEndHandlersRef = useRef<Array<() => void>>([]);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setStream(null);
  }, []);

  const createStream = useCallback(async (targetDeviceId: string): Promise<MediaStream | null> => {
    if (!navigator.mediaDevices || isCreatingStreamRef.current) {
      return null;
    }

    isCreatingStreamRef.current = true;

    try {
      // Try with exact constraint first
      let mediaStream: MediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: targetDeviceId } },
        });
      } catch {
        // Fallback to non-exact constraint
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: targetDeviceId },
        });
      }

      isCreatingStreamRef.current = false;
      return mediaStream;
    } catch (error) {
      isCreatingStreamRef.current = false;
      console.error('Error accessing camera:', error);
      return null;
    }
  }, []);

  const reconnectStream = useCallback(async () => {
    if (!isOnline || !deviceId || isCreatingStreamRef.current) return;

    const mediaStream = await createStream(deviceId);
    if (!mediaStream) return;

    // Stop previous stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }

    // Remove old event listeners
    trackEndHandlersRef.current.forEach((remove) => remove());
    trackEndHandlersRef.current = [];

    streamRef.current = mediaStream;
    previousDeviceIdRef.current = deviceId;
    setStream(mediaStream);

    // Add event listeners for track end
    mediaStream.getVideoTracks().forEach((track) => {
      const handleEnd = () => {
        if (isOnline && deviceId && (!streamRef.current || !streamRef.current.active)) {
          setTimeout(() => reconnectStream(), 1000);
        }
      };
      track.addEventListener('ended', handleEnd);
      trackEndHandlersRef.current.push(() => track.removeEventListener('ended', handleEnd));
    });
  }, [deviceId, isOnline, createStream]);

  // Main effect to manage stream lifecycle
  useEffect(() => {
    let isMounted = true;
    const trimmedDeviceId = deviceId?.trim();

    // If deviceId hasn't changed and stream is active, keep it
    if (
      trimmedDeviceId === previousDeviceIdRef.current &&
      streamRef.current?.active
    ) {
      const existingTracks = streamRef.current.getVideoTracks();
      if (existingTracks.length > 0) {
        const existingDeviceId = existingTracks[0].getSettings().deviceId;
        if (existingDeviceId === trimmedDeviceId) {
          return;
        }
      }
    }

    // Cleanup if deviceId changed or camera went offline
    if (trimmedDeviceId !== previousDeviceIdRef.current || !isOnline) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      setStream(null);
      previousDeviceIdRef.current = undefined;
    }

    // Create new stream if needed
    if (isOnline && trimmedDeviceId && navigator.mediaDevices) {
      if (trimmedDeviceId !== previousDeviceIdRef.current) {
        createStream(trimmedDeviceId)
          .then((mediaStream) => {
            if (!isMounted || !mediaStream) return;

            if (streamRef.current) {
              streamRef.current.getTracks().forEach((track) => track.stop());
            }

            // Remove old event listeners
            trackEndHandlersRef.current.forEach((remove) => remove());
            trackEndHandlersRef.current = [];

            streamRef.current = mediaStream;
            previousDeviceIdRef.current = trimmedDeviceId;
            setStream(mediaStream);

            // Add event listeners
            mediaStream.getVideoTracks().forEach((track) => {
              const handleEnd = () => {
                if (isMounted && isOnline && trimmedDeviceId) {
                  setTimeout(() => {
                    if (isMounted && (!streamRef.current || !streamRef.current.active)) {
                      reconnectStream();
                    }
                  }, 1000);
                }
              };
              track.addEventListener('ended', handleEnd);
              trackEndHandlersRef.current.push(() =>
                track.removeEventListener('ended', handleEnd)
              );
            });
          })
          .catch((error) => {
            if (isMounted) {
              console.error('Error initializing camera stream:', error);
              setStream(null);
              streamRef.current = null;
            }
          });
      }
    }

    return () => {
      isMounted = false;
      trackEndHandlersRef.current.forEach((remove) => remove());
      trackEndHandlersRef.current = [];
    };
  }, [deviceId, isOnline, createStream, reconnectStream]);

  const refresh = useCallback(() => {
    stopStream();
    if (isOnline && deviceId) {
      setTimeout(() => reconnectStream(), 100);
    }
  }, [isOnline, deviceId, stopStream, reconnectStream]);

  return {
    stream: stream || streamRef.current,
    refresh,
    stopStream,
  };
}








