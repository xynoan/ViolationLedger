import { useState, useEffect } from 'react';
import { 
  BarChart3, 
  Car, 
  AlertTriangle, 
  Camera, 
  MessageSquare, 
  FileText,
  Calendar,
  RefreshCw
} from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { usePageTracking } from '@/hooks/usePageTracking';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { analyticsAPI, camerasAPI } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Camera as CameraType } from '@/types/parking';

interface AnalyticsData {
  users: {
    total: number;
    byRole: Record<string, number>;
  };
  vehicles: {
    total: number;
    bySource: Record<string, number>;
    registrationTrends: Array<{ date: string; count: number }>;
  };
  violations: {
    total: number;
    byStatus: Record<string, number>;
    byLocation: Array<{ cameraLocationId: string; count: number }>;
    overTime: Array<{ date: string; count: number }>;
    byHour: Array<{ hour: number; count: number }>;
  };
  warnings: {
    total: number;
    overTime: Array<{ date: string; count: number }>;
    converted: number;
    conversionRate: string;
  };
  detections: {
    total: number;
    byClass: Record<string, number>;
    overTime: Array<{ date: string; count: number }>;
  };
  sms: {
    total: number;
    byStatus: Record<string, number>;
  };
  incidents: {
    total: number;
    byStatus: Record<string, number>;
  };
  cameras: {
    total: number;
    byStatus: Record<string, number>;
  };
  recent: {
    violations: number;
    vehicles: number;
    detections: number;
  };
}

const COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899'];

export default function Analytics() {
  usePageTracking();
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [cameras, setCameras] = useState<CameraType[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [locationFilter, setLocationFilter] = useState('all');

  useEffect(() => {
    loadCameras();
    loadAnalytics();
  }, []);

  useEffect(() => {
    loadAnalytics();
  }, [startDate, endDate, locationFilter]);

  const loadCameras = async () => {
    try {
      const data = await camerasAPI.getAll();
      setCameras(data);
    } catch (error) {
      console.error('Error loading cameras:', error);
    }
  };

  const loadAnalytics = async () => {
    try {
      setIsLoading(true);
      const filters: any = {};
      if (startDate) filters.startDate = new Date(startDate).toISOString();
      if (endDate) filters.endDate = new Date(endDate).toISOString();
      if (locationFilter !== 'all') filters.locationId = locationFilter;

      const data = await analyticsAPI.getAll(filters);
      setAnalytics(data);
    } catch (error) {
      console.error('Error loading analytics:', error);
      toast({
        title: "Error",
        description: "Failed to load analytics data",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const clearFilters = () => {
    setStartDate('');
    setEndDate('');
    setLocationFilter('all');
  };

  const uniqueLocations = Array.from(new Set(cameras.map(c => c.locationId))).sort();

  // Prepare chart data - only essential charts
  const violationsOverTimeData = analytics?.violations.overTime
    .map(item => ({
      date: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      violations: item.count
    }))
    .reverse() || [];

  const violationsByLocationData = analytics?.violations.byLocation.slice(0, 10) || [];

  const violationsByStatusData = Object.entries(analytics?.violations.byStatus || {}).map(([status, count]) => ({
    name: status.charAt(0).toUpperCase() + status.slice(1),
    value: count
  }));

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <Header title="Analytics" subtitle="Key system statistics and insights" />
        <div className="p-6 flex items-center justify-center">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="min-h-screen">
        <Header title="Analytics" subtitle="Key system statistics and insights" />
        <div className="p-6">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-8">
                <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">Failed to load analytics data</p>
                <Button onClick={loadAnalytics} className="mt-4" variant="outline">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header 
        title="Analytics" 
        subtitle="Comprehensive system statistics and insights"
        action={
          <Button onClick={loadAnalytics} disabled={isLoading} variant="outline" size="sm">
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        }
      />

      <div className="p-4 sm:p-6 space-y-6">
        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Filters
            </CardTitle>
            <CardDescription>Filter analytics by date range and location</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Location</Label>
                <Select value={locationFilter} onValueChange={setLocationFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Locations" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Locations</SelectItem>
                    {uniqueLocations.map(location => (
                      <SelectItem key={location} value={location}>
                        {location}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>&nbsp;</Label>
                <Button onClick={clearFilters} variant="outline" className="w-full">
                  Clear Filters
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Overview Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Violations</p>
                  <p className="text-2xl font-bold">{analytics.violations.total}</p>
                </div>
                <FileText className="h-8 w-8 text-destructive" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Warnings</p>
                  <p className="text-2xl font-bold">{analytics.warnings.total}</p>
                </div>
                <AlertTriangle className="h-8 w-8 text-yellow-500" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Vehicles</p>
                  <p className="text-2xl font-bold">{analytics.vehicles.total}</p>
                </div>
                <Car className="h-8 w-8 text-primary" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Detections</p>
                  <p className="text-2xl font-bold">{analytics.detections.total}</p>
                </div>
                <Camera className="h-8 w-8 text-primary" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Viber Sent</p>
                  <p className="text-2xl font-bold">{analytics.sms.total}</p>
                </div>
                <MessageSquare className="h-8 w-8 text-primary" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Cameras</p>
                  <p className="text-2xl font-bold">{analytics.cameras.total}</p>
                </div>
                <Camera className="h-8 w-8 text-primary" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Key Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Violations Over Time */}
          <Card>
            <CardHeader>
              <CardTitle>Violations Over Time</CardTitle>
              <CardDescription>Daily violation count for the last 30 days</CardDescription>
            </CardHeader>
            <CardContent>
              {violationsOverTimeData.length > 0 ? (
                <ChartContainer config={{ violations: { label: 'Violations', color: '#ef4444' } }}>
                  <LineChart data={violationsOverTimeData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line type="monotone" dataKey="violations" stroke="#ef4444" strokeWidth={2} />
                  </LineChart>
                </ChartContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  No data available
                </div>
              )}
            </CardContent>
          </Card>

          {/* Violations by Status */}
          <Card>
            <CardHeader>
              <CardTitle>Violations by Status</CardTitle>
              <CardDescription>Distribution of violations by status</CardDescription>
            </CardHeader>
            <CardContent>
              {violationsByStatusData.length > 0 ? (
                <ChartContainer config={violationsByStatusData.reduce((acc, item) => {
                  acc[item.name.toLowerCase()] = { label: item.name, color: COLORS[violationsByStatusData.indexOf(item) % COLORS.length] };
                  return acc;
                }, {} as Record<string, { label: string; color: string }>)}>
                  <PieChart>
                    <Pie
                      data={violationsByStatusData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {violationsByStatusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent />} />
                  </PieChart>
                </ChartContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  No data available
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Top Violation Locations */}
        <Card>
          <CardHeader>
            <CardTitle>Top Violation Locations</CardTitle>
            <CardDescription>Violations by location (Top 10)</CardDescription>
          </CardHeader>
          <CardContent>
            {violationsByLocationData.length > 0 ? (
              <ChartContainer config={{ count: { label: 'Violations', color: '#8b5cf6' } }}>
                <BarChart data={violationsByLocationData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="cameraLocationId" type="category" width={100} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" fill="#8b5cf6" />
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                No data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

