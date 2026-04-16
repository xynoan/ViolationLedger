import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Car,
  Info,
  Home,
  ChevronDown,
  X,
  MapPin,
  Shield,
  AlertTriangle,
  AlertCircle,
  type LucideIcon,
} from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { usePageTracking } from '@/hooks/usePageTracking';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Vehicle, Resident, ResidentType, Violation } from '@/types/parking';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { vehiclesAPI, residentsAPI, violationsAPI } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { SearchNoMatchesEmpty } from '@/components/search/SearchNoMatchesEmpty';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { formatResidentAddressLine } from '@/lib/residentStreets';

const VEHICLE_TYPE_OPTIONS = [
  { value: 'car', label: 'Car' },
  { value: 'motorcycle', label: 'Motorcycle' },
  { value: 'truck', label: 'Truck' },
  { value: 'van', label: 'Van' },
  { value: 'suv', label: 'SUV' },
  { value: 'tricycle', label: 'Tricycle' },
  { value: 'other', label: 'Other' },
] as const;

function errMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const digitsOnly = (value: string) => value.replace(/\D/g, '');
const lettersAndSpacesOnly = (value: string) => value.replace(/[^a-zA-Z\s]/g, '');
const ownerNameValid = (value: string) => /^[a-zA-Z\s]+$/.test(value.trim());

function formatVehicleTypeLabel(value?: string): string {
  if (!value?.trim()) return '—';
  const v = value.trim().toLowerCase();
  const found = VEHICLE_TYPE_OPTIONS.find((o) => o.value === v);
  return found?.label ?? value;
}

const normPlate = (p: string) => String(p || '').replace(/\s+/g, '').toUpperCase();

type OwnerSuggestSurface = 'inline' | 'dialog' | null;

function violationsForResidentLinkedPlates(
  residentId: string,
  vehicleRows: Vehicle[],
  violationRows: Violation[],
): Violation[] {
  const plates = new Set(
    vehicleRows.filter((v) => v.residentId === residentId).map((v) => normPlate(v.plateNumber)),
  );
  if (plates.size === 0) return [];
  return violationRows.filter((vi) => plates.has(normPlate(vi.plateNumber)));
}

function countUnpaidViolationsForResident(
  residentId: string,
  vehicleRows: Vehicle[],
  violationRows: Violation[],
): number {
  return violationsForResidentLinkedPlates(residentId, vehicleRows, violationRows).filter(
    (vi) => vi.status === 'issued' || vi.status === 'pending',
  ).length;
}

function getStandingPresentation(unpaid: number): { label: string; className: string; Icon: LucideIcon } {
  if (unpaid === 0) {
    return {
      label: 'Good Standing',
      className:
        'border-emerald-600/50 bg-emerald-600/12 text-emerald-950 dark:text-emerald-100 [&>svg]:text-emerald-700 dark:[&>svg]:text-emerald-300',
      Icon: Shield,
    };
  }
  if (unpaid <= 2) {
    return {
      label: 'Warning',
      className:
        'border-amber-500/55 bg-amber-500/12 text-amber-950 dark:text-amber-50 [&>svg]:text-amber-700 dark:[&>svg]:text-amber-300',
      Icon: AlertTriangle,
    };
  }
  return {
    label: 'Delinquent',
    className:
      'border-red-600/50 bg-red-600/12 text-red-950 dark:text-red-100 [&>svg]:text-red-700 dark:[&>svg]:text-red-300',
    Icon: AlertCircle,
  };
}

function resolveResidentType(r: Resident): ResidentType {
  const t = r.residentType?.toLowerCase?.();
  if (t === 'tenant') return 'tenant';
  return 'homeowner';
}

function residentTypeBadgeClass(type: ResidentType): string {
  return type === 'tenant'
    ? 'border-purple-600/55 bg-purple-600 text-white shadow-none hover:bg-purple-600/95 dark:bg-purple-700'
    : 'border-blue-600/55 bg-blue-600 text-white shadow-none hover:bg-blue-600/95 dark:bg-blue-700';
}

export default function Vehicles() {
  usePageTracking();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isEncoder = user?.role === 'encoder';
   const isBarangayUser = user?.role === 'barangay_user';
   const isAdmin = user?.role === 'admin';
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [vehicleToDelete, setVehicleToDelete] = useState<Vehicle | null>(null);
  const [isDeletingVehicle, setIsDeletingVehicle] = useState(false);
  const [formData, setFormData] = useState({
    plateNumber: '',
    ownerName: '',
    residentId: '',
    vehicleType: 'car' as string,
  });
  const [ownerSuggestSurface, setOwnerSuggestSurface] = useState<OwnerSuggestSurface>(null);
  const ownerComboInlineRef = useRef<HTMLDivElement>(null);
  const ownerComboDialogRef = useRef<HTMLDivElement>(null);
  const plateInputRef = useRef<HTMLInputElement>(null);
  const registrationSectionRef = useRef<HTMLElement>(null);

  // Load vehicles from API
  const loadResidents = useCallback(async () => {
    try {
      const data = await residentsAPI.getAll();
      setResidents(data);
    } catch (error) {
      console.error('Error loading residents:', error);
    }
  }, []);

  const loadVehicles = useCallback(async (initial = false, term = '') => {
    try {
      if (initial) {
        setIsInitialLoading(true);
      } else {
        setIsRefreshing(true);
      }
      const data = await vehiclesAPI.getAll(term || undefined);
      setVehicles(data);
    } catch (error) {
      console.error('Error loading vehicles:', error);
      toast({
        title: "Error",
        description: "Failed to load vehicles. Make sure the backend server is running.",
        variant: "destructive",
      });
    } finally {
      if (initial) {
        setIsInitialLoading(false);
      } else {
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    loadVehicles(true);
  }, [loadVehicles]);

  useEffect(() => {
    if (isInitialLoading) return;
    const timeout = setTimeout(() => {
      loadVehicles(false, searchTerm);
    }, 250);
    return () => clearTimeout(timeout);
  }, [isInitialLoading, loadVehicles, searchTerm]);

  // Load residents on mount so view dialog can resolve resident names
  useEffect(() => {
    loadResidents();
  }, [loadResidents]);

  useEffect(() => {
    let cancelled = false;
    violationsAPI
      .getAll({ limit: 500 })
      .then((raw) => {
        if (cancelled) return;
        setViolations(
          raw.map((x: Violation) => ({
            ...x,
            timeDetected:
              x.timeDetected instanceof Date ? x.timeDetected : new Date(x.timeDetected as unknown as string),
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setViolations([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const residentIdsRegistered = useMemo(() => new Set(residents.map((r) => r.id)), [residents]);

  const vehiclesLinkedToRegisteredResidents = useMemo(
    () => vehicles.filter((v) => v.residentId && residentIdsRegistered.has(v.residentId)),
    [vehicles, residentIdsRegistered],
  );

  const filteredLinkedVehicles = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return vehiclesLinkedToRegisteredResidents;
    return vehiclesLinkedToRegisteredResidents.filter(
      (v) =>
        v.plateNumber.toLowerCase().includes(q) || v.ownerName.toLowerCase().includes(q),
    );
  }, [vehiclesLinkedToRegisteredResidents, searchTerm]);

  const residentFilterId = searchParams.get('residentId')?.trim() ?? '';
  const [residentFilterLabel, setResidentFilterLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!residentFilterId) {
      setResidentFilterLabel(null);
      return;
    }
    const local = residents.find((r) => r.id === residentFilterId);
    if (local) {
      setResidentFilterLabel(local.name);
      return;
    }
    let cancelled = false;
    residentsAPI
      .getById(residentFilterId)
      .then((r) => {
        if (!cancelled) setResidentFilterLabel(r.name);
      })
      .catch(() => {
        if (!cancelled) setResidentFilterLabel(null);
      });
    return () => {
      cancelled = true;
    };
  }, [residentFilterId, residents]);

  const displayedLinkedVehicles = useMemo(() => {
    if (!residentFilterId) return filteredLinkedVehicles;
    return filteredLinkedVehicles.filter((v) => v.residentId === residentFilterId);
  }, [filteredLinkedVehicles, residentFilterId]);

  const ownerQuery = formData.ownerName.trim().toLowerCase();
  const suggestedResidents = useMemo(() => {
    if (!residents.length) return [];
    const q = ownerQuery;
    const filtered = residents.filter((r) => {
      if (!q) return true;
      const name = r.name.toLowerCase();
      const phone = r.contactNumber.replace(/\D/g, '');
      const qDigits = q.replace(/\D/g, '');
      return name.includes(q) || (qDigits.length > 0 && phone.includes(qDigits));
    });
    return filtered.slice(0, 12);
  }, [residents, ownerQuery]);

  useEffect(() => {
    if (!ownerSuggestSurface) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      const inInline = ownerComboInlineRef.current?.contains(t);
      const inDialog = ownerComboDialogRef.current?.contains(t);
      if (!inInline && !inDialog) {
        setOwnerSuggestSurface(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [ownerSuggestSurface]);

  const focusRegistrationSection = useCallback(() => {
    registrationSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    requestAnimationFrame(() => {
      plateInputRef.current?.focus();
    });
  }, []);

  const clearResidentFilter = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('residentId');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const resetForm = () => {
    setFormData({
      plateNumber: '',
      ownerName: '',
      residentId: '',
      vehicleType: 'car',
    });
    setEditingVehicle(null);
    setOwnerSuggestSurface(null);
  };

  const handleOpenEditDialog = (vehicle: Vehicle) => {
    if (isBarangayUser) {
      toast({
        title: "Permission Denied",
        description: "Barangay users are not allowed to modify vehicles.",
        variant: "destructive",
      });
      return;
    }

    if (isEncoder) {
      toast({
        title: "Permission Denied",
        description: "Encoders can only add new vehicles, not edit existing ones.",
        variant: "destructive",
      });
      return;
    }

    setOwnerSuggestSurface(null);
    setEditingVehicle(vehicle);
    setFormData({
      plateNumber: vehicle.plateNumber.toUpperCase(),
      ownerName: vehicle.ownerName,
      residentId: vehicle.residentId || '',
      vehicleType: vehicle.vehicleType || 'car',
    });
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    resetForm();
  };

  const submitVehicle = async (opts: { mode: 'create' | 'update'; addAnother?: boolean }) => {
    if (isBarangayUser) {
      toast({
        title: "Permission Denied",
        description: "Barangay users are not allowed to modify vehicles.",
        variant: "destructive",
      });
      return;
    }

    const plateTrimmed = formData.plateNumber.trim();
    const ownerTrimmed = formData.ownerName.trim();
    const linkedResident = formData.residentId
      ? residents.find((r) => r.id === formData.residentId)
      : undefined;
    const contactForPayload = linkedResident ? digitsOnly(linkedResident.contactNumber) : '';

    if (!plateTrimmed || !ownerTrimmed) {
      toast({
        title: "Validation Error",
        description: "Please fill in plate number and owner name",
        variant: "destructive",
      });
      return;
    }

    if (!formData.vehicleType) {
      toast({
        title: "Validation Error",
        description: "Please select a vehicle type",
        variant: "destructive",
      });
      return;
    }

    if (!ownerNameValid(formData.ownerName)) {
      toast({
        title: "Validation Error",
        description: "Owner name may only contain letters and spaces",
        variant: "destructive",
      });
      return;
    }

    const payloadBase = {
      plateNumber: plateTrimmed.toUpperCase(),
      ownerName: ownerTrimmed,
      contactNumber: contactForPayload,
      residentId: formData.residentId || null,
      rented: null as string | null,
      vehicleType: formData.vehicleType,
    };

    const residentIdSnapshot = formData.residentId || '';
    const editingResidentIdSnapshot = editingVehicle?.residentId || '';

    try {
      if (opts.mode === 'update') {
        if (!editingVehicle) return;
        await vehiclesAPI.update(editingVehicle.id, {
          ...payloadBase,
        });
        toast({
          title: "Vehicle Updated",
          description: "Vehicle details updated successfully",
        });
        handleCloseDialog();
      } else {
        const vehicleId = `VEH-${Date.now()}`;
        await vehiclesAPI.create({
          id: vehicleId,
          ...payloadBase,
          purposeOfVisit: null,
          dataSource: 'barangay',
        });
        if (opts.addAnother) {
          resetForm();
          toast({
            title: 'Saved',
            description: 'Vehicle registered.',
            duration: 1800,
            className:
              'py-3 pr-10 text-sm border-emerald-600/35 bg-emerald-50/95 dark:bg-emerald-950/50 sm:bottom-6',
          });
          requestAnimationFrame(() => {
            plateInputRef.current?.focus();
          });
        }
      }

      loadVehicles();
      const affectedResidentIds = new Set<string>();
      if (residentIdSnapshot) affectedResidentIds.add(residentIdSnapshot);
      if (editingResidentIdSnapshot) affectedResidentIds.add(editingResidentIdSnapshot);
      affectedResidentIds.forEach((rid) => {
        queryClient.invalidateQueries({ queryKey: ['violations', 'byResident', rid] });
      });
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: errMessage(error, "Failed to save vehicle"),
        variant: "destructive",
      });
    }
  };

  const selectOwnerResident = (r: Resident) => {
    setFormData((prev) => ({
      ...prev,
      residentId: r.id,
      ownerName: r.name,
    }));
    setOwnerSuggestSurface(null);
  };

  const clearOwnerField = useCallback(() => {
    setFormData((prev) => ({ ...prev, ownerName: '', residentId: '' }));
    setOwnerSuggestSurface(null);
  }, []);

  const getResidentNameForVehicle = (vehicle: Vehicle) => {
    if (!vehicle.residentId) return null;
    const resident = residents.find((r) => r.id === vehicle.residentId);
    return resident?.name || null;
  };

  const residentForInfoDialog = useMemo(() => {
    if (!selectedVehicle?.residentId) return null;
    return residents.find((r) => r.id === selectedVehicle.residentId) ?? null;
  }, [selectedVehicle, residents]);

  const standingForInfoDialog = useMemo(() => {
    if (!residentForInfoDialog) return null;
    const unpaid = countUnpaidViolationsForResident(
      residentForInfoDialog.id,
      vehicles,
      violations,
    );
    return getStandingPresentation(unpaid);
  }, [residentForInfoDialog, vehicles, violations]);

  const requestDeleteVehicle = (vehicle: Vehicle) => {
    if (isEncoder || isBarangayUser) {
      toast({
        title: "Permission Denied",
        description: "You do not have permission to delete vehicles.",
        variant: "destructive",
      });
      return;
    }
    setVehicleToDelete(vehicle);
  };

  const confirmDeleteVehicle = async () => {
    if (!vehicleToDelete) return;
    if (isEncoder || isBarangayUser) {
      setVehicleToDelete(null);
      return;
    }
    const id = vehicleToDelete.id;
    const residentIdForInvalidate = vehicleToDelete.residentId;
    setIsDeletingVehicle(true);
    try {
      await vehiclesAPI.delete(id);
      toast({
        title: "Vehicle Deleted",
        description: "Vehicle removed from registry",
      });
      setVehicleToDelete(null);
      loadVehicles();
      if (residentIdForInvalidate) {
        queryClient.invalidateQueries({ queryKey: ['violations', 'byResident', residentIdForInvalidate] });
      }
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: errMessage(error, "Failed to delete vehicle"),
        variant: "destructive",
      });
    } finally {
      setIsDeletingVehicle(false);
    }
  };

  const deleteButtonClassName =
    'h-8 w-8 border-red-600 text-red-600 hover:bg-red-600/15 hover:text-red-700 dark:hover:bg-red-600/20';

  const handleViewVehicle = (vehicle: Vehicle) => {
    setSelectedVehicle(vehicle);
    setIsViewDialogOpen(true);
  };

  if (isInitialLoading) {
    return (
      <div className="min-h-screen">
        <Header 
          title="Vehicle Registry" 
          subtitle="Manage registered vehicles"
        />
        <div className="p-4 sm:p-6 flex items-center justify-center min-h-[50vh]">
          <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header 
        title="Vehicle Registry" 
        subtitle="Manage registered vehicles"
      />

      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        <div className="flex items-start gap-2 rounded-lg border border-border bg-card/70 px-3 py-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 text-primary" />
          <p className="leading-relaxed">
            This registry lists vehicles linked to a registered resident. Use Vehicle registration below to add plates
            quickly; link a resident under Owner for SMS and enforcement workflows.
          </p>
        </div>
        {residentFilterId && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5 text-sm">
            <div className="flex items-start gap-2 text-muted-foreground">
              <Home className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <p>
                Showing vehicles linked to{' '}
                <span className="font-medium text-foreground">
                  {residentFilterLabel ?? 'resident'}
                </span>
                {residentFilterLabel ? null : ' (loading name…)'}
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={clearResidentFilter}>
              Show all vehicles
            </Button>
          </div>
        )}
        {!isBarangayUser && (
          <section
            ref={registrationSectionRef}
            className="rounded-xl border border-border bg-card/80 p-4 sm:p-5 space-y-4 shadow-sm"
          >
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">Vehicle registration</h2>
                <p className="text-sm text-muted-foreground">
                  Rapid entry for security: save clears the form and returns focus to plate number. Press Enter on the
                  owner field to save.
                </p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="reg-plateNumber">Plate number *</Label>
                <Input
                  ref={plateInputRef}
                  id="reg-plateNumber"
                  placeholder="ABC 1234"
                  value={formData.plateNumber}
                  onChange={(e) =>
                    setFormData({ ...formData, plateNumber: e.target.value.toUpperCase() })
                  }
                  className="bg-secondary uppercase"
                  autoCapitalize="characters"
                  spellCheck={false}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-vehicleType">Vehicle type *</Label>
                <Select
                  value={formData.vehicleType}
                  onValueChange={(v) => setFormData({ ...formData, vehicleType: v })}
                >
                  <SelectTrigger id="reg-vehicleType" className="bg-secondary">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {VEHICLE_TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2 lg:col-span-1">
                <Label htmlFor="reg-ownerName">Owner *</Label>
                <div ref={ownerComboInlineRef} className="relative">
                  <div className="relative">
                    <Input
                      id="reg-ownerName"
                      placeholder="Search or type owner name…"
                      value={formData.ownerName}
                      onChange={(e) => {
                        const next = lettersAndSpacesOnly(e.target.value);
                        setFormData((prev) => {
                          const linked = prev.residentId
                            ? residents.find((x) => x.id === prev.residentId)
                            : undefined;
                          const keepLink = linked && linked.name === next;
                          return {
                            ...prev,
                            ownerName: next,
                            residentId: keepLink ? prev.residentId : '',
                          };
                        });
                        setOwnerSuggestSurface('inline');
                      }}
                      onFocus={() => setOwnerSuggestSurface('inline')}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' || e.shiftKey) return;
                        if (e.nativeEvent.isComposing) return;
                        e.preventDefault();
                        void submitVehicle({ mode: 'create', addAnother: true });
                      }}
                      className="bg-secondary pr-20"
                      inputMode="text"
                      autoComplete="off"
                      aria-autocomplete="list"
                      aria-expanded={ownerSuggestSurface === 'inline'}
                      aria-controls="resident-owner-suggestions-inline"
                    />
                    {formData.ownerName.trim() !== '' ? (
                      <button
                        type="button"
                        className="absolute right-9 top-1/2 z-[1] -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="Clear owner"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => clearOwnerField()}
                      >
                        <X className="h-4 w-4 shrink-0" />
                      </button>
                    ) : null}
                    <ChevronDown className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  </div>
                  {ownerSuggestSurface === 'inline' && suggestedResidents.length > 0 ? (
                    <ul
                      id="resident-owner-suggestions-inline"
                      role="listbox"
                      className={cn(
                        'absolute z-[100] mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-popover py-1 shadow-md',
                      )}
                    >
                      {suggestedResidents.map((r) => (
                        <li key={r.id} role="option" aria-selected={formData.residentId === r.id}>
                          <button
                            type="button"
                            className={cn(
                              'flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                              formData.residentId === r.id && 'bg-accent/60',
                            )}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              selectOwnerResident(r);
                            }}
                          >
                            <span className="font-medium text-foreground">{r.name}</span>
                            <span className="text-xs text-muted-foreground">{r.contactNumber}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                {formData.residentId ? (
                  <p className="text-xs text-muted-foreground">
                    Linked to resident — vehicle will be saved with this resident&apos;s ID.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Type to search residents by name or number, or enter a standalone owner name.
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                className="bg-green-600 text-white hover:bg-green-700"
                onClick={() => void submitVehicle({ mode: 'create', addAnother: true })}
              >
                Save &amp; add another
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => resetForm()}>
                Clear form
              </Button>
            </div>
          </section>
        )}

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4">
          <div className="relative flex-1 sm:max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by plate or owner..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-secondary"
            />
          </div>
        </div>

        {!isBarangayUser && (
          <Dialog
            open={isDialogOpen && !!editingVehicle}
            onOpenChange={(open) => {
              if (!open) handleCloseDialog();
            }}
          >
            <DialogContent className="bg-card border-border mx-4 sm:mx-auto max-w-[calc(100vw-2rem)] sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Edit vehicle</DialogTitle>
                <DialogDescription>Update the vehicle information below.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4 max-h-[80vh] overflow-y-auto">
                <div className="space-y-2">
                  <Label htmlFor="edit-plateNumber">Plate number *</Label>
                  <Input
                    id="edit-plateNumber"
                    placeholder="ABC 1234"
                    value={formData.plateNumber}
                    onChange={(e) =>
                      setFormData({ ...formData, plateNumber: e.target.value.toUpperCase() })
                    }
                    className="bg-secondary uppercase"
                    autoCapitalize="characters"
                    spellCheck={false}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-vehicleType">Vehicle type *</Label>
                  <Select
                    value={formData.vehicleType}
                    onValueChange={(v) => setFormData({ ...formData, vehicleType: v })}
                  >
                    <SelectTrigger id="edit-vehicleType" className="bg-secondary">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {VEHICLE_TYPE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-ownerName">Owner *</Label>
                  <div ref={ownerComboDialogRef} className="relative">
                    <div className="relative">
                      <Input
                        id="edit-ownerName"
                        placeholder="Search or type owner name…"
                        value={formData.ownerName}
                        onChange={(e) => {
                          const next = lettersAndSpacesOnly(e.target.value);
                          setFormData((prev) => {
                            const linked = prev.residentId
                              ? residents.find((x) => x.id === prev.residentId)
                              : undefined;
                            const keepLink = linked && linked.name === next;
                            return {
                              ...prev,
                              ownerName: next,
                              residentId: keepLink ? prev.residentId : '',
                            };
                          });
                          setOwnerSuggestSurface('dialog');
                        }}
                        onFocus={() => setOwnerSuggestSurface('dialog')}
                        className="bg-secondary pr-20"
                        inputMode="text"
                        autoComplete="off"
                        aria-autocomplete="list"
                        aria-expanded={ownerSuggestSurface === 'dialog'}
                        aria-controls="resident-owner-suggestions-dialog"
                      />
                      {formData.ownerName.trim() !== '' ? (
                        <button
                          type="button"
                          className="absolute right-9 top-1/2 z-[1] -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label="Clear owner"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => clearOwnerField()}
                        >
                          <X className="h-4 w-4 shrink-0" />
                        </button>
                      ) : null}
                      <ChevronDown className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    </div>
                    {ownerSuggestSurface === 'dialog' && suggestedResidents.length > 0 ? (
                      <ul
                        id="resident-owner-suggestions-dialog"
                        role="listbox"
                        className={cn(
                          'absolute z-[100] mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-popover py-1 shadow-md',
                        )}
                      >
                        {suggestedResidents.map((r) => (
                          <li key={r.id} role="option" aria-selected={formData.residentId === r.id}>
                            <button
                              type="button"
                              className={cn(
                                'flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                                formData.residentId === r.id && 'bg-accent/60',
                              )}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                selectOwnerResident(r);
                              }}
                            >
                              <span className="font-medium text-foreground">{r.name}</span>
                              <span className="text-xs text-muted-foreground">{r.contactNumber}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  {formData.residentId ? (
                    <p className="text-xs text-muted-foreground">
                      Linked to resident — vehicle will be saved with this resident&apos;s ID.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Type to search residents by name or number, or enter a standalone owner name.
                    </p>
                  )}
                </div>
                <DialogFooter className="!flex-row gap-2 pt-2 sm:justify-stretch">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 border-red-600 bg-red-600 text-white hover:bg-red-700 hover:text-white"
                    onClick={handleCloseDialog}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    className="flex-1 bg-green-600 text-white hover:bg-green-700"
                    onClick={() => void submitVehicle({ mode: 'update' })}
                  >
                    Save changes
                  </Button>
                </DialogFooter>
              </div>
            </DialogContent>
          </Dialog>
        )}
        {isRefreshing && (
          <p className="text-xs text-muted-foreground">Refreshing results...</p>
        )}

        {displayedLinkedVehicles.length > 0 ? (
          <>
            {/* Mobile Cards */}
            <div className="block sm:hidden space-y-3">
              {displayedLinkedVehicles.map((vehicle) => (
                <div key={vehicle.id} className="glass-card rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-medium text-lg">{vehicle.plateNumber}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => handleViewVehicle(vehicle)}
                      aria-label="View resident summary"
                    >
                      <Info className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {formatVehicleTypeLabel(vehicle.vehicleType)}
                  </div>
                  <div className="text-sm text-foreground font-medium">
                    {getResidentNameForVehicle(vehicle) ?? vehicle.ownerName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Date registered: {new Date(vehicle.registeredAt).toLocaleDateString()}
                  </div>
                  {!isEncoder && isAdmin && (
                    <div className="flex items-center gap-1 pt-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenEditDialog(vehicle)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => requestDeleteVehicle(vehicle)}
                        className={deleteButtonClassName}
                        aria-label="Delete vehicle"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Desktop Table */}
            <div className="glass-card rounded-xl overflow-hidden hidden sm:block">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead className="text-muted-foreground">Plate Number</TableHead>
                      <TableHead className="text-muted-foreground">Vehicle Type</TableHead>
                      <TableHead className="text-muted-foreground">Owner (Resident)</TableHead>
                      <TableHead className="text-muted-foreground">Date Registered</TableHead>
                      <TableHead className="text-muted-foreground text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedLinkedVehicles.map((vehicle) => (
                      <TableRow key={vehicle.id} className="border-border">
                        <TableCell className="font-mono font-medium">{vehicle.plateNumber}</TableCell>
                        <TableCell>{formatVehicleTypeLabel(vehicle.vehicleType)}</TableCell>
                        <TableCell className="font-medium">
                          {getResidentNameForVehicle(vehicle) ?? vehicle.ownerName}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(vehicle.registeredAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleViewVehicle(vehicle)}
                              aria-label="View resident summary"
                            >
                              <Info className="h-4 w-4" />
                            </Button>
                            {isAdmin && (
                              <>
                                <Button variant="ghost" size="icon" onClick={() => handleOpenEditDialog(vehicle)}>
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  onClick={() => requestDeleteVehicle(vehicle)}
                                  className={deleteButtonClassName}
                                  aria-label="Delete vehicle"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            <Dialog
              open={isViewDialogOpen}
              onOpenChange={(open) => {
                if (!open) {
                  setIsViewDialogOpen(false);
                  setSelectedVehicle(null);
                }
              }}
            >
              <DialogContent className="bg-card border-border mx-4 sm:mx-auto max-w-[calc(100vw-2rem)] sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>
                    {residentForInfoDialog ? residentForInfoDialog.name : 'Resident summary'}
                  </DialogTitle>
                  <DialogDescription>
                    {selectedVehicle ? (
                      <>
                        Linked resident for vehicle{' '}
                        <span className="font-mono font-medium text-foreground">{selectedVehicle.plateNumber}</span>
                      </>
                    ) : (
                      'Resident details'
                    )}
                  </DialogDescription>
                </DialogHeader>
                {selectedVehicle && residentForInfoDialog && standingForInfoDialog ? (
                  <div className="space-y-4 py-2 text-sm">
                    <div className="flex flex-wrap gap-2">
                      <Badge
                        className={cn(
                          'border font-semibold capitalize shadow-none',
                          residentTypeBadgeClass(resolveResidentType(residentForInfoDialog)),
                        )}
                      >
                        <span className="inline-flex items-center gap-1">
                          {resolveResidentType(residentForInfoDialog) === 'homeowner' ? (
                            <Home className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          ) : null}
                          {resolveResidentType(residentForInfoDialog) === 'homeowner' ? 'Homeowner' : 'Tenant'}
                        </span>
                      </Badge>
                      <Badge
                        className={cn(
                          'inline-flex items-center gap-1 border font-semibold shadow-none',
                          standingForInfoDialog.className,
                        )}
                      >
                        {(() => {
                          const StandingIcon = standingForInfoDialog.Icon;
                          return (
                            <>
                              <StandingIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              {standingForInfoDialog.label}
                            </>
                          );
                        })()}
                      </Badge>
                    </div>
                    <div className="flex items-start gap-2">
                      <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">Address</p>
                        <p className="font-medium text-foreground leading-snug">
                          {formatResidentAddressLine(residentForInfoDialog) || '—'}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Standing is based on issued and pending violations for plates linked to this resident.
                    </p>
                  </div>
                ) : selectedVehicle ? (
                  <p className="text-sm text-muted-foreground py-2">
                    Could not load this resident&apos;s profile. They may have been removed from the registry.
                  </p>
                ) : null}
              </DialogContent>
            </Dialog>

            <AlertDialog
              open={!!vehicleToDelete}
              onOpenChange={(open) => {
                if (!open) setVehicleToDelete(null);
              }}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete vehicle</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete this record?
                    {vehicleToDelete && (
                      <>
                        {' '}
                        This will permanently remove{' '}
                        <span className="font-mono font-medium text-foreground">
                          {vehicleToDelete.plateNumber}
                        </span>{' '}
                        from the registry.
                      </>
                    )}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isDeletingVehicle}>Cancel</AlertDialogCancel>
                  <Button
                    type="button"
                    className="bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600"
                    disabled={isDeletingVehicle}
                    onClick={() => void confirmDeleteVehicle()}
                  >
                    {isDeletingVehicle ? 'Deleting…' : 'Delete'}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : filteredLinkedVehicles.length > 0 && residentFilterId ? (
          <div className="glass-card rounded-xl p-8 sm:p-12 text-center">
            <Car className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No vehicles for this resident</h3>
            <p className="text-muted-foreground mb-6 text-sm max-w-md mx-auto">
              {residentFilterLabel
                ? `No resident-linked vehicles match for ${residentFilterLabel} with the current search.`
                : 'No vehicles match this resident filter.'}
            </p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <Button type="button" variant="secondary" onClick={clearResidentFilter}>
                Show all vehicles
              </Button>
              <Button type="button" variant="outline" onClick={() => setSearchTerm('')}>
                Clear search
              </Button>
            </div>
          </div>
        ) : vehiclesLinkedToRegisteredResidents.length > 0 && searchTerm.trim() ? (
          <SearchNoMatchesEmpty
            searchTerm={searchTerm}
            onClear={() => setSearchTerm('')}
            hint="Check your spelling or try searching for a different plate number or resident owner name."
          />
        ) : vehicles.length > 0 && vehiclesLinkedToRegisteredResidents.length === 0 ? (
          <div className="glass-card rounded-xl p-8 sm:p-12 text-center">
            <Car className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No resident-linked vehicles</h3>
            <p className="text-muted-foreground mb-6 text-sm max-w-md mx-auto">
              This list only shows vehicles tied to a registered resident. Add or edit a vehicle and choose a resident
              under Owner Name to link it.
            </p>
            {!isBarangayUser && (
              <Button type="button" onClick={focusRegistrationSection}>
                <Plus className="h-4 w-4 mr-2" />
                Register vehicle
              </Button>
            )}
          </div>
        ) : (
          <div className="glass-card rounded-xl p-8 sm:p-12 text-center">
            <Car className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No Vehicles Registered</h3>
            <p className="text-muted-foreground mb-6">
              Add your first vehicle to the registry
            </p>
            {!isBarangayUser && (
              <Button type="button" onClick={focusRegistrationSection}>
                <Plus className="h-4 w-4 mr-2" />
                Add your first vehicle
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
