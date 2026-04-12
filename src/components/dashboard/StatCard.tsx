import type { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  /** Optional line below the value (e.g. sample size or definition). */
  subtitle?: string;
  /** Subtle footer (e.g. ghost CTA link). */
  action?: ReactNode;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  variant?: 'default' | 'warning' | 'destructive' | 'success';
}

export function StatCard({ title, value, icon: Icon, subtitle, action, trend, variant = 'default' }: StatCardProps) {
  const iconColors = {
    default: 'text-primary bg-primary/10',
    warning: 'text-warning bg-warning/10',
    destructive: 'text-destructive bg-destructive/10',
    success: 'text-success bg-success/10',
  };

  return (
    <div className="glass-card rounded-xl p-6 animate-slide-up">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-2 text-3xl font-bold text-foreground">{value}</p>
          {subtitle && (
            <p className="mt-1 text-xs text-muted-foreground leading-snug">{subtitle}</p>
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
      {action ? <div className="mt-4 border-t border-border/40 pt-2">{action}</div> : null}
    </div>
  );
}
