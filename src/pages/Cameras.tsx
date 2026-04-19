import { useState, useEffect, useMemo } from 'react';
import { Plus, Camera as CameraIcon } from 'lucide-react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Camera } from '@/types/parking';
import { toast } from '@/hooks/use-toast';
import { camerasAPI } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useFormOptions } from '@/hooks/useFormOptions';

export default function Cameras() {
  usePageTracking();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { config: formOptions } = useFormOptions();
  const residentStreets = formOptions.residentStreets;
  const streetSet = useMemo(() => new Set(residentStreets), [residentStreets]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newCamera, setNewCamera] = useState({
    name: '',
    locationId: '',
    deviceId: '',
    detectionRtspUrl: '',
    isFixed: true,
    illegalParkingZone: true,
  });

  const onlineCameras = cameras.filter(c => c.status === 'online');

  // Load cameras from API on initial mount only
  useEffect(() => {
    loadCameras();
  }, []);

  const loadCameras = async (bypassCache = false) => {
    try {
      setIsLoading(true);
      const data = await camerasAPI.getAll(bypassCache ? { cache: false } : undefined);
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

  const handleDeleteCamera = async (cameraId: string) => {
    try {
      // Delete returns 204 No Content, so we don't need to handle the response
      await camerasAPI.delete(cameraId);
      toast({
        title: "Camera Deleted",
        description: "Camera has been removed successfully",
      });
      await loadCameras(true);
    } catch (error: any) {
      console.error('Delete camera error:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete camera",
        variant: "destructive",
      });
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
        description: "Please select a street/zone for this camera.",
        variant: "destructive",
      });
      return;
    }
    
    if (!streetSet.has(newCamera.locationId.trim())) {
      toast({
        title: "Validation Error",
        description: "Please choose a valid street/zone from the list.",
        variant: "destructive",
      });
      return;
    }

    // Check if deviceId (go2rtc stream name) is already in use
    const deviceIdValue = newCamera.deviceId && newCamera.deviceId.trim() ? newCamera.deviceId.trim() : null;
    if (deviceIdValue) {
      const existingCamera = cameras.find(c => c.deviceId && c.deviceId.trim() === deviceIdValue);
      if (existingCamera) {
        toast({
          title: "Stream Already in Use",
          description: `This go2rtc stream is already registered to "${existingCamera.name}". Please use a different stream name or remove the existing camera first.`,
          variant: "destructive",
        });
        return;
      }
    }

    const detectionRtsp =
      newCamera.detectionRtspUrl && newCamera.detectionRtspUrl.trim()
        ? newCamera.detectionRtspUrl.trim()
        : null;

    if (detectionRtsp && !/^rtsp:\/\//i.test(detectionRtsp)) {
      toast({
        title: 'Invalid detection URL',
        description: 'Detection RTSP URL must start with rtsp://',
        variant: 'destructive',
      });
      return;
    }

    try {
      // Online when go2rtc stream name and/or a direct detection RTSP URL is set.
      const cameraStatus: 'online' | 'offline' =
        deviceIdValue || detectionRtsp ? 'online' : 'offline';

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
        locationId: newCamera.locationId.trim(),
        status: cameraStatus,
        deviceId: deviceIdValue,
        detectionRtspUrl: detectionRtsp || null,
        isFixed: newCamera.isFixed,
        illegalParkingZone: newCamera.illegalParkingZone,
      };

      console.log('Sending camera data to API:', cameraData);
      const createdCamera = await camerasAPI.create(cameraData);
      console.log('Received created camera:', createdCamera);
      // Reload cameras to get the latest data
      await loadCameras(true);
      setNewCamera({
        name: '',
        locationId: '',
        deviceId: '',
        detectionRtspUrl: '',
        isFixed: true,
        illegalParkingZone: true,
      });
      setIsDialogOpen(false);
      toast({
        title: "Camera Added",
        description: `${createdCamera.name} has been added ${cameraStatus === 'online' ? 'and is online (go2rtc stream configured)' : 'but has no stream configured yet'}`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to add camera",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <Header title="Camera Monitoring" subtitle="Live feeds from all surveillance points" />
        <div className="p-4 sm:p-6 flex items-center justify-center min-h-[50vh]">
          <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

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

        {/* Header with Refresh & Add Button */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 sm:gap-4">
            <Badge variant="success" className="px-3 py-1.5 sm:px-4 sm:py-2">
              {onlineCameras.length} Online
            </Badge>
            <Badge variant="destructive" className="px-3 py-1.5 sm:px-4 sm:py-2">
              {cameras.length - onlineCameras.length} Offline
            </Badge>
            {/* <Button
              variant="outline"
              size="sm"
              onClick={loadCameras}
            >
              Refresh
            </Button */}
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
                  Configure a new surveillance camera backed by a go2rtc WebRTC stream
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="name">Camera Name</Label>
                  </div>
                  <Input
                    id="name"
                    placeholder="e.g., Main Entrance"
                    value={newCamera.name}
                    onChange={(e) => setNewCamera((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="locationId">Zone / Location ID</Label>
                  </div>
                  <Select
                    value={newCamera.locationId}
                    onValueChange={(value) => setNewCamera((prev) => ({ ...prev, locationId: value }))}
                  >
                    <SelectTrigger id="locationId">
                      <SelectValue placeholder="Select a street/zone" />
                    </SelectTrigger>
                    <SelectContent>
                      {residentStreets.map((street) => (
                        <SelectItem key={street} value={street}>
                          {street}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="streamId">go2rtc Stream Name</Label>
                    <Badge variant="outline" className="text-xs">
                      Matches <code>src</code> in go2rtc
                    </Badge>
                  </div>
                  <Input
                    id="streamId"
                    placeholder="e.g., cam1"
                    value={newCamera.deviceId}
                    onChange={(e) =>
                      setNewCamera((prev) => ({ ...prev, deviceId: e.target.value.trim() }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    This should match the stream key from your <code>go2rtc.yaml</code>, for example
                    `cam1` when you connect via <code>/go2rtc/api/ws?src=cam1</code>.
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="detectionRtsp">Detection RTSP URL (optional)</Label>
                  <Input
                    id="detectionRtsp"
                    placeholder="e.g., rtsp://user:pass@host:554/stream — overrides go2rtc for YOLO"
                    value={newCamera.detectionRtspUrl}
                    onChange={(e) =>
                      setNewCamera((prev) => ({ ...prev, detectionRtspUrl: e.target.value }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave empty to use <code className="text-xs">{'{GO2RTC_RTSP_BASE}'}</code> + stream name.
                    Use a full <code className="text-xs">rtsp://</code> URL when go2rtc is not on this host or the
                    stream path differs.
                  </p>
                </div>
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
                onRefresh={() => loadCameras(true)}
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
