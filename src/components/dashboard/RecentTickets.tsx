import { useMemo } from 'react';
import { FileText, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Violation } from '@/types/parking';
import { useDropdownOptions } from '@/hooks/useDropdownOptions';
import {
  defaultViolationStatusHex,
  resolvedViolationStatusHex,
  violationStatusBadgeSurface,
} from '@/lib/violationStatusStyle';

interface RecentTicketsProps {
  violations: Violation[];
}

export function RecentTickets({ violations }: RecentTicketsProps) {
  const navigate = useNavigate();
  const { options: catalog } = useDropdownOptions();
  const violationStatusByValue = useMemo(() => {
    const m = new Map<string, (typeof catalog.violationStatusFilters)[number]>();
    for (const row of catalog.violationStatusFilters) {
      m.set(row.value, row);
    }
    return m;
  }, [catalog.violationStatusFilters]);

  const fallbackLabel = (status: Violation['status']): string => {
    switch (status) {
      case 'warning':
        return 'Warning';
      case 'pending':
        return 'Pending';
      case 'issued':
        return 'Issued';
      case 'cancelled':
        return 'Cancelled';
      case 'cleared':
        return 'Cleared';
      case 'resolved':
        return 'Resolved';
      default:
        return status;
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
          const entry = violationStatusByValue.get(violation.status);
          const label = entry?.label ?? fallbackLabel(violation.status);
          const hex = entry ? resolvedViolationStatusHex(entry) : defaultViolationStatusHex(violation.status);
          return (
            <div key={violation.id} className="flex items-center justify-between p-4 hover:bg-accent/50 transition-colors">
              <div className="flex items-center gap-4">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-border/50"
                  style={{ backgroundColor: hex }}
                  aria-hidden
                />
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
              <span
                className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold"
                style={violationStatusBadgeSurface(hex)}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
