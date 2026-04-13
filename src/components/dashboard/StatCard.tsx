import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  /** Optional line below the value (e.g. sample size or definition). */
  subtitle?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  variant?: 'default' | 'warning' | 'destructive' | 'success';
  ctaLabel?: string;
  onClick?: () => void;
}

export function StatCard({
  title,
  value,
  icon: Icon,
  subtitle,
  trend,
  variant = 'default',
  ctaLabel,
  onClick,
}: StatCardProps) {
  const iconColors = {
    default: 'text-primary bg-primary/10',
    warning: 'text-warning bg-warning/10',
    destructive: 'text-destructive bg-destructive/10',
    success: 'text-success bg-success/10',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "glass-card rounded-xl p-6 animate-slide-up w-full text-left transition-shadow",
        onClick ? "cursor-pointer hover:shadow-md hover:ring-1 hover:ring-primary/25" : "cursor-default",
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-2 text-3xl font-bold text-foreground">{value}</p>
          {subtitle && (
            <p className="mt-1 text-xs text-muted-foreground leading-snug">{subtitle}</p>
          )}
          {ctaLabel && (
            <p className="mt-2 text-xs font-semibold text-primary">{ctaLabel}</p>
          )}
          {trend && (
            <p className={cn(
              "mt-1 text-sm",
              trend.isPositive ? "text-success" : "text-destructive"
            )}>
              {trend.isPositive ? '+' : ''}{trend.value}% from last week
            </p>
          )}
        </div>
        <div className={cn("rounded-lg p-3", iconColors[variant])}>
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </button>
  );
}
