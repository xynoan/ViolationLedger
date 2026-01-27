import { useState, useEffect } from 'react';
import { FileText, Search, Filter, Download, Calendar, MapPin, BarChart3, TrendingUp } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { usePageTracking } from '@/hooks/usePageTracking';
import { trackAction } from '@/lib/auditTracking';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Violation, ViolationStatus } from '@/types/parking';
import { violationsAPI, camerasAPI } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Camera } from '@/types/parking';

const STATUS_OPTIONS: { value: ViolationStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All Statuses' },
  { value: 'warning', label: 'Warning' },
  { value: 'issued', label: 'Issued' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'cleared', label: 'Cleared' },
  { value: 'pending', label: 'Pending' },
  { value: 'cancelled', label: 'Cancelled' },
];

interface ViolationStats {
  total: number;
  byStatus: Record<string, number>;
  byLocation: Array<{ cameraLocationId: string; count: number }>;
  byDate: Array<{ date: string; count: number }>;
}

export default function ViolationsHistory() {
  usePageTracking();
  const [violations, setViolations] = useState<Violation[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [stats, setStats] = useState<ViolationStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  
  // Filters
  const [statusFilter, setStatusFilter] = useState<ViolationStatus | 'all'>('all');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');

  useEffect(() => {
    loadCameras();
    loadViolations();
    loadStats();
  }, []);

  useEffect(() => {
    loadViolations();
    loadStats();
  }, [statusFilter, locationFilter, startDate, endDate, searchTerm]);

  const loadCameras = async () => {
    try {
      const data = await camerasAPI.getAll();
      setCameras(data);
    } catch (error) {
      console.error('Error loading cameras:', error);
    }
  };

  const loadViolations = async () => {
    try {
      setIsLoading(true);
      const filters: any = {};
      
      if (statusFilter !== 'all') {
        filters.status = statusFilter;
      }
      if (locationFilter !== 'all') {
        filters.locationId = locationFilter;
      }
      if (startDate) {
        filters.startDate = new Date(startDate).toISOString();
      }
      if (endDate) {
        filters.endDate = new Date(endDate).toISOString();
      }
      if (searchTerm) {
        filters.plateNumber = searchTerm;
      }

      const data = await violationsAPI.getAll(filters);
      const processedViolations = data.map((v: any) => ({
        ...v,
        timeDetected: new Date(v.timeDetected),
        timeIssued: v.timeIssued ? new Date(v.timeIssued) : undefined,
        warningExpiresAt: v.warningExpiresAt ? new Date(v.warningExpiresAt) : undefined,
      }));
      setViolations(processedViolations);
    } catch (error) {
      console.error('Error loading violations:', error);
      toast({
        title: "Error",
        description: "Failed to load violations. Make sure the backend server is running.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      setIsLoadingStats(true);
      const filters: any = {};
      
      if (startDate) {
        filters.startDate = new Date(startDate).toISOString();
      }
      if (endDate) {
        filters.endDate = new Date(endDate).toISOString();
      }
      if (locationFilter !== 'all') {
        filters.locationId = locationFilter;
      }

      const data = await violationsAPI.getStats(filters);
      setStats(data);
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setIsLoadingStats(false);
    }
  };

  const getStatusBadge = (status: ViolationStatus) => {
    const configs: Record<ViolationStatus, { variant: 'default' | 'secondary' | 'destructive' | 'warning' | 'success'; label: string }> = {
      warning: { variant: 'warning', label: 'Warning' },
      issued: { variant: 'destructive', label: 'Issued' },
      resolved: { variant: 'success', label: 'Resolved' },
      cleared: { variant: 'secondary', label: 'Cleared' },
      pending: { variant: 'default', label: 'Pending' },
      cancelled: { variant: 'secondary', label: 'Cancelled' },
    };
    const config = configs[status] || { variant: 'default', label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const exportToCSV = async () => {
    // Track export action
    await trackAction('export', 'violations', null, { format: 'csv', count: violations.length });
    
    const headers = ['ID', 'Ticket ID', 'Plate Number', 'Location', 'Status', 'Time Detected', 'Time Issued', 'Warning Expires At'];
    const rows = violations.map(v => [
      v.id,
      v.ticketId || '',
      v.plateNumber,
      v.cameraLocationId,
      v.status,
      v.timeDetected.toISOString(),
      v.timeIssued?.toISOString() || '',
      v.warningExpiresAt?.toISOString() || '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `violations_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Export Successful",
      description: "Violations data exported to CSV",
    });
  };

  const clearFilters = () => {
    setStatusFilter('all');
    setLocationFilter('all');
    setStartDate('');
    setEndDate('');
    setSearchTerm('');
  };

  const uniqueLocations = Array.from(new Set(cameras.map(c => c.locationId))).sort();

  return (
    <div className="min-h-screen">
      <Header 
        title="Violations History" 
        subtitle="View and manage all parking violations"
      />

      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* Statistics Cards */}
        {stats && !isLoadingStats && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="glass-card rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Violations</p>
                  <p className="text-2xl font-bold text-foreground mt-1">{stats.total}</p>
                </div>
                <BarChart3 className="h-8 w-8 text-primary" />
              </div>
            </div>
            <div className="glass-card rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Active Warnings</p>
                  <p className="text-2xl font-bold text-warning mt-1">{stats.byStatus.warning || 0}</p>
                </div>
                <TrendingUp className="h-8 w-8 text-warning" />
              </div>
            </div>
            <div className="glass-card rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Tickets Issued</p>
                  <p className="text-2xl font-bold text-destructive mt-1">{stats.byStatus.issued || 0}</p>
                </div>
                <FileText className="h-8 w-8 text-destructive" />
              </div>
            </div>
            <div className="glass-card rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Resolved</p>
                  <p className="text-2xl font-bold text-success mt-1">{stats.byStatus.resolved || 0}</p>
                </div>
                <TrendingUp className="h-8 w-8 text-success" />
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="glass-card rounded-xl p-4 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="h-5 w-5 text-muted-foreground" />
            <h3 className="font-semibold text-foreground">Filters</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Status</label>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as ViolationStatus | 'all')}>
                <SelectTrigger className="bg-secondary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Location</label>
              <Select value={locationFilter} onValueChange={setLocationFilter}>
                <SelectTrigger className="bg-secondary">
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
              <label className="text-sm font-medium text-foreground">Start Date</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-secondary"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">End Date</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-secondary"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Search Plate</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Plate number..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bg-secondary pl-9"
                />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-4">
            <Button variant="outline" onClick={clearFilters} size="sm">
              Clear Filters
            </Button>
            <Button onClick={exportToCSV} size="sm" className="ml-auto">
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Violations Table */}
        {isLoading ? (
          <div className="glass-card rounded-xl p-8 sm:p-12 text-center">
            <p className="text-muted-foreground">Loading violations...</p>
          </div>
        ) : violations.length > 0 ? (
          <div className="glass-card rounded-xl overflow-hidden">
            <div className="p-4 border-b border-border">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-foreground">
                  {violations.length} violation{violations.length !== 1 ? 's' : ''} found
                </h3>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground">Plate Number</TableHead>
                    <TableHead className="text-muted-foreground">Location</TableHead>
                    <TableHead className="text-muted-foreground">Status</TableHead>
                    <TableHead className="text-muted-foreground">Time Detected</TableHead>
                    <TableHead className="text-muted-foreground">Time Issued</TableHead>
                    <TableHead className="text-muted-foreground">Ticket ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {violations.map((violation) => (
                    <TableRow key={violation.id} className="border-border">
                      <TableCell className="font-mono font-medium">{violation.plateNumber}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                          {violation.cameraLocationId}
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(violation.status)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4" />
                          {violation.timeDetected.toLocaleString()}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {violation.timeIssued ? violation.timeIssued.toLocaleString() : '-'}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {violation.ticketId || '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : (
          <div className="glass-card rounded-xl p-8 sm:p-12 text-center">
            <FileText className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No Violations Found</h3>
            <p className="text-muted-foreground">
              {searchTerm || statusFilter !== 'all' || locationFilter !== 'all' || startDate || endDate
                ? 'Try adjusting your filters'
                : 'No violations recorded yet'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

