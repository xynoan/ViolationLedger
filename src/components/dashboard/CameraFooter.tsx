import { memo } from 'react';
import { RefreshCw, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CameraFooterProps {
  isOnline: boolean;
  captureStatus: 'counting' | 'sending' | 'waiting' | 'processing';
  nextCaptureTime: number;
  onRefresh: () => void;
  onFullscreen: () => void;
}

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

export const CameraFooter = memo(function CameraFooter({
  isOnline,
  captureStatus,
  nextCaptureTime,
  onRefresh,
  onFullscreen,
}: CameraFooterProps) {
  const statusText = isOnline
    ? captureStatus === 'sending'
      ? 'Sending Captured image...'
      : captureStatus === 'processing'
        ? `AI Processing... ${formatTime(nextCaptureTime)}`
        : captureStatus === 'waiting'
          ? `Next capture in ${formatTime(nextCaptureTime)}`
          : `Capturing in ${formatTime(nextCaptureTime)}`
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








