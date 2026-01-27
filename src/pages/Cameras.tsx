import { useState, useEffect, useRef } from 'react';
import { Plus, Camera as CameraIcon, Search, Video } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { usePageTracking } from '@/hooks/usePageTracking';
import { CameraFeed } from '@/components/dashboard/CameraFeed';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Camera } from '@/types/parking';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { camerasAPI } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

interface DetectedCamera {
  deviceId: string;
  label: string;
  kind: string;
}

export default function Cameras() {
  usePageTracking();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newCamera, setNewCamera] = useState({
    name: '',
    locationId: '',
    deviceId: '',
    isFixed: true,
    illegalParkingZone: true,
  });
  const [detectedCameras, setDetectedCameras] = useState<DetectedCamera[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [activeStreams, setActiveStreams] = useState<Map<string, MediaStream>>(new Map());
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const streamsRef = useRef<Map<string, MediaStream>>(new Map());

  const onlineCameras = cameras.filter(c => c.status === 'online');

  // Helper function to safely play video elements in preview
  const safePlayPreviewVideo = (videoElement: HTMLVideoElement | null, context: string = '') => {
    if (!videoElement) return;
    
    // Check if element is still in the DOM
    if (!videoElement.isConnected) {
      return;
    }

    // Check if element has a valid srcObject
    if (!videoElement.srcObject) {
      return;
    }

    videoElement.play().catch((err) => {
      // AbortError is expected when element is removed or reloaded - ignore it
      if (err.name === 'AbortError') {
        return;
      }
      // Log other errors (but not autoplay policy errors)
      if (err.name !== 'NotAllowedError' && err.name !== 'NotSupportedError') {
        console.error(`Error playing preview video (${context}):`, err);
      }
    });
  };

  // Load cameras from API
  useEffect(() => {
    loadCameras();
    
    // Refresh cameras every 5 seconds to keep timers synchronized across users
    const refreshInterval = setInterval(() => {
      loadCameras();
    }, 5000);
    
    return () => clearInterval(refreshInterval);
  }, []);

  // Validate all cameras and update their status
  const validateAllCameras = async () => {
    if (!navigator.mediaDevices) return;
    
    // Get fresh camera list from state
    const currentCameras = cameras;
    if (currentCameras.length === 0) return;
    
    let hasChanges = false;
    
    for (const camera of currentCameras) {
      if (!camera.deviceId) {
        // No deviceId means offline
        if (camera.status !== 'offline') {
          try {
            await camerasAPI.update(camera.id, { status: 'offline' });
            hasChanges = true;
          } catch (error) {
            console.error(`Failed to update camera ${camera.id} status:`, error);
          }
        }
        continue;
      }

      try {
        const isValid = await validateCameraAccess(camera.deviceId);
        const expectedStatus = isValid ? 'online' : 'offline';
        
        // Only update if status changed
        if (camera.status !== expectedStatus) {
          console.log(`Updating camera ${camera.id} status from ${camera.status} to ${expectedStatus}`);
          await camerasAPI.update(camera.id, { status: expectedStatus });
          hasChanges = true;
        }
      } catch (error) {
        console.error(`Error validating camera ${camera.id}:`, error);
      }
    }
    
    // Reload cameras after validation to reflect any changes
    if (hasChanges) {
      await loadCameras();
    }
  };

  // Periodically validate camera status (every 30 seconds)
  useEffect(() => {
    if (cameras.length === 0) return;
    
    const validationInterval = setInterval(() => {
      validateAllCameras();
    }, 30000);
    
    return () => clearInterval(validationInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameras.length]); // Only re-run when number of cameras changes

  const loadCameras = async () => {
    try {
      setIsLoading(true);
      const data = await camerasAPI.getAll();
      console.log('Loaded cameras from API:', data);
      // Ensure deviceId is properly set (convert null/empty to undefined for frontend)
      const camerasWithDeviceId = data.map((camera: any) => {
        const deviceIdValue = camera.deviceId && typeof camera.deviceId === 'string' && camera.deviceId.trim() 
          ? camera.deviceId.trim() 
          : undefined;
        const processed = {
          ...camera,
          deviceId: deviceIdValue
        };
        console.log('Processing camera:', camera.name, 'deviceId from API:', camera.deviceId, 'type:', typeof camera.deviceId, '-> processed:', processed.deviceId);
        return processed;
      });
      setCameras(camerasWithDeviceId);
    } catch (error) {
      console.error('Error loading cameras:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to load cameras';
      toast({
        title: "Connection Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const detectCameras = async () => {
    setIsDetecting(true);
    try {
      // Request permission to access cameras
      await navigator.mediaDevices.getUserMedia({ video: true });
      
      // Enumerate all devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices
        .filter(device => device.kind === 'videoinput')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Camera ${device.deviceId.substring(0, 8)}`,
          kind: device.kind,
        }));
      
      setDetectedCameras(videoDevices);
      
      if (videoDevices.length === 0) {
        toast({
          title: "No Cameras Found",
          description: "No video input devices detected on your system",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Cameras Detected",
          description: `Found ${videoDevices.length} camera(s)`,
        });
      }
    } catch (error) {
      console.error('Error detecting cameras:', error);
      toast({
        title: "Detection Failed",
        description: "Could not access camera devices. Please check permissions.",
        variant: "destructive",
      });
    } finally {
      setIsDetecting(false);
    }
  };

  const startPreview = async (deviceId: string) => {
    // Check if we already have an active stream for this device
    const existingStream = streamsRef.current.get(deviceId);
    if (existingStream && existingStream.active) {
      const existingTracks = existingStream.getVideoTracks();
      if (existingTracks.length > 0) {
        const existingDeviceId = existingTracks[0].getSettings().deviceId;
        if (existingDeviceId === deviceId) {
          // Stream already exists and is active, just ensure video element is connected
          const videoElement = videoRefs.current.get(deviceId);
          if (videoElement && videoElement.srcObject !== existingStream) {
            videoElement.srcObject = existingStream;
            setTimeout(() => {
              safePlayPreviewVideo(videoElement, 'reusing existing preview');
            }, 50);
          }
          return;
        }
      }
    }

    // Stop any existing stream for this device
    stopPreview(deviceId);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId } },
      });
      
      streamsRef.current.set(deviceId, stream);
      setActiveStreams(prev => {
        const newMap = new Map(prev);
        newMap.set(deviceId, stream);
        return newMap;
      });
      
      // Set video element source - use setTimeout to ensure DOM is ready
      setTimeout(() => {
        const videoElement = videoRefs.current.get(deviceId);
        if (videoElement) {
          videoElement.srcObject = stream;
          safePlayPreviewVideo(videoElement, 'new preview stream');
        }
      }, 100);
    } catch (error) {
      console.error('Error starting preview:', error);
      toast({
        title: "Preview Failed",
        description: "Could not start camera preview. Please check camera permissions.",
        variant: "destructive",
      });
    }
  };

  const stopPreview = (deviceId: string) => {
    const stream = streamsRef.current.get(deviceId);
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      streamsRef.current.delete(deviceId);
      setActiveStreams(prev => {
        const newMap = new Map(prev);
        newMap.delete(deviceId);
        return newMap;
      });
    }
  };

  const stopAllPreviews = () => {
    streamsRef.current.forEach((stream) => {
      stream.getTracks().forEach(track => track.stop());
    });
    streamsRef.current.clear();
    setActiveStreams(new Map());
  };

  // Cleanup streams when dialog closes
  useEffect(() => {
    if (!isDialogOpen) {
      stopAllPreviews();
      setSelectedDeviceId('');
      setDetectedCameras([]);
    }
  }, [isDialogOpen]);

  // Update video elements when streams change (but only if stream actually changed)
  useEffect(() => {
    // Only update if we have active streams and the Map reference actually changed
    if (activeStreams.size === 0) return;

    activeStreams.forEach((stream, deviceId) => {
      const videoElement = videoRefs.current.get(deviceId);
      if (videoElement) {
        // Only update if srcObject is different
        if (videoElement.srcObject !== stream) {
          videoElement.srcObject = stream;
          // Use safe play with a small delay to ensure element is ready
          setTimeout(() => {
            safePlayPreviewVideo(videoElement, 'stream updated');
          }, 50);
        } else if (videoElement.paused && videoElement.isConnected) {
          // Only try to resume if element is still connected
          safePlayPreviewVideo(videoElement, 'resume paused');
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStreams.size]); // Only depend on size, not the entire Map object

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAllPreviews();
    };
  }, []);

  const handleSelectCamera = (deviceId: string) => {
    // Check if deviceId is already in use
    const existingCamera = cameras.find(c => c.deviceId && c.deviceId.trim() === deviceId.trim());
    if (existingCamera) {
      toast({
        title: "Device Already in Use",
        description: `This device is already registered to "${existingCamera.name}". Please remove it first or select a different camera.`,
        variant: "destructive",
      });
      return;
    }

    // Find the detected camera to get its label
    const detectedCamera = detectedCameras.find(c => c.deviceId === deviceId);
    const deviceLabel = detectedCamera?.label || `Camera ${deviceId.substring(0, 8)}`;
    
    // Generate a smart location ID from the device name
    // Extract meaningful parts from device label (e.g., "HD Pro Webcam" -> "HD-PRO")
    const generateLocationId = (label: string): string => {
      // Remove common camera terms and clean up
      let cleaned = label
        .replace(/camera|webcam|hd|pro|usb|built-in|video|input|device/gi, '')
        .trim()
        .replace(/[^a-zA-Z0-9\s-]/g, '') // Remove special characters
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .toUpperCase();
      
      // Extract first meaningful words (max 2-3 words, max 10 chars)
      const words = cleaned.split('-').filter(w => w.length > 0);
      if (words.length > 0) {
        // Take first 2-3 meaningful words
        const meaningfulWords = words.slice(0, 2).join('-');
        if (meaningfulWords.length >= 3 && meaningfulWords.length <= 12) {
          return meaningfulWords;
        }
        // If too long, take first word and truncate
        if (meaningfulWords.length > 12) {
          return words[0].substring(0, 8);
        }
      }
      
      // If cleaned is too short or empty, use a default pattern based on device ID
      const devicePrefix = deviceId.substring(0, 6).toUpperCase().replace(/[^A-Z0-9]/g, '');
      return `ZONE-${devicePrefix}`;
    };

    const suggestedLocationId = generateLocationId(deviceLabel);
    
    console.log('Selecting camera with deviceId:', deviceId);
    console.log('Device label:', deviceLabel);
    console.log('Suggested location ID:', suggestedLocationId);
    
    setSelectedDeviceId(deviceId);
    // Auto-fill name and location ID when device is selected
    setNewCamera((prev) => {
      const updated = {
        ...prev,
        deviceId,
        // Only auto-fill name if it's empty
        name: prev.name.trim() || deviceLabel,
        // Only auto-fill locationId if it's empty
        locationId: prev.locationId.trim() || suggestedLocationId,
      };
      console.log('Updated newCamera state with deviceId, name, and locationId:', updated);
      return updated;
    });
    startPreview(deviceId);
  };

  const handleDeleteCamera = async (cameraId: string) => {
    try {
      // Delete returns 204 No Content, so we don't need to handle the response
      await camerasAPI.delete(cameraId);
      toast({
        title: "Camera Deleted",
        description: "Camera has been removed successfully",
      });
      await loadCameras();
    } catch (error: any) {
      console.error('Delete camera error:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete camera",
        variant: "destructive",
      });
    }
  };

  // Validate camera access
  const validateCameraAccess = async (deviceId: string): Promise<boolean> => {
    if (!deviceId || !navigator.mediaDevices) {
      return false;
    }

    try {
      // Try to access the camera with the deviceId
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId } }
      }).catch(() => {
        // If exact fails, try without exact
        return navigator.mediaDevices.getUserMedia({
          video: { deviceId: deviceId }
        });
      });

      // If we got a stream, it's valid - stop it immediately
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        return true;
      }
      return false;
    } catch (error) {
      console.log('Camera validation failed:', error);
      return false;
    }
  };

  const handleAddCamera = async () => {
    // Enhanced validation with better error messages
    if (!newCamera.name.trim()) {
      toast({
        title: "Validation Error",
        description: "Please enter a camera name. You can select a device to auto-fill this field.",
        variant: "destructive",
      });
      return;
    }
    
    if (!newCamera.locationId.trim()) {
      toast({
        title: "Validation Error",
        description: "Please enter a location/zone ID. You can select a device to auto-generate this field.",
        variant: "destructive",
      });
      return;
    }
    
    // Validate location ID format (should be uppercase alphanumeric with optional hyphens)
    const locationIdPattern = /^[A-Z0-9-]+$/;
    if (!locationIdPattern.test(newCamera.locationId.trim().toUpperCase())) {
      toast({
        title: "Validation Error",
        description: "Location ID should only contain uppercase letters, numbers, and hyphens (e.g., ZONE-A, ENTRANCE-01)",
        variant: "destructive",
      });
      return;
    }

    // Check if deviceId is already in use
    const deviceIdValue = newCamera.deviceId && newCamera.deviceId.trim() ? newCamera.deviceId.trim() : null;
    if (deviceIdValue) {
      const existingCamera = cameras.find(c => c.deviceId && c.deviceId.trim() === deviceIdValue);
      if (existingCamera) {
        toast({
          title: "Device ID Already in Use",
          description: `This device is already registered to "${existingCamera.name}". Please select a different camera or remove the existing one first.`,
          variant: "destructive",
        });
        return;
      }
    }

    try {
      // Validate camera access if deviceId is provided
      let cameraStatus: 'online' | 'offline' = 'offline';
      if (deviceIdValue) {
        toast({
          title: "Validating Camera",
          description: "Checking camera access...",
        });
        const isValid = await validateCameraAccess(deviceIdValue);
        cameraStatus = isValid ? 'online' : 'offline';
        
        if (!isValid) {
          toast({
            title: "Camera Invalid",
            description: "Camera device is not accessible. It will be set to offline.",
            variant: "destructive",
          });
        }
      }

      // Generate unique camera ID by checking existing IDs
      let cameraId = `CAM-${String(cameras.length + 1).padStart(3, '0')}`;
      let counter = cameras.length + 1;
      while (cameras.some(c => c.id === cameraId)) {
        counter++;
        cameraId = `CAM-${String(counter).padStart(3, '0')}`;
      }
      
      const cameraData = {
        id: cameraId,
        name: newCamera.name.trim(),
        locationId: newCamera.locationId.trim().toUpperCase(),
        status: cameraStatus,
        deviceId: deviceIdValue,
        isFixed: newCamera.isFixed,
        illegalParkingZone: newCamera.illegalParkingZone,
      };

      console.log('Sending camera data to API:', cameraData);
      const createdCamera = await camerasAPI.create(cameraData);
      console.log('Received created camera:', createdCamera);
      // Reload cameras to get the latest data
      await loadCameras();
      stopAllPreviews();
      setNewCamera({ name: '', locationId: '', deviceId: '', isFixed: true, illegalParkingZone: true });
      setIsDialogOpen(false);
      toast({
        title: "Camera Added",
        description: `${createdCamera.name} has been added ${cameraStatus === 'online' ? 'and is online' : 'but is offline (invalid device)'}`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to add camera",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen">
      <Header 
        title="Camera Monitoring" 
        subtitle="Live feeds from all surveillance points"
      />

      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* Info message for barangay users */}
        {!isAdmin && (
          <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <p className="text-sm text-blue-900 dark:text-blue-100">
              <strong>Monitoring Mode:</strong> You are viewing cameras configured by the administrator. 
              These cameras are shared across all users. You can monitor the configured cameras but cannot add or remove them.
            </p>
          </div>
        )}

        {/* Header with Add Button */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 sm:gap-4">
            <Badge variant="success" className="px-3 py-1.5 sm:px-4 sm:py-2">
              {onlineCameras.length} Online
            </Badge>
            <Badge variant="destructive" className="px-3 py-1.5 sm:px-4 sm:py-2">
              {cameras.length - onlineCameras.length} Offline
            </Badge>
          </div>

          {isAdmin && (
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Camera
                </Button>
              </DialogTrigger>
            <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add New Camera</DialogTitle>
                <DialogDescription>
                  Configure a new surveillance camera for the system
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                {/* Camera Detection Section */}
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <Label>Detect Cameras</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={detectCameras}
                      disabled={isDetecting}
                    >
                      <Search className="h-4 w-4 mr-2" />
                      {isDetecting ? 'Detecting...' : 'Detect Cameras'}
                    </Button>
                  </div>
                  {detectedCameras.length > 0 && (
                    <div className="space-y-2 mt-2">
                      <p className="text-sm text-muted-foreground">
                        Found {detectedCameras.length} camera(s). Select one to preview:
                      </p>
                      <div className="grid grid-cols-1 gap-3 max-h-[300px] overflow-y-auto">
                        {detectedCameras.map((camera) => {
                          const isSelected = selectedDeviceId === camera.deviceId;
                          const isPreviewing = activeStreams.has(camera.deviceId);
                          const isInUse = cameras.some(c => c.deviceId && c.deviceId.trim() === camera.deviceId.trim());
                          
                          return (
                            <div
                              key={camera.deviceId}
                              className={cn(
                                "border rounded-lg p-3 transition-colors",
                                isInUse 
                                  ? "border-destructive bg-destructive/5 cursor-not-allowed opacity-60"
                                  : isSelected
                                  ? "border-primary bg-primary/5 cursor-pointer"
                                  : "border-border hover:border-primary/50 cursor-pointer"
                              )}
                              onClick={() => !isInUse && handleSelectCamera(camera.deviceId)}
                            >
                              <div className="flex items-start gap-3">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-2">
                                    <Video className="h-4 w-4 text-muted-foreground" />
                                    <span className="font-medium text-sm">{camera.label}</span>
                                    {isInUse && (
                                      <Badge variant="destructive" className="text-xs">
                                        In Use
                                      </Badge>
                                    )}
                                    {isSelected && !isInUse && (
                                      <Badge variant="success" className="text-xs">
                                        Selected
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground font-mono">
                                    {camera.deviceId.substring(0, 20)}...
                                  </p>
                                </div>
                                {isPreviewing && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      stopPreview(camera.deviceId);
                                    }}
                                  >
                                    Stop
                                  </Button>
                                )}
                              </div>
                              {/* Preview Video */}
                              {isSelected && (
                                <div className="mt-3 rounded-md overflow-hidden bg-black aspect-video relative">
                                  <video
                                    key={camera.deviceId}
                                    ref={(el) => {
                                      if (el) {
                                        videoRefs.current.set(camera.deviceId, el);
                                        // Ensure stream is set if it exists
                                        const stream = streamsRef.current.get(camera.deviceId);
                                        if (stream && el.srcObject !== stream) {
                                          el.srcObject = stream;
                                          // Use safe play with a small delay
                                          setTimeout(() => {
                                            safePlayPreviewVideo(el, 'ref callback');
                                          }, 50);
                                        }
                                      } else {
                                        videoRefs.current.delete(camera.deviceId);
                                      }
                                    }}
                                    autoPlay
                                    playsInline
                                    muted
                                    className={cn(
                                      "w-full h-full object-cover",
                                      !isPreviewing && "opacity-0"
                                    )}
                                  />
                                  {!isPreviewing && (
                                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                                      <div className="text-center">
                                        <Video className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                        <p className="text-sm">Starting preview...</p>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="name">Camera Name</Label>
                    {selectedDeviceId && newCamera.name && (
                      <Badge variant="outline" className="text-xs">
                        Auto-filled from device
                      </Badge>
                    )}
                  </div>
                  <Input
                    id="name"
                    placeholder="e.g., Main Entrance"
                    value={newCamera.name}
                    onChange={(e) => setNewCamera((prev) => ({ ...prev, name: e.target.value }))}
                    className={selectedDeviceId && newCamera.name ? "border-primary/50" : ""}
                  />
                  {selectedDeviceId && !newCamera.name && (
                    <p className="text-xs text-muted-foreground">
                      Camera name will be auto-filled when you select a device
                    </p>
                  )}
                </div>
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="locationId">Zone / Location ID</Label>
                    {selectedDeviceId && newCamera.locationId && (
                      <Badge variant="outline" className="text-xs">
                        Auto-suggested
                      </Badge>
                    )}
                  </div>
                  <Input
                    id="locationId"
                    placeholder="e.g., ZONE-A"
                    value={newCamera.locationId}
                    onChange={(e) => setNewCamera((prev) => ({ ...prev, locationId: e.target.value.toUpperCase() }))}
                    className={selectedDeviceId && newCamera.locationId ? "border-primary/50" : ""}
                  />
                  {selectedDeviceId && !newCamera.locationId && (
                    <p className="text-xs text-muted-foreground">
                      Location ID will be auto-generated when you select a device
                    </p>
                  )}
                </div>
                {selectedDeviceId ? (
                  <div className="text-xs bg-primary/10 border border-primary/20 p-3 rounded-md">
                    <p className="font-medium mb-1 text-primary">Device Selected:</p>
                    <p className="text-foreground mb-2">
                      <strong>Device:</strong> {detectedCameras.find(c => c.deviceId === selectedDeviceId)?.label || 'Unknown Device'}
                    </p>
                    <p className="text-foreground mb-2">
                      <strong>Name:</strong> {newCamera.name || 'Not set'}
                    </p>
                    <p className="text-foreground">
                      <strong>Location ID:</strong> {newCamera.locationId || 'Not set'}
                    </p>
                    <p className="text-muted-foreground mt-2 text-[10px]">
                      Camera status will be automatically determined based on device accessibility.
                    </p>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md">
                    <p className="font-medium mb-1">Note:</p>
                    <p>Select a camera device above to auto-fill the camera name and location ID. Camera status will be automatically determined based on device accessibility.</p>
                  </div>
                )}
                {/* Camera Configuration Options */}
                <div className="grid gap-4 pt-2 border-t border-border">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="isFixed"
                      checked={newCamera.isFixed}
                      onCheckedChange={(checked) => setNewCamera((prev) => ({ ...prev, isFixed: checked === true }))}
                    />
                    <Label htmlFor="isFixed" className="text-sm font-normal cursor-pointer">
                      Fixed Camera Configuration
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="illegalParkingZone"
                      checked={newCamera.illegalParkingZone}
                      onCheckedChange={(checked) => setNewCamera((prev) => ({ ...prev, illegalParkingZone: checked === true }))}
                    />
                    <Label htmlFor="illegalParkingZone" className="text-sm font-normal cursor-pointer">
                      Covers Illegal Parking Zone
                    </Label>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAddCamera}>
                  Add Camera
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          )}
        </div>

        {/* Camera Grid */}
        {cameras.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {cameras.map((camera) => (
              <CameraFeed 
                key={camera.id} 
                camera={camera} 
                onRefresh={loadCameras}
                onDelete={handleDeleteCamera}
                canDelete={isAdmin}
              />
            ))}
          </div>
        ) : (
          <div className="glass-card rounded-xl p-8 sm:p-12 text-center">
            <CameraIcon className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No Cameras Configured</h3>
            <p className="text-muted-foreground mb-6">
              {isAdmin 
                ? 'Add your first surveillance camera to start monitoring'
                : 'No cameras have been configured yet. Please contact the administrator to set up cameras.'}
            </p>
            {isAdmin && (
              <Button onClick={() => setIsDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Your First Camera
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
