import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Car, Bike, Truck, Bus, Image as ImageIcon, Calendar, Clock, ZoomIn, ChevronDown, Eye } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Camera as CameraType } from '@/types/parking';
import { camerasAPI, detectionsAPI } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  getDwellMinutes,
  getDwellStatus,
  getDwellBadgeClasses,
  getDwellToneLabel,
  formatDuration,
} from '@/lib/captureInsights';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

function isReadablePlate(pn: unknown): boolean {
  if (pn == null || typeof pn !== 'string') return false;
  const u = pn.trim().toUpperCase();
  return u !== '' && u !== 'NONE' && u !== 'BLUR';
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const SERVER_BASE_URL = API_BASE_URL.replace('/api', '');

interface CaptureResult {
  cameraId: string;
  cameraName: string;
  locationId: string;
  timestamp: string;
  firstDetected: string;
  lastSeen: string;
  imageUrl: string | null;
  imageBase64: string | null;
  detections: Array<{
    class_name: string;
    bbox: number[];
    plateNumber?: string;
  }>;
}

interface CaptureResultsProps {
  autoRefresh?: boolean;
}

export function CaptureResults({ autoRefresh = true }: CaptureResultsProps) {
  const navigate = useNavigate();
  const [captureResults, setCaptureResults] = useState<CaptureResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [cameras, setCameras] = useState<CameraType[]>([]);
  const [selectedImage, setSelectedImage] = useState<{ src: string; alt: string } | null>(null);

  useEffect(() => {
    loadCaptureResults();
    if (!autoRefresh) return;
    // Refresh more frequently for near real-time updates
    const interval = setInterval(loadCaptureResults, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const loadCaptureResults = async () => {
    try {
      setIsLoading(true);
      
      const camerasData = await camerasAPI.getAll();
      setCameras(camerasData);
      
      // Group detections by camera and timestamp - show ALL captures, not just latest
      const resultsMap = new Map<string, CaptureResult>();
      
      for (const camera of camerasData) {
        try {
          const detections = await detectionsAPI.getByCamera(camera.id);
          
          if (detections && detections.length > 0) {
            const groupedByTimestamp = new Map<string, typeof detections>();
            
            for (const detection of detections) {
              const timestamp = typeof detection.timestamp === 'string' 
                ? detection.timestamp 
                : detection.timestamp instanceof Date 
                  ? detection.timestamp.toISOString()
                  : String(detection.timestamp);
              
              if (!groupedByTimestamp.has(timestamp)) {
                groupedByTimestamp.set(timestamp, []);
              }
              groupedByTimestamp.get(timestamp)!.push(detection);
            }
            
            // Create a CaptureResult for EACH timestamp, not just the latest
            const timestamps = Array.from(groupedByTimestamp.keys()).sort().reverse();
            
            for (const timestamp of timestamps) {
              const timestampDetections = groupedByTimestamp.get(timestamp) || [];
              
              // Filter out "none" detections (empty captures) but still show the capture
              const validDetections = timestampDetections.filter((d: any) => 
                d.class_name && d.class_name.toLowerCase() !== 'none'
              );
              
              // Use a unique key that includes both camera ID and timestamp
              const key = `${camera.id}-${timestamp}`;
              
              // Get the first detection with image data for this timestamp
              const detectionWithImage = timestampDetections.find((d: any) => 
                d.imageUrl || d.imageBase64
              ) || timestampDetections[0];
              
              resultsMap.set(key, {
                cameraId: camera.id,
                cameraName: camera.name,
                locationId: camera.locationId,
                timestamp: timestamp,
                firstDetected: timestamp,
                lastSeen: timestamp,
                imageUrl: detectionWithImage?.imageUrl || null,
                imageBase64: detectionWithImage?.imageBase64 || null,
                detections: validDetections.map((d: any) => ({
                  class_name: d.class_name || 'vehicle',
                  bbox: d.bbox || [],
                  plateNumber: d.plateNumber,
                }))
              });
            }
          }
        } catch (error) {
          console.error(`Error loading detections for camera ${camera.id}:`, error);
        }
      }
      
      const results = Array.from(resultsMap.values()).sort((a, b) => {
        const timeA = new Date(a.timestamp).getTime();
        const timeB = new Date(b.timestamp).getTime();
        return timeB - timeA;
      });
      
      setCaptureResults(results);
    } catch (error) {
      console.error('Error loading capture results:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getVehicleCounts = (detections: CaptureResult['detections']) => {
    const counts = {
      car: 0,
      motorcycle: 0,
      truck: 0,
      bus: 0,
      total: detections.length
    };
    
    detections.forEach(d => {
      const className = d.class_name.toLowerCase();
      if (className === 'car') counts.car++;
      else if (className === 'motorcycle') counts.motorcycle++;
      else if (className === 'truck') counts.truck++;
      else if (className === 'bus') counts.bus++;
    });
    
    return counts;
  };

  const getVehicleIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'car': return Car;
      case 'motorcycle': return Bike;
      case 'truck': return Truck;
      case 'bus': return Bus;
      default: return Car;
    }
  };

  const getImageSrc = (result: CaptureResult): string | null => {
    // Prefer base64 if available, otherwise use imageUrl
    if (result.imageBase64) {
      // Ensure base64 has data URL prefix
      if (result.imageBase64.startsWith('data:')) {
        return result.imageBase64;
      }
      return `data:image/jpeg;base64,${result.imageBase64}`;
    }
    if (result.imageUrl) {
      return `${SERVER_BASE_URL}/captured_images/${result.imageUrl.split(/[/\\]/).pop()}`;
    }
    return null;
  };

  const handleImageClick = (result: CaptureResult) => {
    const imageSrc = getImageSrc(result);
    if (imageSrc) {
      setSelectedImage({
        src: imageSrc,
        alt: `Capture from ${result.cameraName} at ${new Date(result.timestamp).toLocaleString()}`
      });
    }
  };

  if (isLoading) {
    return (
      <div className="glass-card rounded-xl p-6 text-center">
        <p className="text-muted-foreground">Loading capture results...</p>
      </div>
    );
  }

  if (captureResults.length === 0) {
    return (
      <div className="glass-card rounded-xl p-6 sm:p-8 text-center">
        <Camera className="h-10 w-10 sm:h-12 sm:w-12 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground text-sm sm:text-base">No capture results yet</p>
        <p className="text-xs text-muted-foreground mt-2">Captures will appear here after the first analysis</p>
      </div>
    );
  }

  // Show only first 4 results, hide the rest
  const firstFour = captureResults.slice(0, 4);

  const renderCaptureResult = (result: CaptureResult) => {
    const counts = getVehicleCounts(result.detections);
    const readablePlates = result.detections.filter((d) => isReadablePlate(d.plateNumber));
    const captureDate = new Date(result.timestamp);
    const dwellStatus = getDwellStatus(getDwellMinutes(result.firstDetected, result.lastSeen));
    
    const imageSrc = getImageSrc(result);
    const hasImage = imageSrc !== null;
    
    return (
      <div key={`${result.cameraId}-${result.timestamp}`} className="glass-card rounded-xl overflow-hidden animate-slide-up">
        <Collapsible className="group">
          <CollapsibleTrigger className="w-full">
            <div className="w-full p-4 border-b border-border cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div
                  className="h-[50px] w-[50px] shrink-0 rounded-lg overflow-hidden border bg-muted cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleImageClick(result);
                  }}
                >
                  {hasImage ? (
                    <img src={imageSrc} alt={`Capture from ${result.cameraName}`} className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center">
                      <ImageIcon className="h-4 w-4 text-muted-foreground/70" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Camera className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-foreground">{result.cameraName}</span>
                    <Badge variant="secondary" className="text-xs">{result.locationId}</Badge>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground mt-2">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {captureDate.toLocaleDateString()}
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {captureDate.toLocaleTimeString()}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Badge variant="outline" className={cn('ml-2 border', getDwellBadgeClasses(dwellStatus.tone))}>
                    {dwellStatus.label}
                  </Badge>
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </div>
              </div>
            </div>
          </CollapsibleTrigger>
          
          <CollapsibleContent>
            <div className="p-4">
              <div className="mb-4 rounded-lg border bg-muted/30 p-3">
                <p className="text-xs font-semibold text-foreground mb-2">Vehicle Timeline</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">First Detected</p>
                    <p className="font-medium">{new Date(result.firstDetected).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Last Seen</p>
                    <p className="font-medium">{new Date(result.lastSeen).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Dwell Duration</p>
                    <p className="font-medium">{formatDuration(dwellStatus.minutes)} ({getDwellToneLabel(dwellStatus.tone)})</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/warnings?cameraId=${encodeURIComponent(result.cameraId)}&locationId=${encodeURIComponent(result.locationId)}`);
                    }}
                  >
                    Issue Warning
                  </Button>
                  <Button
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/violations?cameraId=${encodeURIComponent(result.cameraId)}&locationId=${encodeURIComponent(result.locationId)}`);
                    }}
                  >
                    File Violation
                  </Button>
                </div>
              </div>
              {hasImage ? (
                <div 
                  className="relative rounded-lg overflow-hidden bg-muted aspect-video mb-4 cursor-pointer group transition-all hover:opacity-90 hover:ring-2 hover:ring-primary/50"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleImageClick(result);
                  }}
                >
                  <img
                    src={imageSrc}
                    alt={`Capture from ${result.cameraName}`}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      const fallback = target.nextElementSibling as HTMLElement;
                      if (fallback) {
                        target.style.display = 'none';
                        fallback.style.display = 'flex';
                      }
                    }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="flex items-center gap-2 text-white">
                      <ZoomIn className="h-5 w-5" />
                      <span className="text-sm font-medium">Click to view full image</span>
                    </div>
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center bg-muted" style={{ display: 'none' }}>
                    <div className="text-center">
                      <ImageIcon className="h-12 w-12 text-muted-foreground/50 mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground">Image not available</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="relative rounded-lg overflow-hidden bg-muted aspect-video mb-4 flex items-center justify-center">
                  <div className="text-center">
                    <ImageIcon className="h-12 w-12 text-muted-foreground/50 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">Image not available</p>
                  </div>
                </div>
              )}
              
              {counts.total > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground mb-2">Detected Vehicles:</p>
                  {readablePlates.length > 0 && (
                    <div className="mb-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
                      <p className="font-medium text-foreground mb-1.5">Plate reads</p>
                      <ul className="space-y-1 text-muted-foreground">
                        {readablePlates.map((d, idx) => (
                          <li key={idx} className="font-mono">
                            {String(d.plateNumber).trim().toUpperCase()}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {counts.car > 0 && (
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
                        <Car className="h-4 w-4 text-blue-500" />
                        <span className="text-xs font-medium">{counts.car} Car{counts.car !== 1 ? 's' : ''}</span>
                      </div>
                    )}
                    {counts.motorcycle > 0 && (
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                        <Bike className="h-4 w-4 text-yellow-500" />
                        <span className="text-xs font-medium">{counts.motorcycle} Motorcycle{counts.motorcycle !== 1 ? 's' : ''}</span>
                      </div>
                    )}
                    {counts.truck > 0 && (
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20">
                        <Truck className="h-4 w-4 text-red-500" />
                        <span className="text-xs font-medium">{counts.truck} Truck{counts.truck !== 1 ? 's' : ''}</span>
                      </div>
                    )}
                    {counts.bus > 0 && (
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-green-500/10 border border-green-500/20">
                        <Bus className="h-4 w-4 text-green-500" />
                        <span className="text-xs font-medium">{counts.bus} Bus{counts.bus !== 1 ? 'es' : ''}</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground">0 detected illegal parks</p>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Show only first 4 results, rest are hidden */}
      {firstFour.map(renderCaptureResult)}
      
      {/* View All button */}
      {captureResults.length > 4 && (
        <div className="flex justify-center pt-2">
          <Button 
            variant="outline" 
            onClick={() => navigate('/tickets')}
            className="w-full sm:w-auto"
          >
            <Eye className="h-4 w-4 mr-2" />
            View All ({captureResults.length} captures)
          </Button>
        </div>
      )}
      
      <Dialog open={!!selectedImage} onOpenChange={(open) => !open && setSelectedImage(null)}>
        <DialogContent className="max-w-4xl w-full p-0">
          <DialogHeader className="p-6 pb-4">
            <DialogTitle>Capture Image</DialogTitle>
            <DialogDescription>
              {selectedImage?.alt}
            </DialogDescription>
          </DialogHeader>
          {selectedImage && (
            <div className="p-6 pt-0">
              <img
                src={selectedImage.src}
                alt={selectedImage.alt}
                className="w-full h-auto rounded-lg"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                  const errorDiv = target.nextElementSibling as HTMLElement;
                  if (errorDiv) {
                    errorDiv.style.display = 'flex';
                  }
                }}
              />
              <div className="hidden items-center justify-center p-12 bg-muted rounded-lg">
                <div className="text-center">
                  <ImageIcon className="h-16 w-16 text-muted-foreground/50 mx-auto mb-4" />
                  <p className="text-sm text-muted-foreground">Failed to load image</p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

