import { useState, useRef, useEffect } from 'react';
import { Upload, Image as ImageIcon, CheckCircle, AlertTriangle, Loader2, X } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { usePageTracking } from '@/hooks/usePageTracking';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { uploadAPI, camerasAPI } from '@/lib/api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Camera } from '@/types/parking';

interface DetectedVehicle {
  plateNumber: string;
  ownerName: string | null;
  contactNumber: string | null;
  registered: boolean;
  vehicleType: string;
}

interface UploadResult {
  success: boolean;
  message: string;
  imageUrl?: string;
  vehicleCount: number;
  violationsCreated: number;
  incidentsCreated: number;
  notificationsCreated: number;
  detectedVehicles?: DetectedVehicle[];
  results: {
    plateDetected: boolean;
    vehicleDetected: boolean;
    smsSent: boolean;
    barangayNotified: boolean;
  };
}

export default function UploadImage() {
  usePageTracking();
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [locationId, setLocationId] = useState<string>('');
  const [cameras, setCameras] = useState<Camera[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadCameras();
  }, []);

  const loadCameras = async () => {
    try {
      const data = await camerasAPI.getAll();
      setCameras(data);
      // Get unique locations
      const uniqueLocations = Array.from(new Set(data.map((c: Camera) => c.locationId))).sort();
      if (uniqueLocations.length > 0 && !locationId) {
        setLocationId(uniqueLocations[0] as string);
      }
    } catch (error) {
      console.error('Error loading cameras:', error);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid File",
        description: "Please select an image file",
        variant: "destructive",
      });
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "File Too Large",
        description: "Please select an image smaller than 10MB",
        variant: "destructive",
      });
      return;
    }

    // Read file as base64
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setSelectedImage(base64);
      setPreviewUrl(base64);
      setUploadResult(null);
    };
    reader.readAsDataURL(file);
  };

  const handleUpload = async () => {
    if (!selectedImage) {
      toast({
        title: "No Image Selected",
        description: "Please select an image to upload",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    setUploadResult(null);

    try {
      const result = await uploadAPI.analyze(selectedImage, locationId || undefined);
      setUploadResult(result);
      
      if (result.success) {
        toast({
          title: "Analysis Complete",
          description: result.message,
        });

        // Clear image after successful upload
        setTimeout(() => {
          setSelectedImage(null);
          setPreviewUrl(null);
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
        }, 5000);
      }
    } catch (error: any) {
      console.error('Upload error:', error);
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to analyze image. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleClear = () => {
    setSelectedImage(null);
    setPreviewUrl(null);
    setUploadResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const uniqueLocations = Array.from(new Set(cameras.map(c => c.locationId))).sort();

  return (
    <div className="min-h-screen">
      <Header 
        title="Upload Image for Analysis" 
        subtitle="Upload an image to detect vehicles and check for illegal parking"
      />

      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Upload Section */}
          <Card className="p-6">
            <div className="space-y-4">
              <div>
                <Label htmlFor="location" className="text-sm font-medium mb-2 block">
                  Location (Optional)
                </Label>
                <Select value={locationId} onValueChange={setLocationId}>
                  <SelectTrigger className="bg-secondary">
                    <SelectValue placeholder="Select location or enter custom" />
                  </SelectTrigger>
                  <SelectContent>
                    {uniqueLocations.map(location => (
                      <SelectItem key={location} value={location}>
                        {location}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="text"
                  placeholder="Or enter custom location"
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  className="mt-2 bg-secondary"
                />
              </div>

              <div>
                <Label htmlFor="image-upload" className="text-sm font-medium mb-2 block">
                  Select Image
                </Label>
                <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary transition-colors">
                  <input
                    ref={fileInputRef}
                    type="file"
                    id="image-upload"
                    accept="image/*"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  {!previewUrl ? (
                    <div className="space-y-4">
                      <Upload className="h-12 w-12 text-muted-foreground mx-auto" />
                      <div>
                        <Button
                          variant="outline"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Upload className="h-4 w-4 mr-2" />
                          Choose Image
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        PNG, JPG, JPEG up to 10MB
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <img
                        src={previewUrl}
                        alt="Preview"
                        className="max-h-64 mx-auto rounded-lg object-contain"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleClear}
                      >
                        <X className="h-4 w-4 mr-2" />
                        Remove Image
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              <Button
                onClick={handleUpload}
                disabled={!selectedImage || isUploading}
                className="w-full"
                size="lg"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <ImageIcon className="h-4 w-4 mr-2" />
                    Analyze Image
                  </>
                )}
              </Button>
            </div>
          </Card>

          {/* Results Section */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Analysis Results</h3>
            {!uploadResult && !isUploading && (
              <div className="text-center py-12 text-muted-foreground">
                <ImageIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Upload an image to see analysis results</p>
              </div>
            )}

            {isUploading && (
              <div className="text-center py-12">
                <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-primary" />
                <p className="text-muted-foreground">Analyzing image with AI...</p>
              </div>
            )}

            {uploadResult && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  {uploadResult.success ? (
                    <CheckCircle className="h-5 w-5 text-success" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                  )}
                  <span className="font-medium">{uploadResult.message}</span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 rounded-lg bg-muted">
                    <p className="text-xs text-muted-foreground mb-1">Vehicles Detected</p>
                    <p className="text-2xl font-bold">{uploadResult.vehicleCount}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted">
                    <p className="text-xs text-muted-foreground mb-1">Plate Detected</p>
                    <Badge variant={uploadResult.results.plateDetected ? "success" : "secondary"}>
                      {uploadResult.results.plateDetected ? "Yes" : "No"}
                    </Badge>
                  </div>
                </div>

                {/* Detected Vehicles with Plate Numbers and Owners */}
                {uploadResult.detectedVehicles && uploadResult.detectedVehicles.length > 0 && (
                  <div className="pt-4 border-t">
                    <p className="text-sm font-semibold mb-3">Detected Vehicles</p>
                    <div className="space-y-3">
                      {uploadResult.detectedVehicles.map((vehicle, index) => (
                        <div key={index} className="p-3 rounded-lg border bg-card">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-sm font-medium">Plate Number:</span>
                                {vehicle.plateNumber === 'NONE' ? (
                                  <Badge variant="secondary">Not Visible</Badge>
                                ) : (
                                  <Badge variant="outline" className="font-mono">
                                    {vehicle.plateNumber}
                                  </Badge>
                                )}
                              </div>
                              {vehicle.plateNumber !== 'NONE' && (
                                <>
                                  {vehicle.ownerName ? (
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="text-sm text-muted-foreground">Owner:</span>
                                      <span className="text-sm font-medium">{vehicle.ownerName}</span>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="text-sm text-muted-foreground">Owner:</span>
                                      <Badge variant="secondary">Not Registered</Badge>
                                    </div>
                                  )}
                                  {vehicle.contactNumber && (
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="text-sm text-muted-foreground">Contact:</span>
                                      <span className="text-sm">{vehicle.contactNumber}</span>
                                    </div>
                                  )}
                                </>
                              )}
                              {vehicle.vehicleType && vehicle.vehicleType !== 'none' && (
                                <div className="flex items-center gap-2 mt-2">
                                  <span className="text-sm text-muted-foreground">Type:</span>
                                  <Badge variant="outline" className="capitalize">
                                    {vehicle.vehicleType}
                                  </Badge>
                                </div>
                              )}
                            </div>
                            <div className="text-right">
                              {vehicle.plateNumber !== 'NONE' && (
                                <Badge variant={vehicle.registered ? "success" : "warning"} className="mb-1">
                                  {vehicle.registered ? "Registered" : "Unregistered"}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2 pt-4 border-t">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Viber Sent to Owner</span>
                    {uploadResult.results.smsSent ? (
                      <Badge variant="success">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Notified
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Not Notified</Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Barangay Notified</span>
                    {uploadResult.results.barangayNotified ? (
                      <Badge variant="warning">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        Notified
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Not Notified</Badge>
                    )}
                  </div>
                  {uploadResult.violationsCreated > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Violations Created</span>
                      <Badge variant="destructive">{uploadResult.violationsCreated}</Badge>
                    </div>
                  )}
                  {uploadResult.incidentsCreated > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Incidents Created</span>
                      <Badge variant="warning">{uploadResult.incidentsCreated}</Badge>
                    </div>
                  )}
                </div>

                {uploadResult.imageUrl && (
                  <div className="pt-4 border-t">
                    <p className="text-xs text-muted-foreground mb-2">Image saved</p>
                    <p className="text-xs font-mono text-muted-foreground break-all">
                      {uploadResult.imageUrl}
                    </p>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* Instructions */}
        <Card className="p-6 bg-muted/50">
          <h3 className="text-lg font-semibold mb-3">How It Works</h3>
          <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
            <li>Upload an image of an illegally parked vehicle</li>
            <li>AI analyzes the image to detect vehicles and license plates</li>
            <li>
              <strong>If plate is detected and registered:</strong> System automatically sends SMS warning to vehicle owner
            </li>
            <li>
              <strong>If plate is not visible:</strong> System notifies Barangay about illegally parked vehicle
            </li>
            <li>
              <strong>If vehicle is not registered:</strong> System creates incident and notifies Barangay
            </li>
          </ol>
        </Card>
      </div>
    </div>
  );
}

