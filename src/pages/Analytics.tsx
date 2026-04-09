import { useState, useEffect } from 'react';
import { 
  BarChart3, 
  Car, 
  AlertTriangle, 
  Camera, 
  MessageSquare, 
  FileText,
  Calendar,
  RefreshCw,
  Clock3,
  Repeat,
  ArrowUpRight,
  ArrowDownRight,
  Minus
} from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { usePageTracking } from '@/hooks/usePageTracking';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { analyticsAPI, camerasAPI, type AnalyticsResponse } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Camera as CameraType } from '@/types/parking';

const COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899'];
type TrendData = { currentTotal: number; previousTotal: number; delta: number; deltaPct: number };

function getTrendMeta(trend?: TrendData | null) {
  if (!trend) {
    return {
      Icon: Minus,
      tone: 'text-muted-foreground',
      label: 'No comparison available',
    };
  }

  if (trend.delta > 0) {
    return {
      Icon: ArrowUpRight,
      tone: 'text-destructive',
      label: `+${trend.deltaPct}% vs previous 7-day period`,
    };
  }

  if (trend.delta < 0) {
    return {
      Icon: ArrowDownRight,
      tone: 'text-green-600',
      label: `${trend.deltaPct}% vs previous 7-day period`,
    };
  }

  return {
    Icon: Minus,
    tone: 'text-muted-foreground',
    label: '0% vs previous 7-day period',
  };
}

function escapeCsvValue(value: unknown): string {
  const str = String(value ?? '');
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export default function Analytics() {
  usePageTracking();
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
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

  const handleExportReport = () => {
    if (!analytics) {
      toast({
        title: 'Export failed',
        description: 'No analytics data available to export.',
        variant: 'destructive',
      });
      return;
    }

    try {
      const generatedAt = new Date();
      const formattedDate = generatedAt.toISOString().slice(0, 10);
      const rows: string[] = [];
      const selectedLocation = locationFilter === 'all' ? 'All Locations' : locationFilter;

      rows.push('Analytics Report');
      rows.push(`Date Range Start,${escapeCsvValue(startDate || 'All')}`);
      rows.push(`Date Range End,${escapeCsvValue(endDate || 'All')}`);
      rows.push(`Location,${escapeCsvValue(selectedLocation)}`);
      rows.push(`Generated At,${escapeCsvValue(generatedAt.toISOString())}`);
      rows.push('');

      rows.push('Violations Over Time');
      rows.push('Date,Violations');
      if (violationsOverTimeData.length > 0) {
        for (const item of violationsOverTimeData) {
          rows.push(`${escapeCsvValue(item.date)},${escapeCsvValue(item.violations)}`);
        }
      } else {
        rows.push('No data,0');
      }
      rows.push('');

      rows.push('Top Violation Locations');
      rows.push('Location,Violations');
      if (violationsByLocationData.length > 0) {
        for (const item of violationsByLocationData) {
          rows.push(`${escapeCsvValue(item.cameraLocationId)},${escapeCsvValue(item.count)}`);
        }
      } else {
        rows.push('No data,0');
      }

      const csvContent = rows.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `analytics-report-${formattedDate}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: 'Export successful',
        description: `Saved analytics-report-${formattedDate}.csv`,
      });
    } catch (error) {
      toast({
        title: 'Export failed',
        description: error instanceof Error ? error.message : 'Unable to export CSV report',
        variant: 'destructive',
      });
    }
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
  const descriptive = analytics?.violations.descriptive;
  const byHourMap = new Map((analytics?.violations.byHour || []).map((item) => [item.hour, item.count]));
  const peakHoursData = Array.from({ length: 24 }, (_, hour) => ({
    hourLabel: `${hour.toString().padStart(2, '0')}:00`,
    count: byHourMap.get(hour) || 0,
  }));
  const hasPeakHoursData = peakHoursData.some((item) => item.count > 0);

  const violationTrendMeta = getTrendMeta(descriptive?.sevenDayComparison);
  const warningTrendMeta = getTrendMeta(analytics?.warnings.sevenDayComparison);

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
          <div className="flex items-center gap-2">
            <Button onClick={handleExportReport} variant="outline" size="sm">
              Export Report
            </Button>
            <Button onClick={loadAnalytics} disabled={isLoading} variant="outline" size="sm">
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
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
                  <div className={`mt-1 flex items-center gap-1 text-xs ${violationTrendMeta.tone}`}>
                    {(() => {
                      const TrendIcon = violationTrendMeta.Icon;
                      return <TrendIcon className="h-3 w-3" />;
                    })()}
                    <span>{violationTrendMeta.label}</span>
                  </div>
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
                  <div className={`mt-1 flex items-center gap-1 text-xs ${warningTrendMeta.tone}`}>
                    {(() => {
                      const TrendIcon = warningTrendMeta.Icon;
                      return <TrendIcon className="h-3 w-3" />;
                    })()}
                    <span>{warningTrendMeta.label}</span>
                  </div>
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
                  <p className="mt-1 text-xs text-muted-foreground">Filter-scoped total</p>
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
                  <p className="mt-1 text-xs text-muted-foreground">Filter-scoped total</p>
                </div>
                <Camera className="h-8 w-8 text-primary" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">SMS Sent</p>
                  <p className="text-2xl font-bold">{analytics.sms.total}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Filter-scoped total</p>
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
                  <p className="mt-1 text-xs text-muted-foreground">System inventory</p>
                </div>
                <Camera className="h-8 w-8 text-primary" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Descriptive Insights */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock3 className="h-5 w-5" />
                Average Duration of Infraction
              </CardTitle>
              <CardDescription>{descriptive?.avgInfractionToActionLabel || 'Average time from first detection to action in minutes'}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {descriptive?.avgInfractionToActionMinutes != null
                  ? `${Math.round(descriptive.avgInfractionToActionMinutes)} min`
                  : 'No data'}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Repeat className="h-5 w-5" />
                Repeat Offenders
              </CardTitle>
              <CardDescription>
                Vehicles with {descriptive?.repeatOffenders.threshold || 3}+ violations in selected period
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Unique Vehicles</span>
                <Badge variant="secondary">{descriptive?.repeatOffenders.uniqueVehicles || 0}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Recurring Vehicles</span>
                <Badge variant="destructive">{descriptive?.repeatOffenders.recurringVehicles || 0}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Recurring Share</span>
                <span className="font-semibold">{descriptive?.repeatOffenders.recurringPct?.toFixed(2) || '0.00'}%</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Period Comparison</CardTitle>
              <CardDescription>Compared to same span in previous month</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-sm flex items-center justify-between">
                <span className="text-muted-foreground">Current Period</span>
                <span className="font-medium">{descriptive?.periodComparison?.currentTotal ?? 0}</span>
              </div>
              <div className="text-sm flex items-center justify-between">
                <span className="text-muted-foreground">Previous Period</span>
                <span className="font-medium">{descriptive?.periodComparison?.previousTotal ?? 0}</span>
              </div>
              <div className={`text-sm flex items-center justify-between ${getTrendMeta(descriptive?.periodComparison).tone}`}>
                <span>Delta</span>
                <span className="font-semibold">{descriptive?.periodComparison?.delta ?? 0}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Peak Violation Hours */}
        <Card>
          <CardHeader>
            <CardTitle>Peak Violation Hours</CardTitle>
            <CardDescription>Violation volume by hour (00:00-23:00) for selected filters</CardDescription>
          </CardHeader>
          <CardContent>
            {hasPeakHoursData ? (
              <ChartContainer config={{ count: { label: 'Violations', color: '#ef4444' } }}>
                <BarChart data={peakHoursData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="hourLabel" interval={2} />
                  <YAxis />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" fill="#ef4444" />
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="h-[240px] flex items-center justify-center text-muted-foreground">
                No peak-hour data in selected filters
              </div>
            )}
          </CardContent>
        </Card>

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

