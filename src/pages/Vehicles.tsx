import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Plus,
  Edit,
  Trash2,
  Car,
  Info,
  Home,
  ChevronDown,
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
const VEHICLE_TYPE_OTHER = 'other';

function errMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/** Avoid surfacing raw DB errors if the API ever returns them for duplicate plates. */
function vehiclePlateSaveErrorMessage(error: unknown, fallback: string) {
  const raw = errMessage(error, fallback);
  const lower = raw.toLowerCase();
  if (
    lower.includes('unique constraint') ||
    lower.includes('sqlite_constraint_unique') ||
    lower.includes('vehicles.platenumber')
  ) {
    return 'This plate number already exists.';
  }
  return raw;
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

const VEHICLE_TYPE_PRESET_SLUGS = new Set<string>(
  VEHICLE_TYPE_OPTIONS.filter((o) => o.value !== VEHICLE_TYPE_OTHER).map((o) => o.value),
);

function vehicleMatchesTypeFilter(vehicle: Vehicle, filterSlug: string): boolean {
  if (!filterSlug) return true;
  const t = (vehicle.vehicleType || '').trim().toLowerCase();
  if (filterSlug === VEHICLE_TYPE_OTHER) return !VEHICLE_TYPE_PRESET_SLUGS.has(t);
  return t === filterSlug;
}

function registeredAtMatchesDay(registeredAt: Date | string, isoDay: string): boolean {
  const day = isoDay.trim();
  if (!day) return true;
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return true;
  const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  const end = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
  const ts = new Date(registeredAt).getTime();
  return ts >= start && ts <= end;
}

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
  const [filterPlate, setFilterPlate] = useState('');
  const [filterVehicleType, setFilterVehicleType] = useState('');
  const [filterOwner, setFilterOwner] = useState('');
  const [filterRegisteredOn, setFilterRegisteredOn] = useState('');
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
    vehicleTypeOther: '',
  });
  const [ownerSuggestOpen, setOwnerSuggestOpen] = useState(false);
  const ownerComboRef = useRef<HTMLDivElement>(null);

  // Load vehicles from API
  const loadResidents = useCallback(async () => {
    try {
      const data = await residentsAPI.getAll();
      setResidents(data);
    } catch (error) {
      console.error('Error loading residents:', error);
    }
  }, []);

  const loadVehicles = useCallback(async (initial = false) => {
    try {
      if (initial) {
        setIsInitialLoading(true);
      } else {
        setIsRefreshing(true);
      }
      const data = await vehiclesAPI.getAll();
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
    const plateQ = normPlate(filterPlate);
    const ownerQ = filterOwner.trim().toLowerCase();
    return vehiclesLinkedToRegisteredResidents.filter((v) => {
      if (plateQ && !normPlate(v.plateNumber).includes(plateQ)) return false;
      if (!vehicleMatchesTypeFilter(v, filterVehicleType)) return false;
      if (ownerQ && !v.ownerName.toLowerCase().includes(ownerQ)) return false;
      if (!registeredAtMatchesDay(v.registeredAt, filterRegisteredOn)) return false;
      return true;
    });
  }, [
    vehiclesLinkedToRegisteredResidents,
    filterPlate,
    filterVehicleType,
    filterOwner,
    filterRegisteredOn,
  ]);

  const hasActiveRegistryFilters = useMemo(
    () =>
      Boolean(
        filterPlate.trim() ||
          filterVehicleType ||
          filterOwner.trim() ||
          filterRegisteredOn.trim(),
      ),
    [filterPlate, filterVehicleType, filterOwner, filterRegisteredOn],
  );

  const clearRegistryFilters = useCallback(() => {
    setFilterPlate('');
    setFilterVehicleType('');
    setFilterOwner('');
    setFilterRegisteredOn('');
  }, []);

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
    if (!ownerSuggestOpen) return;
    const onDown = (e: MouseEvent) => {
      if (ownerComboRef.current && !ownerComboRef.current.contains(e.target as Node)) {
        setOwnerSuggestOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [ownerSuggestOpen]);

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
      vehicleTypeOther: '',
    });
    setEditingVehicle(null);
    setOwnerSuggestOpen(false);
  };

  const handleOpenDialog = (vehicle?: Vehicle) => {
    if (isBarangayUser) {
      toast({
        title: "Permission Denied",
        description: "Barangay users are not allowed to modify vehicles.",
        variant: "destructive",
      });
      return;
    }

    // Encoders can only add vehicles, not edit
    if (vehicle && isEncoder) {
      toast({
        title: "Permission Denied",
        description: "Encoders can only add new vehicles, not edit existing ones.",
        variant: "destructive",
      });
      return;
    }
    
    if (vehicle) {
      const normalizedVehicleType = (vehicle.vehicleType || '').toLowerCase();
      const hasPresetVehicleType = VEHICLE_TYPE_OPTIONS.some((opt) => opt.value === normalizedVehicleType);
      setEditingVehicle(vehicle);
      setFormData({
        plateNumber: vehicle.plateNumber.toUpperCase(),
        ownerName: vehicle.ownerName,
        residentId: vehicle.residentId || '',
        vehicleType: hasPresetVehicleType ? normalizedVehicleType : VEHICLE_TYPE_OTHER,
        vehicleTypeOther: hasPresetVehicleType ? '' : vehicle.vehicleType || '',
      });
    } else {
      resetForm();
      setOwnerSuggestOpen(false);
    }
  };

  const handleSaveVehicle = async () => {
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
    const customVehicleType = formData.vehicleTypeOther.trim();
    const vehicleTypeValue =
      formData.vehicleType === VEHICLE_TYPE_OTHER ? customVehicleType : formData.vehicleType;
    if (!vehicleTypeValue) {
      toast({
        title: "Validation Error",
        description: "Please enter the vehicle type",
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
      vehicleType: vehicleTypeValue,
    };

    const plateKey = normPlate(plateTrimmed);
    const duplicatePlate = vehicles.find(
      (v) => normPlate(v.plateNumber) === plateKey && v.id !== editingVehicle?.id,
    );
    if (duplicatePlate) {
      toast({
        title: 'Validation Error',
        description: 'This plate number already exists.',
        variant: 'destructive',
      });
      return;
    }

    try {
      if (editingVehicle) {
        await vehiclesAPI.update(editingVehicle.id, {
          ...payloadBase,
        });
        toast({
          title: "Vehicle Updated",
          description: "Vehicle details updated successfully",
        });
      } else {
        const vehicleId = `VEH-${Date.now()}`;
        await vehiclesAPI.create({
          id: vehicleId,
          ...payloadBase,
          purposeOfVisit: null,
          dataSource: 'barangay', // All vehicles are provided by Barangay
        });
        toast({
          title: "Vehicle Registered",
          description: "New vehicle registered successfully",
        });
      }
      resetForm();
      loadVehicles();
      const affectedResidentIds = new Set<string>();
      if (formData.residentId) affectedResidentIds.add(formData.residentId);
      if (editingVehicle?.residentId) affectedResidentIds.add(editingVehicle.residentId);
      affectedResidentIds.forEach((rid) => {
        queryClient.invalidateQueries({ queryKey: ['violations', 'byResident', rid] });
      });
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: vehiclePlateSaveErrorMessage(error, "Failed to save vehicle"),
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
    setOwnerSuggestOpen(false);
  };

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
            This registry lists vehicles linked to a registered resident. Use the form below to register a plate and
            tie it to a resident for SMS and enforcement workflows.
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
          <div className="glass-card rounded-xl p-4 sm:p-6 space-y-4">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-foreground">
                {editingVehicle ? 'Edit Vehicle' : 'Register New Vehicle'}
              </h2>
              <p className="text-sm text-muted-foreground">
                {editingVehicle
                  ? 'Update the vehicle information below.'
                  : 'Enter the vehicle details to register it in the system.'}
              </p>
            </div>
            <div className="space-y-4 max-h-[80vh] overflow-y-auto sm:max-h-none">
              <div className="space-y-2">
                <Label htmlFor="plateNumber">
                  Plate Number <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="plateNumber"
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
                <Label htmlFor="vehicleType">
                  Vehicle Type <span className="text-red-600">*</span>
                </Label>
                <Select
                  value={formData.vehicleType}
                  onValueChange={(v) =>
                    setFormData((prev) => ({
                      ...prev,
                      vehicleType: v,
                      vehicleTypeOther: v === VEHICLE_TYPE_OTHER ? prev.vehicleTypeOther : '',
                    }))
                  }
                >
                  <SelectTrigger id="vehicleType" className="bg-secondary">
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
                {formData.vehicleType === VEHICLE_TYPE_OTHER ? (
                  <Input
                    placeholder="Enter vehicle type"
                    value={formData.vehicleTypeOther}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, vehicleTypeOther: e.target.value }))
                    }
                    className="bg-secondary"
                  />
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ownerName">
                  Owner Name <span className="text-red-600">*</span>
                </Label>
                <div ref={ownerComboRef} className="relative">
                  <div className="relative">
                    <Input
                      id="ownerName"
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
                        setOwnerSuggestOpen(true);
                      }}
                      onFocus={() => setOwnerSuggestOpen(true)}
                      className="bg-secondary pr-9"
                      inputMode="text"
                      autoComplete="off"
                      aria-autocomplete="list"
                      aria-expanded={ownerSuggestOpen}
                      aria-controls="resident-owner-suggestions"
                    />
                    <ChevronDown className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  </div>
                  {ownerSuggestOpen && suggestedResidents.length > 0 ? (
                    <ul
                      id="resident-owner-suggestions"
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
              <div className="pt-2">
                <Button
                  type="button"
                  className="w-full bg-green-600 text-white hover:bg-green-700 sm:w-auto sm:min-w-[12rem]"
                  onClick={() => void handleSaveVehicle()}
                >
                  {editingVehicle ? 'Save Changes' : 'Register Vehicle'}
                </Button>
              </div>
            </div>
          </div>
        )}
        {/* Filters */}
        <div className="flex flex-col gap-3 sm:gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="filter-plate" className="text-xs text-muted-foreground">
                Plate number
              </Label>
              <Input
                id="filter-plate"
                placeholder="Any plate…"
                value={filterPlate}
                onChange={(e) => setFilterPlate(e.target.value.toUpperCase())}
                className="bg-secondary uppercase font-mono"
                spellCheck={false}
                autoCapitalize="characters"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-vehicle-type" className="text-xs text-muted-foreground">
                Vehicle type
              </Label>
              <Select value={filterVehicleType || '__all__'} onValueChange={(v) => setFilterVehicleType(v === '__all__' ? '' : v)}>
                <SelectTrigger id="filter-vehicle-type" className="bg-secondary">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All types</SelectItem>
                  {VEHICLE_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-owner" className="text-xs text-muted-foreground">
                Owner
              </Label>
              <Input
                id="filter-owner"
                placeholder="Owner name…"
                value={filterOwner}
                onChange={(e) => setFilterOwner(e.target.value)}
                className="bg-secondary"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-registered" className="text-xs text-muted-foreground">
                Date registered
              </Label>
              <Input
                id="filter-registered"
                type="date"
                value={filterRegisteredOn}
                onChange={(e) => setFilterRegisteredOn(e.target.value)}
                className="bg-secondary"
              />
            </div>
          </div>
          {hasActiveRegistryFilters ? (
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={clearRegistryFilters}>
                Clear filters
              </Button>
            </div>
          ) : null}
        </div>

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
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(vehicle)}>
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
                                <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(vehicle)}>
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
                ? `No resident-linked vehicles match for ${residentFilterLabel} with the current filters.`
                : 'No vehicles match this resident filter.'}
            </p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <Button type="button" variant="secondary" onClick={clearResidentFilter}>
                Show all vehicles
              </Button>
              {hasActiveRegistryFilters ? (
                <Button type="button" variant="outline" onClick={clearRegistryFilters}>
                  Clear filters
                </Button>
              ) : null}
            </div>
          </div>
        ) : vehiclesLinkedToRegisteredResidents.length > 0 &&
          hasActiveRegistryFilters &&
          displayedLinkedVehicles.length === 0 ? (
          <div className="glass-card rounded-xl p-8 sm:p-12 text-center">
            <Car className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No matching vehicles</h3>
            <p className="text-muted-foreground mb-6 text-sm max-w-md mx-auto">
              Nothing in the registry matches the plate, type, owner, or registration date you selected. Try loosening or
              clearing filters.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <Button type="button" variant="default" onClick={clearRegistryFilters}>
                Clear filters
              </Button>
              {residentFilterId ? (
                <Button type="button" variant="outline" onClick={clearResidentFilter}>
                  Show all vehicles
                </Button>
              ) : null}
            </div>
          </div>
        ) : vehicles.length > 0 && vehiclesLinkedToRegisteredResidents.length === 0 ? (
          <div className="glass-card rounded-xl p-8 sm:p-12 text-center">
            <Car className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No resident-linked vehicles</h3>
            <p className="text-muted-foreground mb-6 text-sm max-w-md mx-auto">
              This list only shows vehicles tied to a registered resident. Add or edit a vehicle and choose a resident
              under Owner Name to link it.
            </p>
            {!isBarangayUser && (
              <Button onClick={() => handleOpenDialog()}>
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
              <Button onClick={() => handleOpenDialog()}>
                <Plus className="h-4 w-4 mr-2" />
                Add Your First Vehicle
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
