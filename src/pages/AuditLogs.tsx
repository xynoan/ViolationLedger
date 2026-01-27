import { useState, useEffect } from 'react';
import { FileText, Filter, RefreshCw, Calendar, User, Search, Trash2 } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { usePageTracking } from '@/hooks/usePageTracking';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { auditLogsAPI, usersAPI } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface AuditLog {
  id: string;
  userId: string;
  userEmail: string;
  userName: string | null;
  userRole: string;
  action: string;
  resource: string;
  resourceId: string | null;
  details: string;
  ipAddress: string;
  userAgent: string;
  timestamp: string;
}

interface User {
  id: string;
  email: string;
}

export default function AuditLogs() {
  usePageTracking();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState({
    userId: 'all',
    action: 'all',
    startDate: '',
    endDate: '',
  });
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  });
  const [stats, setStats] = useState<any>(null);
  const [showClearDialog, setShowClearDialog] = useState(false);

  useEffect(() => {
    loadUsers();
    loadStats();
  }, []);

  useEffect(() => {
    loadLogs();
  }, [filters, pagination.page]);

  const loadUsers = async () => {
    try {
      const data = await usersAPI.getAll();
      setUsers(data);
    } catch (error) {
      console.error('Error loading users:', error);
    }
  };

  const loadLogs = async () => {
    try {
      setIsLoading(true);
      const params: any = {
        page: pagination.page,
        limit: pagination.limit,
      };
      
      if (filters.userId !== 'all') {
        params.userId = filters.userId;
      }
      
      if (filters.action !== 'all') {
        params.action = filters.action;
      }
      
      if (filters.startDate) {
        params.startDate = new Date(filters.startDate).toISOString();
      }
      
      if (filters.endDate) {
        params.endDate = new Date(filters.endDate).toISOString();
      }

      const data = await auditLogsAPI.getAll(params);
      setLogs(data.logs);
      setPagination(data.pagination);
    } catch (error: any) {
      console.error('Error loading audit logs:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to load audit logs",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const params: any = {};
      if (filters.startDate) {
        params.startDate = new Date(filters.startDate).toISOString();
      }
      if (filters.endDate) {
        params.endDate = new Date(filters.endDate).toISOString();
      }
      const data = await auditLogsAPI.getStats(params);
      setStats(data);
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  const clearFilters = () => {
    setFilters({
      userId: 'all',
      action: 'all',
      startDate: '',
      endDate: '',
    });
    setPagination({ ...pagination, page: 1 });
  };

  const getActionBadgeVariant = (action: string) => {
    switch (action) {
      case 'create':
        return 'success';
      case 'update':
        return 'default';
      case 'delete':
        return 'destructive';
      case 'view':
        return 'secondary';
      case 'login':
        return 'default';
      default:
        return 'outline';
    }
  };

  const formatDetails = (details: string) => {
    try {
      const parsed = JSON.parse(details);
      return `${parsed.method} ${parsed.path}`;
    } catch {
      return details;
    }
  };

  const actionTypes = ['view', 'page_view', 'button_click', 'create', 'update', 'delete', 'login', 'logout', 'capture', 'upload', 'export', 'filter', 'search'];

  const handleClearLogs = async () => {
    try {
      await auditLogsAPI.clearAll();
      toast({
        title: "Success",
        description: "All audit logs have been cleared",
      });
      setShowClearDialog(false);
      loadLogs();
      loadStats();
    } catch (error: any) {
      console.error('Error clearing audit logs:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to clear audit logs",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen">
      <Header
        title="Audit Logs"
        subtitle="Track all user activities and system events"
        action={
          <div className="flex gap-2">
            <Button onClick={loadLogs} disabled={isLoading} variant="outline" size="sm">
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button 
              onClick={() => setShowClearDialog(true)} 
              disabled={isLoading || pagination.total === 0} 
              variant="destructive" 
              size="sm"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clear All
            </Button>
          </div>
        }
      />

      <div className="p-4 sm:p-6 space-y-6">
        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Logs</p>
                    <p className="text-2xl font-bold">{stats.total}</p>
                  </div>
                  <FileText className="h-8 w-8 text-primary" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Last 24h</p>
                    <p className="text-2xl font-bold">{stats.recent24h}</p>
                  </div>
                  <Calendar className="h-8 w-8 text-primary" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Actions</p>
                    <p className="text-2xl font-bold">{Object.keys(stats.byAction).length}</p>
                  </div>
                  <Search className="h-8 w-8 text-primary" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Active Users</p>
                    <p className="text-2xl font-bold">{stats.byUser.length}</p>
                  </div>
                  <User className="h-8 w-8 text-primary" />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Filters
            </CardTitle>
            <CardDescription>Filter audit logs by user, action, and date range</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="space-y-2">
                <Label>User</Label>
                <Select
                  value={filters.userId}
                  onValueChange={(value) => {
                    setFilters({ ...filters, userId: value });
                    setPagination({ ...pagination, page: 1 });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Users" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Users</SelectItem>
                    {users.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Action</Label>
                <Select
                  value={filters.action}
                  onValueChange={(value) => {
                    setFilters({ ...filters, action: value });
                    setPagination({ ...pagination, page: 1 });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Actions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Actions</SelectItem>
                    {actionTypes.map((action) => (
                      <SelectItem key={action} value={action}>
                        {action.charAt(0).toUpperCase() + action.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={filters.startDate}
                  onChange={(e) => {
                    setFilters({ ...filters, startDate: e.target.value });
                    setPagination({ ...pagination, page: 1 });
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => {
                    setFilters({ ...filters, endDate: e.target.value });
                    setPagination({ ...pagination, page: 1 });
                  }}
                />
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

        {/* Logs Table */}
        <Card>
          <CardHeader>
            <CardTitle>Activity Logs</CardTitle>
            <CardDescription>
              Showing {logs.length} of {pagination.total} logs
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-8">
                <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No audit logs found</p>
              </div>
            ) : (
              <>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Timestamp</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Resource</TableHead>
                        <TableHead>Details</TableHead>
                        <TableHead>IP Address</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="font-mono text-xs">
                            {new Date(log.timestamp).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <div>
                              <div className="font-medium">{log.userName || log.userEmail}</div>
                              <div className="text-xs text-muted-foreground">{log.userEmail}</div>
                              <Badge variant="outline" className="mt-1 text-xs">
                                {log.userRole}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={getActionBadgeVariant(log.action)}>
                              {log.action}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {log.resource}
                            {log.resourceId && (
                              <div className="text-xs text-muted-foreground font-mono">
                                {log.resourceId}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="max-w-xs truncate font-mono text-xs">
                            {formatDetails(log.details)}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {log.ipAddress}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                
                {/* Pagination */}
                {pagination.totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <div className="text-sm text-muted-foreground">
                      Page {pagination.page} of {pagination.totalPages}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPagination({ ...pagination, page: pagination.page - 1 })}
                        disabled={pagination.page === 1}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPagination({ ...pagination, page: pagination.page + 1 })}
                        disabled={pagination.page >= pagination.totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Clear Logs Confirmation Dialog */}
      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear All Audit Logs</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete all audit logs? This action cannot be undone. 
              All {pagination.total} log entries will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearLogs}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear All Logs
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

