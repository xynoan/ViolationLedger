import { useState, useEffect, useCallback, useRef } from 'react';
import { Bell } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { usePageTracking } from '@/hooks/usePageTracking';
import { notificationsAPI } from '@/lib/api';
import type { NotificationDisplayModel } from '@/lib/notificationDisplay';
import { NotificationListItem } from '@/components/notifications/NotificationListItem';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const SERVER_BASE_URL = API_BASE_URL.replace('/api', '');

type Filter = 'all' | 'unread';

interface NotificationApiRecord extends Omit<NotificationDisplayModel, 'timestamp' | 'timeDetected'> {
  timestamp: string | Date;
  timeDetected?: string | Date;
}

function toModel(row: NotificationApiRecord): NotificationDisplayModel {
  return {
    ...row,
    timestamp: new Date(row.timestamp),
    timeDetected: row.timeDetected ? new Date(row.timeDetected) : undefined,
  };
}

type NotificationLatestMeta = { id: string | null; timestamp: string | null };

export default function Notifications() {
  usePageTracking();
  const [filter, setFilter] = useState<Filter>('all');
  const [notifications, setNotifications] = useState<NotificationDisplayModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);
  const lastListMetaRef = useRef<NotificationLatestMeta | null>(null);

  const loadNotifications = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    try {
      if (!silent) setIsLoading(true);
      const [data, latestMeta] = await Promise.all([
        notificationsAPI.getAll({
          limit: 500,
          unread: filter === 'unread' ? true : undefined,
        }) as Promise<NotificationApiRecord[]>,
        notificationsAPI.getLatestMeta() as Promise<NotificationLatestMeta>,
      ]);
      setNotifications(data.map(toModel));
      lastListMetaRef.current = latestMeta;
    } catch (e) {
      console.error('Error loading notifications:', e);
      if (!silent) {
        toast({
          title: 'Error',
          description: 'Failed to load notifications.',
          variant: 'destructive',
        });
        setNotifications([]);
      }
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    let cancelled = false;
    void loadNotifications();

    const interval = setInterval(async () => {
      if (cancelled) return;
      try {
        const meta = (await notificationsAPI.getLatestMeta()) as NotificationLatestMeta;
        if (cancelled) return;
        const prev = lastListMetaRef.current;
        const changed =
          (meta.id ?? null) !== (prev?.id ?? null) ||
          (meta.timestamp ?? null) !== (prev?.timestamp ?? null);
        if (changed) {
          await loadNotifications({ silent: true });
        }
      } catch (e) {
        console.error('Error checking for new notifications:', e);
      }
    }, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [loadNotifications]);

  const handleNotificationInteraction = async (n: NotificationDisplayModel) => {
    if (!n.read) {
      try {
        await notificationsAPI.markAsRead(n.id);
        await loadNotifications();
      } catch (e) {
        console.error('Error marking notification as read:', e);
      }
    }
  };

  const handleMarkAllRead = async () => {
    try {
      setMarkingAll(true);
      await notificationsAPI.markAllAsRead();
      toast({ title: 'Updated', description: 'All notifications marked as read.' });
      await loadNotifications();
    } catch (e) {
      console.error(e);
      toast({
        title: 'Error',
        description: 'Could not mark all as read.',
        variant: 'destructive',
      });
    } finally {
      setMarkingAll(false);
    }
  };

  const handleIssueTicket = async (n: NotificationDisplayModel) => {
    try {
      await notificationsAPI.handle(n.id);
      await loadNotifications();
    } catch (e) {
      console.error('Error handling notification:', e);
      toast({
        title: 'Error',
        description: 'Could not update notification.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header
        title="Notifications"
        subtitle="All system alerts and detections in one place"
        autoRefreshNotifications={false}
      />
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/30">
            {(['all', 'unread'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  filter === key
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {key === 'all' ? 'All' : 'Unread only'}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={markingAll || notifications.length === 0}
            onClick={handleMarkAllRead}
          >
            Mark all as read
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground py-12 text-center">Loading notifications…</p>
        ) : notifications.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-16 text-center">
            <Bell className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-sm text-muted-foreground">
              {filter === 'unread' ? 'No unread notifications.' : 'No notifications yet.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-3 list-none p-0 m-0">
            {notifications.map((n) => (
              <li key={n.id}>
                <NotificationListItem
                  notification={n}
                  serverBaseUrl={SERVER_BASE_URL}
                  layout="page"
                  onInteraction={handleNotificationInteraction}
                  onIssueTicket={handleIssueTicket}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
