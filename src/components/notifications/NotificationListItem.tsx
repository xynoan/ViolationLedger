import type { NotificationDisplayModel } from '@/lib/notificationDisplay';
import {
  getImageSrc,
  getLeftIcon,
  getMainDescription,
  getReasonPill,
  getStatusTitle,
  getTimestampText,
} from '@/lib/notificationDisplay';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface NotificationListItemProps {
  notification: NotificationDisplayModel;
  serverBaseUrl: string;
  layout: 'menu' | 'page';
  onInteraction?: (notification: NotificationDisplayModel) => void;
}

export function NotificationListItem({
  notification,
  serverBaseUrl,
  layout,
  onInteraction,
}: NotificationListItemProps) {
  const imageSrc = getImageSrc(notification, serverBaseUrl);
  const statusTitle = getStatusTitle(notification);
  const reasonPill = getReasonPill(notification);
  const { Icon, className: iconClassName } = getLeftIcon(notification);
  const metaLocation = notification.locationId?.trim() || null;
  const metaTime = getTimestampText(notification);

  const inner = (
    <div className="flex items-start gap-2 w-full">
      <Icon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${iconClassName}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 w-full">
          <span className="text-sm font-semibold text-foreground truncate">{statusTitle}</span>
          {!notification.read && (
            <span className="h-2 w-2 rounded-full bg-primary flex-shrink-0" />
          )}
          <div className="ml-auto flex items-center gap-2">
            {reasonPill && (
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${reasonPill.className}`}>
                {reasonPill.label}
              </span>
            )}
          </div>
        </div>
        <p className="text-xs text-foreground/90 whitespace-normal leading-5">{getMainDescription(notification)}</p>
        {(metaLocation || metaTime) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {metaLocation && <span>{metaLocation}</span>}
            {metaTime && <span>{metaTime}</span>}
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
  );

  if (layout === 'menu') {
    return (
      <DropdownMenuItem
        className={cn(
          'flex flex-col items-start gap-2 p-4 cursor-pointer hover:bg-muted/50 border-b border-border/40 last:border-b-0'
        )}
        onClick={() => onInteraction?.(notification)}
      >
        {inner}
      </DropdownMenuItem>
    );
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card p-4 shadow-sm transition-colors',
        !notification.read && 'border-primary/30 bg-primary/5'
      )}
      role="button"
      tabIndex={0}
      onClick={() => onInteraction?.(notification)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onInteraction?.(notification);
        }
      }}
    >
      {inner}
    </div>
  );
}
