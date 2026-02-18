import { memo } from 'react';
import { RefreshCw, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CameraFooterProps {
  isOnline: boolean;
  lastCapture?: Date | string | null;
  onRefresh: () => void;
  onFullscreen: () => void;
}

export const CameraFooter = memo(function CameraFooter({
  isOnline,
  lastCapture,
  onRefresh,
  onFullscreen,
}: CameraFooterProps) {
  const lastCaptureStr = lastCapture != null
    ? new Date(lastCapture).toLocaleString()
    : 'Never';
  const statusText = isOnline
    ? `Live • Last capture: ${lastCaptureStr}`
    : 'Camera offline';

  return (
    <div className="flex items-center justify-between p-3 border-t border-border">
      <span className="text-xs text-muted-foreground">{statusText}</span>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={onFullscreen}>
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
});








