import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  forwardRef,
  type ComponentType,
  type ReactNode,
} from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ListTree,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Car,
  MapPin,
  Building2,
  Users,
  UserCog,
  Compass,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { dropdownOptionsAPI } from '@/lib/api';
import { useDropdownOptions } from '@/hooks/useDropdownOptions';
import { toast } from '@/hooks/use-toast';
import type { DropdownCatalog, LabeledValue, VisitorPurposePreset } from '@/types/dropdownCatalog';
import { DEFAULT_DROPDOWN_CATALOG } from '@/types/dropdownCatalog';
import { cn } from '@/lib/utils';
import { resolvedViolationStatusHex } from '@/lib/violationStatusStyle';

function slugFromLabel(label: string) {
  const s = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s || `type_${Date.now()}`;
}

function StringListEditor({
  items,
  onChange,
  addLabel,
  rowPlaceholder,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  addLabel: string;
  rowPlaceholder?: string;
}) {
  return (
    <div className="space-y-2">
      {items.map((row, idx) => (
        <div key={idx} className="flex gap-2 items-center">
          <Input
            value={row}
            placeholder={rowPlaceholder}
            onChange={(e) => {
              const next = [...items];
              next[idx] = e.target.value;
              onChange(next);
            }}
            className="font-mono text-sm flex-1 min-w-0"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => onChange(items.filter((_, i) => i !== idx))}
            aria-label="Remove row"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full sm:w-auto"
        onClick={() => onChange([...items, ''])}
      >
        <Plus className="h-4 w-4 mr-1" />
        {addLabel}
      </Button>
      <p className="text-[11px] text-muted-foreground leading-snug">
        Empty rows are dropped when you save. Duplicate names are removed on the server.
      </p>
    </div>
  );
}

function QuietVehicleTypesEditor({
  rows,
  onChange,
}: {
  rows: { value: string; label: string }[];
  onChange: (next: { value: string; label: string }[]) => void;
}) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  return (
    <div className="space-y-1">
      {rows.map((row, idx) => {
        const isEditing = editingIdx === idx;
        const canRemove = row.value !== 'other';
        return (
          <div
            key={`${row.value}-${idx}`}
            className={cn(
              'group flex items-center gap-2 rounded-lg border border-transparent px-2 py-2 transition-colors',
              'hover:border-border/70 hover:bg-muted/30',
              isEditing && 'border-border bg-background ring-1 ring-ring/20',
            )}
          >
            <div className="min-w-0 flex-1">
              {isEditing ? (
                <div
                  className="flex flex-col sm:flex-row gap-2 sm:items-center"
                  onBlur={(e) => {
                    const next = e.relatedTarget as Node | null;
                    if (next && e.currentTarget.contains(next)) return;
                    setEditingIdx(null);
                  }}
                >
                  <Input
                    value={row.label}
                    autoFocus
                    className="h-9 text-sm"
                    onChange={(e) => {
                      const next = [...rows];
                      next[idx] = { ...row, label: e.target.value };
                      onChange(next);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setEditingIdx(null);
                    }}
                    aria-label="Vehicle type label"
                  />
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[10px] text-muted-foreground">Code</span>
                    <Input
                      value={row.value}
                      disabled={row.value === 'other'}
                      className="h-9 max-w-[10rem] font-mono text-xs"
                      onChange={(e) => {
                        const next = [...rows];
                        next[idx] = {
                          ...row,
                          value: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''),
                        };
                        onChange(next);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setEditingIdx(null);
                      }}
                      aria-label="Vehicle type code (letters, numbers, underscore only)"
                    />
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="flex w-full min-w-0 items-center gap-2 text-left text-sm font-medium text-foreground"
                  onClick={() => setEditingIdx(idx)}
                >
                  <span className="truncate">{row.label || 'Untitled'}</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className="inline-flex shrink-0 rounded bg-muted/80 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                        tabIndex={0}
                      >
                        {row.value}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-xs">
                      Stored code <span className="font-mono font-semibold">{row.value}</span> — used by the system on
                      vehicles and in exports.
                    </TooltipContent>
                  </Tooltip>
                </button>
              )}
            </div>
            <div
              className={cn(
                'flex shrink-0 items-center gap-0.5',
                isEditing ? 'opacity-100' : 'opacity-0 transition-opacity group-hover:opacity-100',
              )}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                onClick={() => setEditingIdx(idx)}
                aria-label="Edit vehicle type"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                disabled={!canRemove}
                onClick={() => onChange(rows.filter((_, i) => i !== idx))}
                aria-label="Remove vehicle type"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2 w-full sm:w-auto"
        onClick={() => {
          const label = 'New type';
          onChange([...rows, { value: slugFromLabel(label), label }]);
        }}
      >
        <Plus className="h-4 w-4 mr-1" />
        Add type
      </Button>
    </div>
  );
}

function QuietStringListEditor({
  items,
  onChange,
  addLabel,
  rowPlaceholder,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  addLabel: string;
  rowPlaceholder?: string;
}) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  return (
    <div className="space-y-1">
      {items.map((row, idx) => {
        const isEditing = editingIdx === idx;
        return (
          <div
            key={`${idx}-${row}`}
            className={cn(
              'group flex items-center gap-2 rounded-lg border border-transparent px-2 py-2 transition-colors',
              'hover:border-border/70 hover:bg-muted/30',
              isEditing && 'border-border bg-background ring-1 ring-ring/20',
            )}
          >
            <div className="min-w-0 flex-1">
              {isEditing ? (
                <Input
                  value={row}
                  autoFocus
                  placeholder={rowPlaceholder}
                  className="h-9 text-sm"
                  onChange={(e) => {
                    const next = [...items];
                    next[idx] = e.target.value;
                    onChange(next);
                  }}
                  onBlur={() => setEditingIdx(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setEditingIdx(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="w-full truncate text-left text-sm font-medium text-foreground"
                  onClick={() => setEditingIdx(idx)}
                >
                  {row.trim() ? row : <span className="text-muted-foreground font-normal">Empty row</span>}
                </button>
              )}
            </div>
            <div
              className={cn(
                'flex shrink-0 items-center gap-0.5',
                isEditing ? 'opacity-100' : 'opacity-0 transition-opacity group-hover:opacity-100',
              )}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                onClick={() => setEditingIdx(idx)}
                aria-label="Edit row"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={() => onChange(items.filter((_, i) => i !== idx))}
                aria-label="Remove row"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2 w-full sm:w-auto"
        onClick={() => onChange([...items, ''])}
      >
        <Plus className="h-4 w-4 mr-1" />
        {addLabel}
      </Button>
      <p className="text-[11px] text-muted-foreground leading-snug">
        Empty rows are dropped when you save. Duplicate names are removed on the server.
      </p>
    </div>
  );
}

const OCCUPANCY_VALUE_LOCK = new Set(['homeowner', 'tenant']);
const STANDING_VALUE_LOCK = new Set(['all', 'active_violations', 'clean']);
const VIOLATION_STATUS_VALUE_LOCK = new Set([
  'all',
  'warning',
  'issued',
  'resolved',
  'cleared',
  'pending',
  'cancelled',
]);
const USER_ROLE_VALUE_LOCK = new Set(['encoder', 'barangay_user']);
const USER_STATUS_VALUE_LOCK = new Set(['active', 'inactive']);

function newCatalogListSlug(existing: Set<string>) {
  let v: string;
  let guard = 0;
  do {
    v = `extra_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    guard += 1;
  } while (existing.has(v) && guard < 50);
  return v;
}

/** Label-first rows with code on hover; edit label + code; delete when not locked (same UX as vehicle types). */
function QuietKeyLabelListEditor({
  rows,
  onChange,
  variant,
  allowAddRemove,
  lockedValues,
  addButtonLabel = 'Add option',
}: {
  rows: LabeledValue[];
  onChange: (next: LabeledValue[]) => void;
  variant: 'plain' | 'violation-status';
  allowAddRemove: boolean;
  lockedValues: Set<string>;
  addButtonLabel?: string;
}) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const existing = useMemo(() => new Set(rows.map((r) => r.value)), [rows]);

  return (
    <div className="space-y-1">
      {rows.map((row, idx) => {
        const isEditing = editingIdx === idx;
        const valueLocked = lockedValues.has(row.value);
        const canRemove = allowAddRemove && !valueLocked;

        return (
          <div
            key={idx}
            className={cn(
              'group flex items-center gap-2 rounded-lg border border-transparent px-2 py-2 transition-colors',
              'hover:border-border/70 hover:bg-muted/30',
              isEditing && 'border-border bg-background ring-1 ring-ring/20',
            )}
          >
            {variant === 'violation-status' ? (
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-border/50"
                style={{ backgroundColor: resolvedViolationStatusHex(row) }}
                aria-hidden
              />
            ) : null}
            <div className="min-w-0 flex-1">
              {isEditing ? (
                <div
                  className="flex w-full flex-col gap-2"
                  onBlur={(e) => {
                    const nextFocus = e.relatedTarget as Node | null;
                    if (nextFocus && e.currentTarget.contains(nextFocus)) return;
                    setEditingIdx(null);
                  }}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      value={row.label}
                      autoFocus
                      className="h-9 text-sm"
                      onChange={(e) => {
                        const next = [...rows];
                        next[idx] = { ...row, label: e.target.value };
                        onChange(next);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setEditingIdx(null);
                      }}
                      aria-label="Display label"
                    />
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] text-muted-foreground">Code</span>
                      <Input
                        value={row.value}
                        disabled={valueLocked}
                        className="h-9 max-w-[10rem] font-mono text-xs"
                        onChange={(e) => {
                          const next = [...rows];
                          next[idx] = {
                            ...row,
                            value: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''),
                          };
                          onChange(next);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setEditingIdx(null);
                        }}
                        aria-label={
                          valueLocked
                            ? 'Stored code (built-in, cannot be changed)'
                            : 'Stored code (letters, numbers, underscore only)'
                        }
                      />
                    </div>
                  </div>
                  {variant === 'violation-status' ? (
                    <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
                      <span className="text-[10px] font-medium text-muted-foreground">Dot color</span>
                      <input
                        type="color"
                        className="h-9 w-14 cursor-pointer rounded border border-input bg-background p-0.5"
                        value={resolvedViolationStatusHex(row)}
                        onChange={(e) => {
                          const next = [...rows];
                          next[idx] = { ...row, color: e.target.value };
                          onChange(next);
                        }}
                        aria-label="Dot color for this status"
                      />
                      {row.color ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs text-muted-foreground"
                          onClick={() => {
                            const next = [...rows];
                            const rest = { ...row };
                            delete rest.color;
                            next[idx] = rest;
                            onChange(next);
                          }}
                        >
                          Use default color
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                <button
                  type="button"
                  className="flex w-full min-w-0 items-center gap-2 text-left text-sm font-medium text-foreground"
                  onClick={() => setEditingIdx(idx)}
                >
                  <span className="truncate">{row.label || 'Untitled'}</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className="inline-flex shrink-0 rounded bg-muted/80 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                        tabIndex={0}
                      >
                        {row.value}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
                      {valueLocked ? (
                        <>
                          Built-in code <span className="font-mono font-semibold">{row.value}</span>. Only the label
                          can change; this row cannot be removed.
                        </>
                      ) : (
                        <>
                          Stored code <span className="font-mono font-semibold">{row.value}</span> — used by the
                          system on forms, filters, and exports. Change with care if data already uses this code.
                        </>
                      )}
                    </TooltipContent>
                  </Tooltip>
                </button>
              )}
            </div>
            <div
              className={cn(
                'flex shrink-0 items-center gap-0.5',
                isEditing ? 'opacity-100' : 'opacity-0 transition-opacity group-hover:opacity-100',
              )}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                onClick={() => setEditingIdx(idx)}
                aria-label="Edit row"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                disabled={!canRemove}
                onClick={() => {
                  onChange(rows.filter((_, i) => i !== idx));
                  setEditingIdx((e) => {
                    if (e === null) return null;
                    if (e === idx) return null;
                    if (e > idx) return e - 1;
                    return e;
                  });
                }}
                aria-label={`Remove ${row.label || row.value}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        );
      })}
      {allowAddRemove ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2 w-full sm:w-auto"
          onClick={() => {
            onChange([...rows, { value: newCatalogListSlug(existing), label: 'New option' }]);
          }}
        >
          <Plus className="h-4 w-4 mr-1" />
          {addButtonLabel}
        </Button>
      ) : null}
    </div>
  );
}

const DEFAULT_VISITOR_PRESET_IDS = new Set(DEFAULT_DROPDOWN_CATALOG.visitorPurposePresets.map((p) => p.id));

type VisitKindValue = `${VisitorPurposePreset['category']}:${VisitorPurposePreset['rentedFieldMode']}`;

const VISIT_KIND_OPTIONS: { value: VisitKindValue; label: string; hint: string }[] = [
  {
    value: 'guest:resident',
    label: 'Visiting a resident',
    hint: 'Shows the resident search on the register form.',
  },
  {
    value: 'guest:facility',
    label: 'Community space or facility',
    hint: 'Uses your facility list (e.g. hall, court).',
  },
  {
    value: 'guest:none',
    label: 'Guest visit — name only',
    hint: 'No resident or facility step.',
  },
  {
    value: 'delivery:none',
    label: 'Delivery or courier',
    hint: 'Grouped as delivery for reporting.',
  },
  {
    value: 'rental:facility',
    label: 'Reservation or paid parking',
    hint: 'Uses the facility list for where they park.',
  },
  {
    value: 'rental:none',
    label: 'Rental — name only',
    hint: 'No location picker (uncommon).',
  },
];

function patchPreset(rows: VisitorPurposePreset[], id: string, patch: Partial<VisitorPurposePreset>) {
  return rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
}

function presetKindValue(row: VisitorPurposePreset): VisitKindValue {
  return `${row.category}:${row.rentedFieldMode}`;
}

function parseVisitKindValue(v: string): Pick<VisitorPurposePreset, 'category' | 'rentedFieldMode'> | null {
  const [c, m] = v.split(':');
  if (c !== 'guest' && c !== 'delivery' && c !== 'rental') return null;
  if (m !== 'none' && m !== 'resident' && m !== 'facility') return null;
  return {
    category: c as VisitorPurposePreset['category'],
    rentedFieldMode: m as VisitorPurposePreset['rentedFieldMode'],
  };
}

function newCustomVisitorPresetId() {
  return `visit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function orderedVisitorPresets(rows: VisitorPurposePreset[]): VisitorPurposePreset[] {
  const order = DEFAULT_DROPDOWN_CATALOG.visitorPurposePresets.map((p) => p.id);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const builtins = order.map((id) => byId.get(id)).filter(Boolean) as VisitorPurposePreset[];
  const builtinSet = new Set(order);
  const customs = rows.filter((r) => !builtinSet.has(r.id));
  return [...builtins, ...customs];
}

function VisitorPurposePreviewColumn({ rows }: { rows: VisitorPurposePreset[] }) {
  const ordered = useMemo(() => orderedVisitorPresets(rows), [rows]);
  return (
    <aside className="hidden xl:block min-w-0">
      <div className="sticky top-28 space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Compass className="h-3.5 w-3.5 shrink-0" />
          Live preview
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Visitor page tab chips update live as you edit labels on the left.
        </p>
        <div className="rounded-lg border border-border/80 bg-muted/40 p-2">
          <div className="flex flex-wrap gap-2">
            {ordered.map((row) => (
              <span
                key={row.id}
                className="inline-flex max-w-[11rem] truncate rounded-md border border-border/60 bg-background px-2 py-1 text-xs font-medium text-foreground shadow-sm"
                title={row.label}
              >
                {row.label.trim() || '—'}
              </span>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

function VisitorPurposeSimpleEditor({
  rows,
  onChange,
}: {
  rows: VisitorPurposePreset[];
  onChange: (next: VisitorPurposePreset[]) => void;
}) {
  const ordered = useMemo(() => orderedVisitorPresets(rows), [rows]);

  const disclaimer =
    'Built-in purposes keep the same stored values so existing visitor records still match. Extra purposes you add use the label as the stored value (the server adjusts duplicates). Use Save all settings when you are done.';

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Name each tab and pick one plain-English visit type. The preview matches how the chip looks on the Visitors
          page.
        </p>

        <div className="space-y-3">
          {ordered.map((row) => {
            const builtin = DEFAULT_VISITOR_PRESET_IDS.has(row.id);
            const kind = presetKindValue(row);
            return (
              <div
                key={row.id}
                className="rounded-lg border border-border bg-card p-3 sm:p-4 space-y-3 shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={cn(
                      'text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full',
                      builtin ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary',
                    )}
                  >
                    {builtin ? 'Built-in' : 'Your purpose'}
                  </span>
                  {!builtin && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-destructive hover:text-destructive"
                      onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      Remove
                    </Button>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
                  <div className="space-y-1.5 min-w-0">
                    <Label className="text-xs text-muted-foreground">Tab label</Label>
                    <Input
                      value={row.label}
                      onChange={(e) => {
                        const label = e.target.value;
                        if (builtin) {
                          onChange(patchPreset(rows, row.id, { label }));
                        } else {
                          const t = label.trim();
                          onChange(
                            patchPreset(rows, row.id, {
                              label,
                              storageValue: t || row.storageValue,
                            }),
                          );
                        }
                      }}
                      className="text-sm"
                      placeholder="e.g. Visit resident"
                    />
                  </div>
                  <div className="space-y-1.5 min-w-0">
                    <Label className="text-xs text-muted-foreground">Visit type</Label>
                    <Select
                      value={kind}
                      onValueChange={(v) => {
                        const parsed = parseVisitKindValue(v);
                        if (!parsed) return;
                        onChange(patchPreset(rows, row.id, parsed));
                      }}
                    >
                      <SelectTrigger
                        className="w-full text-sm h-10 min-h-10 shrink-0"
                        aria-label={`Visit type for ${row.label}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VISIT_KIND_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value} className="text-sm">
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground leading-snug">
                      {VISIT_KIND_OPTIONS.find((o) => o.value === kind)?.hint}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1 border-t border-border/60">
                  <div className="inline-flex items-center justify-center rounded-md bg-muted p-0.5 text-muted-foreground self-start">
                    <span
                      className="inline-flex max-w-full truncate rounded-sm bg-background px-2 py-1 text-xs font-medium text-foreground shadow-sm"
                      title={row.label}
                    >
                      {row.label.trim() || '—'}
                    </span>
                  </div>
                  {builtin ? (
                    <p className="text-[11px] text-muted-foreground font-mono sm:text-right">
                      Stored value: {row.storageValue}
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground sm:text-right">
                      New visits save under this label (same as the tab unless the server renames duplicates).
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full sm:w-auto"
          onClick={() => {
            const label = 'New visit purpose';
            onChange([
              ...rows,
              {
                id: newCustomVisitorPresetId(),
                label,
                storageValue: label,
                category: 'guest',
                rentedFieldMode: 'none',
              },
            ]);
          }}
        >
          <Plus className="h-4 w-4 mr-1" />
          Add visit purpose
        </Button>

        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="mt-0.5 shrink-0 rounded-full p-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="How visitor purposes are saved"
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
              {disclaimer}
            </TooltipContent>
          </Tooltip>
          <p className="leading-snug flex-1 pr-2">
            <span className="hidden sm:inline">{disclaimer}</span>
            <span className="sm:hidden">Built-ins keep stable stored values; tap the icon for details.</span>
          </p>
        </div>
      </div>
    </TooltipProvider>
  );
}

function SectionCard({
  id,
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  id?: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card id={id} className={cn('scroll-mt-24 border border-border/80 bg-card shadow-none', className)}>
      <CardHeader className="pb-3 space-y-1">
        <CardTitle className="text-lg font-semibold tracking-tight flex items-center gap-2">
          <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
          {title}
        </CardTitle>
        <CardDescription className="text-sm leading-relaxed">{description}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
}

function normalizeStringList(list: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) {
    const t = s.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function snapshotCatalogForCompare(c: DropdownCatalog) {
  return {
    vehicleTypes: c.vehicleTypes.map((x) => ({ value: x.value, label: x.label })),
    residentStreets: normalizeStringList(c.residentStreets),
    rentedVenues: normalizeStringList(c.rentedVenues),
    visitorPurposePresets: c.visitorPurposePresets,
    residentOccupancyTypes: c.residentOccupancyTypes,
    residentStandingFilters: c.residentStandingFilters,
    violationStatusFilters: c.violationStatusFilters,
    userRoles: c.userRoles,
    userStatuses: c.userStatuses,
  };
}

function catalogsDirty(a: DropdownCatalog | null, b: DropdownCatalog | null): boolean {
  if (!a || !b) return false;
  return JSON.stringify(snapshotCatalogForCompare(a)) !== JSON.stringify(snapshotCatalogForCompare(b));
}

export type DropdownCatalogSettingsHandle = {
  discard: () => void;
  saveAll: () => void;
  resetCatalogToDefaults: () => void;
};

export type DropdownCatalogSettingsProps = {
  onDirtyChange?: (dirty: boolean) => void;
};

export const DropdownCatalogSettings = forwardRef<DropdownCatalogSettingsHandle, DropdownCatalogSettingsProps>(
  function DropdownCatalogSettings({ onDirtyChange }, ref) {
  const queryClient = useQueryClient();
  const { options, isLoading } = useDropdownOptions();
  const [draft, setDraft] = useState<DropdownCatalog | null>(null);
  const [baseline, setBaseline] = useState<DropdownCatalog | null>(null);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!isLoading && !seeded) {
      const initial = JSON.parse(JSON.stringify(options)) as DropdownCatalog;
      setDraft(initial);
      setBaseline(JSON.parse(JSON.stringify(options)) as DropdownCatalog);
      setSeeded(true);
    }
  }, [isLoading, options, seeded]);

  const isDirty = useMemo(() => catalogsDirty(draft, baseline), [draft, baseline]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const saveMutation = useMutation({
    mutationFn: (body: DropdownCatalog) => dropdownOptionsAPI.update(body as unknown as Record<string, unknown>),
    onSuccess: (data: Record<string, unknown>) => {
      const { success: _s, ...rest } = data;
      const next = rest as unknown as DropdownCatalog;
      queryClient.setQueryData(['dropdown-options'], next);
      const clone = JSON.parse(JSON.stringify(next)) as DropdownCatalog;
      setDraft(clone);
      setBaseline(clone);
      toast({ title: 'Settings saved', description: 'All forms now use the updated options.' });
    },
    onError: (e: Error) => {
      toast({
        title: 'Save failed',
        description: e.message || 'Could not persist dropdown lists.',
        variant: 'destructive',
      });
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => dropdownOptionsAPI.reset(),
    onSuccess: (data: Record<string, unknown>) => {
      const { success: _s, ...rest } = data;
      const next = rest as unknown as DropdownCatalog;
      queryClient.setQueryData(['dropdown-options'], next);
      const clone = JSON.parse(JSON.stringify(next)) as DropdownCatalog;
      setDraft(clone);
      setBaseline(clone);
      toast({ title: 'Defaults restored', description: 'Dropdown lists were reset to built-in defaults.' });
    },
    onError: (e: Error) => {
      toast({
        title: 'Reset failed',
        description: e.message || 'Could not reset dropdown lists.',
        variant: 'destructive',
      });
    },
  });

  const handleSave = useCallback(() => {
    if (!draft) return;
    const payload: DropdownCatalog = {
      ...draft,
      residentStreets: normalizeStringList(draft.residentStreets),
      rentedVenues: normalizeStringList(draft.rentedVenues),
    };
    saveMutation.mutate(payload);
  }, [draft, saveMutation]);

  const handleDiscard = useCallback(() => {
    if (!baseline) return;
    setDraft(JSON.parse(JSON.stringify(baseline)) as DropdownCatalog);
  }, [baseline]);

  useImperativeHandle(
    ref,
    () => ({
      discard: handleDiscard,
      saveAll: handleSave,
      resetCatalogToDefaults: () => resetMutation.mutate(),
    }),
    [handleDiscard, handleSave, resetMutation],
  );

  if (!draft) {
    return (
      <Card className="border border-border/80 bg-card shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <ListTree className="h-5 w-5" />
            Form options
          </CardTitle>
          <CardDescription>Loading catalog…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-10 pb-8">
      <header className="space-y-2 border-b border-border/80 pb-6">
        <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2 text-foreground">
          <ListTree className="h-5 w-5 shrink-0 text-muted-foreground" />
          Forms &amp; dropdowns
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-3xl">
          What you change here updates live in most screens. Use the sidebar to jump between areas. Save once when
          you are done—discard brings back the last saved copy.
        </p>
      </header>

      <div id="settings-general" className="scroll-mt-24 space-y-6">
        <SectionCard
          icon={Car}
          title="Vehicle types"
          description="What drivers see when registering vehicles. Hover a row for the stored code; click the label to edit."
        >
          <QuietVehicleTypesEditor
            rows={draft.vehicleTypes}
            onChange={(vehicleTypes) => setDraft({ ...draft, vehicleTypes })}
          />
        </SectionCard>

        <SectionCard
          icon={MapPin}
          title="Resident streets and camera locations"
          description="Allowed street and zone names for residents and cameras. Click a row to edit; hover for actions."
        >
          <QuietStringListEditor
            items={draft.residentStreets}
            onChange={(residentStreets) => setDraft({ ...draft, residentStreets })}
            addLabel="Add street"
            rowPlaceholder="e.g. Twin Peaks Drive"
          />
        </SectionCard>

        <SectionCard
          icon={Building2}
          title="Visitor facilities and rented venues"
          description="Shown when visitors pick a facility instead of a named resident."
        >
          <QuietStringListEditor
            items={draft.rentedVenues}
            onChange={(rentedVenues) => setDraft({ ...draft, rentedVenues })}
            addLabel="Add venue"
            rowPlaceholder="e.g. Community Center"
          />
        </SectionCard>
      </div>

      <div id="settings-visitors" className="scroll-mt-24">
        <SectionCard
          icon={Compass}
          title="Visitor purpose tabs"
          description="Rename tabs, choose how each visit type behaves, or add extra purposes. The Visitors page updates as you type."
        >
          <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,17.5rem)] xl:gap-8 xl:items-start">
            <VisitorPurposeSimpleEditor
              rows={draft.visitorPurposePresets}
              onChange={(visitorPurposePresets) => {
                setDraft((d) => (d ? { ...d, visitorPurposePresets } : d));
                queryClient.setQueryData(['dropdown-options'], (prev) => {
                  const base = (prev as DropdownCatalog | undefined) ?? DEFAULT_DROPDOWN_CATALOG;
                  return { ...base, visitorPurposePresets };
                });
              }}
            />
            <VisitorPurposePreviewColumn rows={draft.visitorPurposePresets} />
          </div>
        </SectionCard>
      </div>

      <div id="settings-residents" className="scroll-mt-24">
        <Card className="border border-border/80 bg-card shadow-none">
            <CardHeader className="pb-3 space-y-1">
              <CardTitle className="text-lg font-semibold tracking-tight flex items-center gap-2">
                <Users className="h-5 w-5 shrink-0 text-muted-foreground" />
                Residents — forms and filters
              </CardTitle>
              <CardDescription className="text-sm leading-relaxed">
                Rename what residents and barangay staff see on forms and filters. Hover a row for the stored code;
                click the label to edit.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              <Card className="border-border/80 shadow-none">
                <CardHeader className="space-y-1 pb-2">
                  <CardTitle className="text-sm font-semibold">Occupancy types</CardTitle>
                  <CardDescription className="text-xs leading-relaxed">
                    Labels and codes for the resident registration form. Homeowner and tenant cannot be removed (the
                    server always keeps them); you can add more types—saving writes allowed codes to the database.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <QuietKeyLabelListEditor
                    variant="plain"
                    allowAddRemove
                    lockedValues={OCCUPANCY_VALUE_LOCK}
                    addButtonLabel="Add occupancy type"
                    rows={draft.residentOccupancyTypes}
                    onChange={(residentOccupancyTypes) => setDraft({ ...draft, residentOccupancyTypes })}
                  />
                </CardContent>
              </Card>

              <Card className="border-border/80 shadow-none">
                <CardHeader className="space-y-1 pb-2">
                  <CardTitle className="text-sm font-semibold">Resident list filters</CardTitle>
                  <CardDescription className="text-xs leading-relaxed">
                    Wording for the violation-record filter on the Residents page. Built-in keys drive filtering; extra
                    rows appear in the dropdown but behave like &quot;All&quot; until the app is extended for them.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <QuietKeyLabelListEditor
                    variant="plain"
                    allowAddRemove
                    lockedValues={STANDING_VALUE_LOCK}
                    addButtonLabel="Add filter"
                    rows={draft.residentStandingFilters}
                    onChange={(residentStandingFilters) => setDraft({ ...draft, residentStandingFilters })}
                  />
                </CardContent>
              </Card>

              <Card className="border-border/80 shadow-none">
                <CardHeader className="space-y-1 pb-2">
                  <CardTitle className="text-sm font-semibold">Violation status labels</CardTitle>
                  <CardDescription className="text-xs leading-relaxed">
                    Labels for the status dropdown on Violation History. Each row has a dot color (defaults match the
                    tables—e.g. warning = amber, issued = red). Edit a row to pick a custom dot color, or reset to the
                    default for that code.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <QuietKeyLabelListEditor
                    variant="violation-status"
                    allowAddRemove
                    lockedValues={VIOLATION_STATUS_VALUE_LOCK}
                    addButtonLabel="Add status label"
                    rows={draft.violationStatusFilters}
                    onChange={(violationStatusFilters) => setDraft({ ...draft, violationStatusFilters })}
                  />
                </CardContent>
              </Card>
            </CardContent>
          </Card>
      </div>

      <div id="settings-users" className="scroll-mt-24">
        <Card className="border border-border/80 bg-card shadow-none">
            <CardHeader className="pb-3 space-y-1">
              <CardTitle className="text-lg font-semibold tracking-tight flex items-center gap-2">
                <UserCog className="h-5 w-5 shrink-0 text-muted-foreground" />
                User management — invite dialog
              </CardTitle>
              <CardDescription className="text-sm leading-relaxed">
                Adjust wording in the invite-user dialog. Hover a row for the stored code; click the label to edit.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              <Card className="border-border/80 shadow-none">
                <CardHeader className="space-y-1 pb-2">
                  <CardTitle className="text-sm font-semibold">Roles</CardTitle>
                <CardDescription className="text-xs leading-relaxed">
                  Labels for encoder vs barangay user when an admin invites someone to the system. Invites still only
                  support those two roles—extra rows are optional (e.g. future roles or notes).
                </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <QuietKeyLabelListEditor
                    variant="plain"
                    allowAddRemove
                    lockedValues={USER_ROLE_VALUE_LOCK}
                    addButtonLabel="Add role label"
                    rows={draft.userRoles}
                    onChange={(userRoles) => setDraft({ ...draft, userRoles })}
                  />
                </CardContent>
              </Card>

              <Card className="border-border/80 shadow-none">
                <CardHeader className="space-y-1 pb-2">
                  <CardTitle className="text-sm font-semibold">Account status</CardTitle>
                <CardDescription className="text-xs leading-relaxed">
                  How “active” and “inactive” read in the invite dialog (permissions still follow the real account
                  state). Invites only support those two statuses—extra rows are for wording or future use.
                </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <QuietKeyLabelListEditor
                    variant="plain"
                    allowAddRemove
                    lockedValues={USER_STATUS_VALUE_LOCK}
                    addButtonLabel="Add status label"
                    rows={draft.userStatuses}
                    onChange={(userStatuses) => setDraft({ ...draft, userStatuses })}
                  />
                </CardContent>
              </Card>
            </CardContent>
          </Card>
      </div>
    </div>
  );
});
