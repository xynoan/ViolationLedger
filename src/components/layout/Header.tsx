import { useState, useEffect } from 'react';
import { Bell, LogOut, User } from 'lucide-react';
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
import type { NotificationDisplayModel } from '@/lib/notificationDisplay';
import { NotificationListItem } from '@/components/notifications/NotificationListItem';

interface HeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  autoRefreshNotifications?: boolean;
}

interface NotificationApiRecord extends Omit<NotificationDisplayModel, 'timestamp' | 'timeDetected'> {
  timestamp: string | Date;
  timeDetected?: string | Date;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const SERVER_BASE_URL = API_BASE_URL.replace('/api', '');

export function Header({ title, subtitle, action, autoRefreshNotifications = true }: HeaderProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<NotificationDisplayModel[]>([]);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(true);

  useEffect(() => {
    loadNotifications();
    if (!autoRefreshNotifications) return;
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, [autoRefreshNotifications]);

  const loadNotifications = async () => {
    try {
      setIsLoadingNotifications(true);
      const data = (await notificationsAPI.getAll(true)) as NotificationApiRecord[];
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

  const handleNotificationClick = async (notification: NotificationDisplayModel) => {
    if (!notification.read) {
      try {
        await notificationsAPI.markAsRead(notification.id);
        loadNotifications();
      } catch (error) {
        console.error('Error marking notification as read:', error);
      }
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
        {action && <div className="hidden sm:block">{action}</div>}
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
                  {notifications.map((notification) => (
                    <NotificationListItem
                      key={notification.id}
                      notification={notification}
                      serverBaseUrl={SERVER_BASE_URL}
                      layout="menu"
                      onInteraction={handleNotificationClick}
                      onIssueTicket={async (n) => {
                        try {
                          await notificationsAPI.handle(n.id);
                          await loadNotifications();
                        } catch (error) {
                          console.error('Error handling notification:', error);
                        }
                      }}
                    />
                  ))}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="justify-center text-primary cursor-pointer"
                  onClick={() => navigate('/notifications')}
                >
                  View all notifications
                </DropdownMenuItem>
              </>
            ) : (
              <>
                <div className="p-6 text-center">
                  <Bell className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
                  <p className="text-sm text-muted-foreground">No notifications</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="justify-center text-primary cursor-pointer"
                  onClick={() => navigate('/notifications')}
                >
                  View all notifications
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

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
