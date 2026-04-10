import { SearchSlash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const DEFAULT_HINT =
  'Check your spelling or try searching for a different name, address, or contact number.';

export type SearchNoMatchesEmptyProps = {
  searchTerm: string;
  onClear: () => void;
  hint?: string;
  className?: string;
};

export function SearchNoMatchesEmpty({
  searchTerm,
  onClear,
  hint = DEFAULT_HINT,
  className,
}: SearchNoMatchesEmptyProps) {
  const display = searchTerm.trim() || '…';

  return (
    <div className={cn('glass-card rounded-xl p-8 sm:p-12 text-center', className)}>
      <SearchSlash
        className="mx-auto mb-4 h-14 w-14 sm:h-16 sm:w-16 text-muted-foreground"
        strokeWidth={1.25}
        aria-hidden
      />
      <h3 className="text-lg font-semibold text-foreground mb-2">
        No matches found for &quot;{display}&quot;
      </h3>
      <p className="text-muted-foreground mb-6 max-w-md mx-auto text-sm leading-relaxed">{hint}</p>
      <Button type="button" variant="secondary" onClick={onClear}>
        Clear Search
      </Button>
    </div>
  );
}
