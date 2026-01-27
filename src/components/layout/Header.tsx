import { useState, useEffect } from 'react';
import { Bell, Search, LogOut, User, AlertTriangle, Camera } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const SERVER_BASE_URL = API_BASE_URL.replace('/api', '');

export function Header({ title, subtitle, action }: HeaderProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(true);

  // Load notifications
  useEffect(() => {
    loadNotifications();
    // Refresh notifications every 30 seconds
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadNotifications = async () => {
    try {
      setIsLoadingNotifications(true);
      const data = await notificationsAPI.getAll(true); // Get unread only
      const processedNotifications = data.map((notif: any) => ({
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
        <div className="relative hidden sm:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input 
            placeholder="Search..." 
            className="w-48 md:w-64 pl-9 bg-secondary border-border"
          />
        </div>
        
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
          <DropdownMenuContent align="end" className="w-80 bg-card border-border">
            <DropdownMenuLabel>Notifications</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {isLoadingNotifications ? (
              <div className="p-6 text-center">
                <p className="text-sm text-muted-foreground">Loading notifications...</p>
              </div>
            ) : notifications.length > 0 ? (
              <>
                {notifications.map((notification) => {
                  const imageSrc = getImageSrc(notification);
                  return (
                    <DropdownMenuItem 
                      key={notification.id} 
                      className="flex flex-col items-start gap-2 p-3 cursor-pointer hover:bg-muted/50"
                      onClick={() => handleNotificationClick(notification)}
                    >
                      <div className="flex items-start gap-2 w-full">
                        <AlertTriangle className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-foreground">{notification.title}</span>
                            {!notification.read && (
                              <span className="h-2 w-2 rounded-full bg-primary"></span>
                            )}
                          </div>
                          <p className="text-xs text-foreground mb-1">{notification.message}</p>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {notification.locationId && (
                              <Badge variant="secondary" className="text-xs">
                                <Camera className="h-3 w-3 mr-1" />
                                {notification.locationId}
                              </Badge>
                            )}
                            {notification.plateNumber && notification.plateNumber !== 'NONE' && (
                              <span className="font-mono">Plate: {notification.plateNumber}</span>
                            )}
                            {notification.timeDetected && (
                              <span>{new Date(notification.timeDetected).toLocaleString()}</span>
                            )}
                            {notification.reason && (
                              <span className="text-warning">• {notification.reason}</span>
                            )}
                          </div>
                          {imageSrc && (
                            <img 
                              src={imageSrc} 
                              alt="Camera snapshot" 
                              className="mt-2 rounded-md max-w-full h-20 object-cover border border-border"
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
