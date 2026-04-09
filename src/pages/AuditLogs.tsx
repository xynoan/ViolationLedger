import { useState, useEffect, useCallback, useMemo } from 'react';
import { FileText, Filter, RefreshCw, Calendar, User, Search, Trash2, Info } from 'lucide-react';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  humanizeAction,
  humanizeResource,
  friendlyDetails,
  formatLogTimestamp,
  getActionTone,
  ACTION_BADGE_CLASSES,
} from '@/lib/auditLogLabels';

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

interface AuditLogStats {
  total: number;
  recent24h: number;
  byAction: Record<string, number>;
  byUser: Array<{
    userId: string;
    count: number;
  }>;
}

function formatRoleLabel(role: string): string {
  if (!role) return 'User';
  return role
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

const actionTypes = [
  'view',
  'page_view',
  'button_click',
  'create',
  'update',
  'delete',
  'login',
  'logout',
  'capture',
  'upload',
  'export',
  'filter',
  'search',
];

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
  const [stats, setStats] = useState<AuditLogStats | null>(null);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter((log) => {
      const actionText = humanizeAction(log.action).toLowerCase();
      const resourceText = humanizeResource(log.resource).toLowerCase();
      const detailsText = friendlyDetails(log.details, log.resource).toLowerCase();
      const userText = `${log.userName || ''} ${log.userEmail} ${log.userRole || ''}`.toLowerCase();
      const idText = (log.resourceId || '').toLowerCase();
      return (
        actionText.includes(q) ||
        resourceText.includes(q) ||
        detailsText.includes(q) ||
        userText.includes(q) ||
        idText.includes(q) ||
        log.action.toLowerCase().includes(q)
      );
    });
  }, [logs, searchQuery]);

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

  const loadStats = useCallback(async () => {
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
  }, [filters.startDate, filters.endDate]);

  const clearFilters = () => {
    setFilters({
      userId: 'all',
      action: 'all',
      startDate: '',
      endDate: '',
    });
    setSearchQuery('');
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

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

  if (isLoading && logs.length === 0) {
    return (
      <div className="min-h-screen">
        <Header title="Activity Logs" subtitle="A clear view of who did what in the system" />
        <div className="p-4 sm:p-6 flex items-center justify-center min-h-[50vh]">
          <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
      <div className="min-h-screen">
      <Header
        title="Activity Logs"
        subtitle="A clear view of who did what in the system"
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
            <CardDescription>
              Filter by user, action type, and date range. Use the search field on the activity table to narrow
              results on the current page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="space-y-2">
                <Label>User</Label>
                <Select
                  value={filters.userId}
                  onValueChange={(value) => {
                    setFilters({ ...filters, userId: value });
                    setPagination((prev) => ({ ...prev, page: 1 }));
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
                    setPagination((prev) => ({ ...prev, page: 1 }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Actions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All actions</SelectItem>
                    {actionTypes.map((action) => (
                      <SelectItem key={action} value={action}>
                        {humanizeAction(action)}
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
                    setPagination((prev) => ({ ...prev, page: 1 }));
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
                    setPagination((prev) => ({ ...prev, page: 1 }));
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>&nbsp;</Label>
                <Button
                  onClick={clearFilters}
                  variant="destructive"
                  className="w-full"
                >
                  Clear Filters
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Logs Table */}
        <Card>
          <CardHeader className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-xl">Activity timeline</CardTitle>
                <CardDescription className="mt-1">
                  {searchQuery.trim()
                    ? `Showing ${filteredLogs.length} matching entries on this page (${logs.length} loaded)`
                    : `Showing ${logs.length} of ${pagination.total} logs`}
                </CardDescription>
              </div>
              <div className="relative w-full sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search this page…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 bg-secondary"
                  aria-label="Search activity logs on current page"
                />
              </div>
            </div>
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
            ) : filteredLogs.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-muted-foreground">No entries match your search.</p>
                <Button variant="link" className="mt-2" onClick={() => setSearchQuery('')}>
                  Clear search
                </Button>
              </div>
            ) : (
              <>
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-b hover:bg-transparent">
                        <TableHead className="min-w-[140px] py-4 text-muted-foreground font-medium">When</TableHead>
                        <TableHead className="min-w-[150px] py-4 text-muted-foreground font-medium">User</TableHead>
                        <TableHead className="min-w-[120px] py-4 text-muted-foreground font-medium">Action</TableHead>
                        <TableHead className="min-w-[130px] py-4 text-muted-foreground font-medium">Area</TableHead>
                        <TableHead className="min-w-[200px] py-4 text-muted-foreground font-medium">Summary</TableHead>
                        <TableHead className="w-11 py-4 text-center text-muted-foreground font-medium" aria-label="Technical details">
                          <span className="sr-only">Info</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLogs.map((log) => {
                        const tone = getActionTone(log.action);
                        const displayName =
                          log.userName?.trim() ||
                          log.userEmail
                            .split('@')[0]
                            .replace(/[._-]/g, ' ')
                            .replace(/\b\w/g, (c) => c.toUpperCase());
                        return (
                          <TableRow
                            key={log.id}
                            className="align-top border-border transition-colors hover:bg-gray-50 dark:hover:bg-muted/35"
                          >
                            <TableCell className="py-5 text-sm text-foreground tabular-nums">
                              {formatLogTimestamp(log.timestamp)}
                            </TableCell>
                            <TableCell className="py-5">
                              <div className="min-w-0 max-w-[220px]">
                                <div className="font-bold text-foreground leading-snug">{displayName}</div>
                                <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
                                  <span className="break-all">{log.userEmail}</span>
                                  <span className="text-muted-foreground/50" aria-hidden>
                                    ·
                                  </span>
                                  <Badge
                                    variant="secondary"
                                    className="h-5 shrink-0 px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                                  >
                                    {formatRoleLabel(log.userRole)}
                                  </Badge>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="py-5">
                              <Badge
                                variant="outline"
                                className={cn(
                                  'rounded-full px-2.5 py-0.5 text-xs font-medium border shadow-none',
                                  ACTION_BADGE_CLASSES[tone]
                                )}
                              >
                                {humanizeAction(log.action)}
                              </Badge>
                            </TableCell>
                            <TableCell className="py-5 text-sm">
                              <span className="text-foreground">{humanizeResource(log.resource)}</span>
                              {log.resourceId && (
                                <div className="text-xs text-muted-foreground mt-1 font-mono break-all">
                                  ID: {log.resourceId}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="py-5 text-sm text-muted-foreground max-w-md">
                              <span className="text-foreground/90 leading-relaxed">
                                {friendlyDetails(log.details, log.resource)}
                              </span>
                            </TableCell>
                            <TableCell className="py-5 text-center">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                    aria-label="Show IP address and device info"
                                  >
                                    <Info className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="max-w-xs text-left">
                                  <p className="text-xs font-medium text-foreground mb-1">Technical details</p>
                                  <p className="text-xs text-muted-foreground break-all">
                                    <span className="text-foreground/90">IP:</span> {log.ipAddress || '—'}
                                  </p>
                                  {log.userAgent && (
                                    <p className="text-xs text-muted-foreground mt-2 break-all line-clamp-4">
                                      <span className="text-foreground/90">Device:</span> {log.userAgent}
                                    </p>
                                  )}
                                </TooltipContent>
                              </Tooltip>
                            </TableCell>
                          </TableRow>
                        );
                      })}
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
                        onClick={() =>
                          setPagination((prev) => ({
                            ...prev,
                            page: prev.page - 1,
                          }))
                        }
                        disabled={pagination.page === 1}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setPagination((prev) => ({
                            ...prev,
                            page: prev.page + 1,
                          }))
                        }
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

