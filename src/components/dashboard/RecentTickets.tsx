import { FileText, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Violation } from '@/types/parking';
import { cn } from '@/lib/utils';

interface RecentTicketsProps {
  violations: Violation[];
}

export function RecentTickets({ violations }: RecentTicketsProps) {
  const navigate = useNavigate();

  const getStatusConfig = (status: Violation['status']) => {
    switch (status) {
      case 'warning':
        return { label: 'Warning', variant: 'warning' as const, indicator: 'status-warning' };
      case 'pending':
        return { label: 'Pending', variant: 'secondary' as const, indicator: 'status-active' };
      case 'issued':
        return { label: 'Issued', variant: 'destructive' as const, indicator: 'status-violation' };
      case 'cancelled':
        return { label: 'Cancelled', variant: 'outline' as const, indicator: '' };
      case 'cleared':
        return { label: 'Cleared', variant: 'success' as const, indicator: 'status-cleared' };
      default:
        return { label: status, variant: 'secondary' as const, indicator: '' };
    }
  };

  return (
    <div className="glass-card rounded-xl animate-slide-up">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <h3 className="font-medium text-foreground">Recent Activity</h3>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/tickets')}>
          View All
          <ExternalLink className="h-4 w-4 ml-1" />
        </Button>
      </div>

      <div className="divide-y divide-border">
        {violations.slice(0, 5).map((violation) => {
          const statusConfig = getStatusConfig(violation.status);
          return (
            <div key={violation.id} className="flex items-center justify-between p-4 hover:bg-accent/50 transition-colors">
              <div className="flex items-center gap-4">
                <div className={cn("status-indicator", statusConfig.indicator)} />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium text-foreground">{violation.plateNumber}</span>
                    <span className="text-xs text-muted-foreground">•</span>
                    <span className="text-xs text-muted-foreground">{violation.ticketId}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {violation.cameraLocationId} • {new Date(violation.timeDetected).toLocaleString()}
                  </p>
                </div>
              </div>
              <Badge variant={statusConfig.variant}>
                {statusConfig.label}
              </Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
}
