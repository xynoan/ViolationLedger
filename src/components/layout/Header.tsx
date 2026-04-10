import { useState, useEffect } from 'react';
import { Bell, LogOut, User, AlertTriangle, Camera, Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';
import { notificationsAPI } from '@/lib/api';

interface HeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  autoRefreshNotifications?: boolean;
}

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  cameraId?: string;
  locationId?: string;
  plateNumber?: string;
  timeDetected?: Date;
  reason?: string;
  imageUrl?: string;
  imageBase64?: string;
  timestamp: Date;
  read: boolean;
  handledBy?: string | null;
  handledAt?: Date | null;
  status?: 'open' | 'in_progress' | 'resolved' | string;
}

interface NotificationApiRecord extends Omit<Notification, 'timestamp' | 'timeDetected'> {
  timestamp: string | Date;
  timeDetected?: string | Date;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const SERVER_BASE_URL = API_BASE_URL.replace('/api', '');

type NotificationKind = 'warning_expired' | 'vehicle_detected' | 'incident_created' | 'plate_not_visible' | 'unknown';

export function Header({ title, subtitle, action, autoRefreshNotifications = true }: HeaderProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(true);

  // Load notifications
  useEffect(() => {
    loadNotifications();
    if (!autoRefreshNotifications) return;
    // Refresh notifications every 30 seconds
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, [autoRefreshNotifications]);

  const loadNotifications = async () => {
    try {
      setIsLoadingNotifications(true);
      const data = (await notificationsAPI.getAll(true)) as NotificationApiRecord[]; // Get unread only
      const processedNotifications = data.map((notif) => ({
        ...notif,
        timestamp: new Date(notif.timestamp),
        timeDetected: notif.timeDetected ? new Date(notif.timeDetected) : undefined,
      }));
      setNotifications(processedNotifications);
    } catch (error) {
      console.error('Error loading notifications:', error);
      setNotifications([]);
    } finally {
      setIsLoadingNotifications(false);
    }
  };

  const handleNotificationClick = async (notification: Notification) => {
    // For warning_expired, we show an explicit "Handle this" button instead of
    // claiming on simple click, so just mark as read here.
    // Mark as read
    if (!notification.read) {
      try {
        await notificationsAPI.markAsRead(notification.id);
        loadNotifications(); // Reload to update read status
      } catch (error) {
        console.error('Error marking notification as read:', error);
      }
    }
  };

  const getImageSrc = (notification: Notification): string | null => {
    if (notification.imageBase64) {
      if (notification.imageBase64.startsWith('data:')) {
        return notification.imageBase64;
      }
      return `data:image/jpeg;base64,${notification.imageBase64}`;
    }
    if (notification.imageUrl) {
      return `${SERVER_BASE_URL}/captured_images/${notification.imageUrl.split(/[/\\]/).pop()}`;
    }
    return null;
  };

  const getNotificationKind = (notification: Notification): NotificationKind => {
    const t = (notification.type || '').toLowerCase();
    if (t === 'warning_expired') return 'warning_expired';
    if (t === 'vehicle_detected') return 'vehicle_detected';
    if (t === 'incident_created') return 'incident_created';
    if (t === 'plate_not_visible') return 'plate_not_visible';
    return 'unknown';
  };

  const getStatusTitle = (notification: Notification): string => {
    const kind = getNotificationKind(notification);
    switch (kind) {
      case 'vehicle_detected':
        return 'New Detection';
      case 'warning_expired':
        return 'Warning Expired';
      case 'incident_created':
        return 'Incident Created';
      case 'plate_not_visible':
        return 'Incident Created';
      default:
        // Prefer server-provided title if it’s already meaningful; otherwise fall back.
        return notification.title && !/^alert\s*\d+$/i.test(notification.title) ? notification.title : 'Notification';
    }
  };

  const getLeftIcon = (notification: Notification) => {
    const kind = getNotificationKind(notification);
    switch (kind) {
      case 'warning_expired':
        return { Icon: Clock, className: 'text-red-600' };
      case 'vehicle_detected':
        return { Icon: Camera, className: 'text-amber-600' };
      case 'incident_created':
      case 'plate_not_visible':
        return { Icon: AlertTriangle, className: 'text-warning' };
      default:
        return { Icon: AlertTriangle, className: 'text-muted-foreground' };
    }
  };

  const getReasonPill = (notification: Notification): { label: string; className: string } | null => {
    const kind = getNotificationKind(notification);
    const rawReason = (notification.reason || '').trim();

    if (kind === 'warning_expired') {
      return { label: rawReason || 'Expired Warning', className: 'bg-red-100 text-red-700' };
    }
    if (kind === 'vehicle_detected') {
      return { label: rawReason || 'New Detection', className: 'bg-amber-100 text-amber-700' };
    }
    if (rawReason) {
      return { label: rawReason, className: 'bg-muted text-muted-foreground' };
    }
    return null;
  };

  const getMainDescription = (notification: Notification): React.ReactNode => {
    const plate = notification.plateNumber && notification.plateNumber !== 'NONE' ? notification.plateNumber : null;
    const kind = getNotificationKind(notification);

    const Plate = plate ? (
      <span className="font-mono font-semibold text-foreground">{plate}</span>
    ) : (
      <span className="font-semibold text-foreground">Unknown plate</span>
    );

    switch (kind) {
      case 'vehicle_detected':
        return (
          <>
            Vehicle detected: {Plate}.
          </>
        );
      case 'warning_expired':
        return (
          <>
            Warning expired for {Plate}.
          </>
        );
      case 'incident_created':
      case 'plate_not_visible':
        return (
          <>
            Incident created for {Plate}.
          </>
        );
      default:
        // Keep server message if we don’t have a known template.
        return notification.message;
    }
  };

  const getTimestampText = (notification: Notification): string | null => {
    const dt = notification.timeDetected || notification.timestamp;
    if (!dt) return null;
    try {
      return new Date(dt).toLocaleString();
    } catch {
      return null;
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/80 backdrop-blur-xl px-4 sm:px-6">
      <div className="pl-12 lg:pl-0">
        <h1 className="text-lg sm:text-xl font-semibold text-foreground">{title}</h1>
        {subtitle && <p className="text-xs sm:text-sm text-muted-foreground hidden sm:block">{subtitle}</p>}
      </div>
      
      <div className="flex items-center gap-2 sm:gap-4">
        {action && (
          <div className="hidden sm:block">
            {action}
          </div>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
              {notifications.length > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-warning text-[10px] font-bold text-warning-foreground">
                  {notifications.length}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[22rem] bg-card border-border">
            <DropdownMenuLabel>Notifications</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {isLoadingNotifications ? (
              <div className="p-6 text-center">
                <p className="text-sm text-muted-foreground">Loading notifications...</p>
              </div>
            ) : notifications.length > 0 ? (
              <>
                <div className="max-h-96 overflow-y-auto">
                  {notifications.map((notification) => {
                    const imageSrc = getImageSrc(notification);
                    const statusTitle = getStatusTitle(notification);
                    const reasonPill = getReasonPill(notification);
                    const { Icon, className: iconClassName } = getLeftIcon(notification);
                    const metaLocation = notification.locationId?.trim() || null;
                    const metaTime = getTimestampText(notification);

                    return (
                      <DropdownMenuItem
                        key={notification.id}
                        className="flex flex-col items-start gap-2 p-4 cursor-pointer hover:bg-muted/50 border-b border-border/40 last:border-b-0"
                        onClick={() => handleNotificationClick(notification)}
                      >
                        <div className="flex items-start gap-2 w-full">
                          <Icon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${iconClassName}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 w-full">
                              <span className="text-sm font-semibold text-foreground truncate">{statusTitle}</span>
                              {!notification.read && (
                                <span className="h-2 w-2 rounded-full bg-primary flex-shrink-0"></span>
                              )}
                              <div className="ml-auto flex items-center gap-2">
                                {reasonPill && (
                                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${reasonPill.className}`}>
                                    {reasonPill.label}
                                  </span>
                                )}
                              </div>
                            </div>
                            <p className="text-xs text-foreground/90 whitespace-normal leading-5">
                              {getMainDescription(notification)}
                            </p>
                            {(metaLocation || metaTime) && (
                              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                                {metaLocation && <span>{metaLocation}</span>}
                                {metaTime && <span>{metaTime}</span>}
                              </div>
                            )}
                            {notification.type === 'warning_expired' && (!notification.handledBy || notification.status === 'open') && (
                              <div className="mt-2">
                                <Button
                                  size="xs"
                                  className="bg-red-600 text-white hover:bg-red-700"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    try {
                                      await notificationsAPI.handle(notification.id);
                                      await loadNotifications();
                                    } catch (error) {
                                      console.error('Error handling notification:', error);
                                    }
                                  }}
                                >
                                  Issue Ticket
                                </Button>
                              </div>
                            )}
                            {imageSrc && (
                              <img
                                src={imageSrc}
                                alt="Camera snapshot"
                                className="mt-2 rounded-md max-w-full h-24 object-cover border border-border"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                }}
                              />
                            )}
                          </div>
                        </div>
                      </DropdownMenuItem>
                    );
                  })}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  className="justify-center text-primary cursor-pointer"
                  onClick={() => navigate('/warnings')}
                >
                  View all notifications
                </DropdownMenuItem>
              </>
            ) : (
              <div className="p-6 text-center">
                <Bell className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
                <p className="text-sm text-muted-foreground">No notifications</p>
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              <User className="h-4 w-4" />
              <span className="hidden sm:inline text-sm">{user?.name || user?.email || 'User'}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-card border-border">
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium">{user?.name || 'User'}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-destructive">
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
