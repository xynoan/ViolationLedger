import { useState, useEffect } from 'react';
import { Car, AlertTriangle, FileText, CheckCircle, Camera, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { usePageTracking } from '@/hooks/usePageTracking';
import { StatCard } from '@/components/dashboard/StatCard';
import { CameraFeed } from '@/components/dashboard/CameraFeed';
import { CaptureResults } from '@/components/dashboard/CaptureResults';
import { Button } from '@/components/ui/button';
import { Vehicle, Camera as CameraType, Violation } from '@/types/parking';
import { vehiclesAPI, camerasAPI, violationsAPI, detectionsAPI } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

export default function Dashboard() {
  usePageTracking();
  const navigate = useNavigate();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [cameras, setCameras] = useState<CameraType[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [allCaptures, setAllCaptures] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // Load data from API
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        const [vehiclesData, camerasData, violationsData, detectionsData] = await Promise.all([
          vehiclesAPI.getAll().catch(() => []),
          camerasAPI.getAll().catch(() => []),
          violationsAPI.getAll().catch(() => []),
          detectionsAPI.getAll().catch(() => []),
        ]);
        
        // Ensure deviceId is properly set for cameras
        const camerasWithDeviceId = camerasData.map((camera: any) => {
          const deviceIdValue = camera.deviceId && typeof camera.deviceId === 'string' && camera.deviceId.trim() 
            ? camera.deviceId.trim() 
            : undefined;
          return {
            ...camera,
            deviceId: deviceIdValue
          };
        });
        
        setVehicles(vehiclesData);
        setCameras(camerasWithDeviceId);
        setViolations(violationsData);
        // Count all detections (captures) - filter out "none" detections
        const validDetections = Array.isArray(detectionsData) 
          ? detectionsData.filter((d: any) => d.class_name && d.class_name.toLowerCase() !== 'none')
          : [];
        setAllCaptures(validDetections.length);
      } catch (error) {
        console.error('Error loading dashboard data:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to load dashboard data';
        toast({
          title: "Connection Error",
          description: errorMessage,
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
    
    // Refresh data every 30 seconds
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const activeWarnings = violations.filter(v => v.status === 'warning');
  const issuedTickets = violations.filter(v => v.status === 'issued');
  const clearedToday = violations.filter(v => v.status === 'cleared');
  const onlineCameras = cameras.filter(c => c.status === 'online');
  const firstOnlineCamera = onlineCameras[0];

  const hasData = vehicles.length > 0 || cameras.length > 0 || violations.length > 0;

  return (
    <div className="min-h-screen">
      <Header 
        title="Dashboard" 
        subtitle="Monitor parking violations in real-time"
      />

      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard
            title="Registered Vehicles"
            value={vehicles.length}
            icon={Car}
          />
          <StatCard
            title="Active Warnings"
            value={activeWarnings.length}
            icon={AlertTriangle}
            variant="warning"
          />
          <StatCard
            title="All Vehicle Captures"
            value={allCaptures}
            icon={Camera}
            variant="default"
          />
          <StatCard
            title="Cleared Today"
            value={clearedToday.length}
            icon={CheckCircle}
            variant="success"
          />
        </div>

        {!hasData ? (
          <div className="glass-card rounded-xl p-8 sm:p-12 text-center">
            <div className="max-w-md mx-auto">
              <Camera className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">Welcome to ViolationLedger</h3>
              <p className="text-muted-foreground mb-6">
                Get started by adding cameras and registering vehicles to begin monitoring parking violations
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button onClick={() => navigate('/cameras')}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Camera
                </Button>
                <Button variant="outline" onClick={() => navigate('/vehicles')}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Vehicle
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
            {/* Active Warnings */}
            <div className="lg:col-span-2 space-y-4 sm:space-y-6">
              <div className="space-y-4">
                <h2 className="text-base sm:text-lg font-semibold text-foreground flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 sm:h-5 sm:w-5 text-warning" />
                  Active Warnings
                  <span className="ml-2 px-2 py-0.5 rounded-full bg-warning/10 text-warning text-xs sm:text-sm">
                    {activeWarnings.length}
                  </span>
                </h2>
                <div className="glass-card rounded-xl p-6 sm:p-8 text-center">
                  <CheckCircle className="h-10 w-10 sm:h-12 sm:w-12 text-success mx-auto mb-3" />
                  <p className="text-muted-foreground text-sm sm:text-base">No active warnings</p>
                </div>
              </div>

              {/* Capture Results */}
              <div className="space-y-4">
                <h2 className="text-base sm:text-lg font-semibold text-foreground flex items-center gap-2">
                  <Camera className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                  Capture Results
                </h2>
                <CaptureResults />
              </div>
            </div>

            {/* Camera Feed */}
            <div className="space-y-4">
              <h2 className="text-base sm:text-lg font-semibold text-foreground">Camera Feed</h2>
              {firstOnlineCamera ? (
                <CameraFeed 
                  camera={firstOnlineCamera}
                  onRefresh={() => {
                    // Reload cameras when refresh is called
                    camerasAPI.getAll().then((data) => {
                      const camerasWithDeviceId = data.map((camera: any) => {
                        const deviceIdValue = camera.deviceId && typeof camera.deviceId === 'string' && camera.deviceId.trim() 
                          ? camera.deviceId.trim() 
                          : undefined;
                        return {
                          ...camera,
                          deviceId: deviceIdValue
                        };
                      });
                      setCameras(camerasWithDeviceId);
                    }).catch(console.error);
                  }}
                />
              ) : (
                <div className="glass-card rounded-xl p-6 text-center">
                  <Camera className="h-10 w-10 sm:h-12 sm:w-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground text-sm mb-4">
                    {cameras.length > 0 ? 'No online cameras' : 'No cameras configured'}
                  </p>
                  <Button size="sm" onClick={() => navigate('/cameras')}>
                    <Plus className="h-4 w-4 mr-2" />
                    {cameras.length > 0 ? 'View Cameras' : 'Add Camera'}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
