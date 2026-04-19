import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { Plus, Edit, Trash2, Phone, Info, UserPlus, ChevronsUpDown, MapPin } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { usePageTracking } from '@/hooks/usePageTracking';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Vehicle, Resident } from '@/types/parking';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/hooks/use-toast';
import { vehiclesAPI, residentsAPI } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { formatResidentAddressLine } from '@/lib/residentStreets';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
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
const PURPOSE_OTHER = 'Other';

const RENTED_OPTIONS = ['Court', 'Community Center', 'Barangay Hall'] as const;

/** Tabs and Purpose of visit dropdown — single source (includes Other). */
const VISITOR_PURPOSE_TABS = [
  'Visit resident',
  'Barangay hall',
  'Reservation',
  'Drop-off',
  'Delivery',
  PURPOSE_OTHER,
] as const;
type VisitorPurposeTab = (typeof VISITOR_PURPOSE_TABS)[number];

/** First tab only: all non-resident vehicles (not a purpose value). */
const VISITOR_LIST_TAB_ALL = 'All' as const;
type VisitorListTab = typeof VISITOR_LIST_TAB_ALL | VisitorPurposeTab;

const PRESET_PURPOSE_TABS = VISITOR_PURPOSE_TABS.filter((t) => t !== PURPOSE_OTHER);

/** Legacy purposes still routed to Delivery / Reservation tabs and API categories. */
const PURPOSE_DELIVERY_LEGACY = ['Pickup', 'Package delivery'] as const;
const PURPOSE_RENTAL_LEGACY = ['Short-term rental', 'Event parking', 'Overnight stay'] as const;

function errMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

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

function deriveVisitorPurposeTab(v: Vehicle): VisitorPurposeTab {
  const raw = (v.purposeOfVisit || '').trim();
  const lower = raw.toLowerCase();

  for (const label of PRESET_PURPOSE_TABS) {
    if (lower === label.toLowerCase()) return label;
  }
  if (PURPOSE_DELIVERY_LEGACY.some((p) => p.toLowerCase() === lower)) return 'Delivery';
  if (PURPOSE_RENTAL_LEGACY.some((p) => p.toLowerCase() === lower)) return 'Reservation';

  if (v.visitorCategory?.toLowerCase() === 'rental' || (v.rented && String(v.rented).trim())) {
    return 'Reservation';
  }
  if (v.visitorCategory?.toLowerCase() === 'delivery') return 'Delivery';
  if (lower.includes('deliver')) return 'Delivery';

  if (raw) return PURPOSE_OTHER;
  return 'Visit resident';
}

function normalizePurposeForForm(raw: string): { purposeOfVisit: string; purposeOfVisitOther: string } {
  const t = raw.trim();
  if (!t) return { purposeOfVisit: PRESET_PURPOSE_TABS[0] ?? 'Visit resident', purposeOfVisitOther: '' };
  const hit = PRESET_PURPOSE_TABS.find((x) => x.toLowerCase() === t.toLowerCase());
  if (hit) return { purposeOfVisit: hit, purposeOfVisitOther: '' };
  return { purposeOfVisit: PURPOSE_OTHER, purposeOfVisitOther: t };
}

function apiVisitorCategory(purposeValue: string, rented: string): 'guest' | 'delivery' | 'rental' {
  const r = rented.trim();
  const p = purposeValue.trim();
  const pl = p.toLowerCase();

  if (p === 'Visit resident') return 'guest';

  if (p === 'Delivery' || p === 'Drop-off') return 'delivery';
  if (PURPOSE_DELIVERY_LEGACY.some((x) => x.toLowerCase() === pl)) return 'delivery';
  if (pl.includes('deliver')) return 'delivery';

  if (p === 'Reservation' || PURPOSE_RENTAL_LEGACY.some((x) => x.toLowerCase() === pl)) return 'rental';
  if (r) return 'rental';

  return 'guest';
}

/** Stored on `rented` for Visit resident; disambiguates duplicate names like the Residents registry. */
function residentVisitedStorageValue(r: Resident, allResidents: Resident[]): string {
  const name = r.name.trim();
  const sameName = allResidents.filter((x) => x.name.trim().toLowerCase() === name.toLowerCase());
  if (sameName.length <= 1) return name;
  const addr = formatResidentAddressLine(r);
  return addr ? `${name} · ${addr}` : `${name} · ${digitsOnly(r.contactNumber)}`;
}

/** For Visit resident, show the resident name only (storage may append ` · ` disambiguation). Otherwise return `rented` as stored (e.g. facility). */
function locationOrVisitedResidentLabel(vehicle: Vehicle, allResidents: Resident[]): string {
  const rented = (vehicle.rented || '').trim();
  if (!rented) return '';
  if ((vehicle.purposeOfVisit || '').trim() !== 'Visit resident') return rented;
  for (const r of allResidents) {
    if (residentVisitedStorageValue(r, allResidents) === rented) return r.name.trim();
  }
  const sep = ' · ';
  const i = rented.indexOf(sep);
  if (i !== -1) return rented.slice(0, i).trim();
  return rented;
}

function SearchableResidentSelect({
  id,
  label,
  value,
  onChange,
  residents,
  placeholder,
  requiredMark,
}: {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  residents: Resident[];
  placeholder?: string;
  requiredMark?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const sorted = useMemo(
    () => [...residents].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [residents],
  );
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label}
        {requiredMark ? <span className="text-red-600">*</span> : null}
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              'h-10 w-full justify-between font-normal bg-secondary px-3 shadow-sm',
              !value && 'text-muted-foreground',
            )}
          >
            <span className="truncate text-left">{value || placeholder || 'Select…'}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="p-0 w-[min(100vw-2rem,var(--radix-popover-trigger-width))] sm:w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)]"
          align="start"
        >
          <Command>
            <CommandInput placeholder="Search name, address, or phone…" className="h-9" />
            <CommandList>
              <CommandEmpty>{sorted.length === 0 ? 'No residents loaded.' : 'No match.'}</CommandEmpty>
              <CommandGroup>
                {sorted.map((r) => {
                  const line = formatResidentAddressLine(r);
                  const searchBlob = `${r.name} ${line} ${r.contactNumber}`.trim();
                  return (
                    <CommandItem
                      key={r.id}
                      value={searchBlob}
                      onSelect={() => {
                        onChange(residentVisitedStorageValue(r, residents));
                        setOpen(false);
                      }}
                    >
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="font-medium truncate">{r.name}</span>
                        <span className="text-xs text-muted-foreground truncate">
                          {line || r.contactNumber}
                        </span>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function SearchableLocationSelect({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  requiredMark,
}: {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  placeholder?: string;
  requiredMark?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label}
        {requiredMark ? <span className="text-red-600">*</span> : null}
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              'h-10 w-full justify-between font-normal bg-secondary px-3 shadow-sm',
              !value && 'text-muted-foreground',
            )}
          >
            <span className="truncate text-left">{value || placeholder || 'Select…'}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="p-0 w-[min(100vw-2rem,var(--radix-popover-trigger-width))] sm:w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)]"
          align="start"
        >
          <Command>
            <CommandInput placeholder="Search…" className="h-9" />
            <CommandList>
              <CommandEmpty>No match.</CommandEmpty>
              <CommandGroup>
                {options.map((opt) => (
                  <CommandItem
                    key={opt}
                    value={opt}
                    onSelect={() => {
                      onChange(opt);
                      setOpen(false);
                    }}
                  >
                    {opt}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default function Visitors() {
  usePageTracking();
  const { user } = useAuth();
  const isEncoder = user?.role === 'encoder';
  const isBarangayUser = user?.role === 'barangay_user';
  const isAdmin = user?.role === 'admin';

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filterPlate, setFilterPlate] = useState('');
  const [filterVehicleType, setFilterVehicleType] = useState('');
  const [filterOwner, setFilterOwner] = useState('');
  const [filterRegisteredOn, setFilterRegisteredOn] = useState('');
  const [activeTab, setActiveTab] = useState<VisitorListTab>(VISITOR_LIST_TAB_ALL);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [vehicleToDelete, setVehicleToDelete] = useState<Vehicle | null>(null);
  const [isDeletingVehicle, setIsDeletingVehicle] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [viewingVehicle, setViewingVehicle] = useState<Vehicle | null>(null);
  const [formData, setFormData] = useState({
    plateNumber: '',
    ownerName: '',
    contactNumber: '',
    vehicleType: 'car' as string,
    vehicleTypeOther: '',
    purposeOfVisit: 'Visit resident',
    purposeOfVisitOther: '',
    rented: '',
  });

  const loadVehicles = useCallback(async (initial = false) => {
    try {
      if (initial) setIsInitialLoading(true);
      else setIsRefreshing(true);
      const data = await vehiclesAPI.getAll();
      setVehicles(data);
    } catch (error) {
      console.error('Error loading vehicles:', error);
      toast({
        title: 'Error',
        description: 'Failed to load visitor vehicles. Make sure the backend server is running.',
        variant: 'destructive',
      });
    } finally {
      if (initial) setIsInitialLoading(false);
      else setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadVehicles(true);
  }, [loadVehicles]);

  const loadResidents = useCallback(async () => {
    try {
      const data = await residentsAPI.getAll();
      setResidents(data);
    } catch {
      setResidents([]);
    }
  }, []);

  useEffect(() => {
    void loadResidents();
  }, [loadResidents]);

  const nonResidentVehicles = useMemo(
    () => vehicles.filter((v) => !v.residentId || String(v.residentId).trim() === ''),
    [vehicles],
  );

  const tabFiltered = useMemo(() => {
    if (activeTab === VISITOR_LIST_TAB_ALL) return nonResidentVehicles;
    return nonResidentVehicles.filter((v) => deriveVisitorPurposeTab(v) === activeTab);
  }, [nonResidentVehicles, activeTab]);
  const categoryCounts = useMemo(() => {
    const counts = Object.fromEntries(VISITOR_PURPOSE_TABS.map((t) => [t, 0])) as Record<
      VisitorPurposeTab,
      number
    >;
    for (const v of nonResidentVehicles) {
      counts[deriveVisitorPurposeTab(v)] += 1;
    }
    return counts;
  }, [nonResidentVehicles]);

  const displayedRows = useMemo(() => {
    const plateQ = normPlate(filterPlate);
    const ownerQ = filterOwner.trim().toLowerCase();
    return tabFiltered.filter((v) => {
      if (plateQ && !normPlate(v.plateNumber).includes(plateQ)) return false;
      if (!vehicleMatchesTypeFilter(v, filterVehicleType)) return false;
      if (ownerQ && !v.ownerName.toLowerCase().includes(ownerQ)) return false;
      if (!registeredAtMatchesDay(v.registeredAt, filterRegisteredOn)) return false;
      return true;
    });
  }, [tabFiltered, filterPlate, filterVehicleType, filterOwner, filterRegisteredOn]);

  const hasActiveVisitorFilters = useMemo(
    () =>
      Boolean(
        filterPlate.trim() ||
          filterVehicleType ||
          filterOwner.trim() ||
          filterRegisteredOn.trim(),
      ),
    [filterPlate, filterVehicleType, filterOwner, filterRegisteredOn],
  );

  const clearVisitorFilters = useCallback(() => {
    setFilterPlate('');
    setFilterVehicleType('');
    setFilterOwner('');
    setFilterRegisteredOn('');
  }, []);

  const registryHasRows = nonResidentVehicles.length > 0;
  const activeCategoryLabel = activeTab === VISITOR_LIST_TAB_ALL ? VISITOR_LIST_TAB_ALL : activeTab;

  const resetForm = (listTab: VisitorListTab) => {
    const purposeSeed: VisitorPurposeTab =
      listTab === VISITOR_LIST_TAB_ALL ? (PRESET_PURPOSE_TABS[0] ?? 'Visit resident') : listTab;
    setFormData({
      plateNumber: '',
      ownerName: '',
      contactNumber: '',
      vehicleType: 'car',
      vehicleTypeOther: '',
      purposeOfVisit: purposeSeed === PURPOSE_OTHER ? PURPOSE_OTHER : purposeSeed,
      purposeOfVisitOther: '',
      rented: '',
    });
    setEditingVehicle(null);
  };

  const handleOpenDialog = (vehicle?: Vehicle) => {
    if (isBarangayUser) {
      toast({
        title: 'Permission Denied',
        description: 'Barangay users are not allowed to modify visitor vehicles.',
        variant: 'destructive',
      });
      return;
    }
    if (vehicle && isEncoder) {
      toast({
        title: 'Permission Denied',
        description: 'Encoders can only add new visitor vehicles, not edit existing ones.',
        variant: 'destructive',
      });
      return;
    }

    if (vehicle) {
      const normalizedVehicleType = (vehicle.vehicleType || '').toLowerCase();
      const hasPresetVehicleType = VEHICLE_TYPE_OPTIONS.some((opt) => opt.value === normalizedVehicleType);
      const { purposeOfVisit, purposeOfVisitOther } = normalizePurposeForForm(vehicle.purposeOfVisit || '');
      setEditingVehicle(vehicle);
      setFormData({
        plateNumber: vehicle.plateNumber.toUpperCase(),
        ownerName: vehicle.ownerName,
        contactNumber: digitsOnly(vehicle.contactNumber),
        vehicleType: hasPresetVehicleType ? normalizedVehicleType : VEHICLE_TYPE_OTHER,
        vehicleTypeOther: hasPresetVehicleType ? '' : vehicle.vehicleType || '',
        purposeOfVisit,
        purposeOfVisitOther,
        rented: vehicle.rented || '',
      });
    } else {
      resetForm(activeTab);
    }
  };

  const handleSaveVehicle = async () => {
    if (isBarangayUser) {
      toast({
        title: 'Permission Denied',
        description: 'Barangay users are not allowed to modify visitor vehicles.',
        variant: 'destructive',
      });
      return;
    }
    const plateTrimmed = formData.plateNumber.trim();
    const ownerTrimmed = formData.ownerName.trim();
    const contactClean = digitsOnly(formData.contactNumber);
    const customVehicleType = formData.vehicleTypeOther.trim();
    const vehicleTypeValue =
      formData.vehicleType === VEHICLE_TYPE_OTHER ? customVehicleType : formData.vehicleType;
    const customPurpose = formData.purposeOfVisitOther.trim();
    const purposeValue = formData.purposeOfVisit === PURPOSE_OTHER ? customPurpose : formData.purposeOfVisit;
    const apiCat = apiVisitorCategory(purposeValue, formData.rented);

    if (!plateTrimmed || !ownerTrimmed || !purposeValue) {
      toast({
        title: 'Validation Error',
        description: 'Please fill in plate number, owner name, purpose of visit, and contact number',
        variant: 'destructive',
      });
      return;
    }
    if (!vehicleTypeValue) {
      toast({
        title: 'Validation Error',
        description: 'Please enter the vehicle type',
        variant: 'destructive',
      });
      return;
    }
    if (!ownerNameValid(formData.ownerName)) {
      toast({
        title: 'Validation Error',
        description: 'Owner name may only contain letters and spaces',
        variant: 'destructive',
      });
      return;
    }
    if (!contactClean) {
      toast({
        title: 'Validation Error',
        description: 'Contact number is required',
        variant: 'destructive',
      });
      return;
    }
    if (formData.purposeOfVisit === 'Visit resident' && !formData.rented?.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Select the resident being visited',
        variant: 'destructive',
      });
      return;
    }
    if (apiCat === 'rental' && !formData.rented?.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Select a rental location for reservations and rental visits',
        variant: 'destructive',
      });
      return;
    }
    const rentedTrim = formData.rented.trim();
    const persistRented =
      (apiCat === 'rental' && rentedTrim) ||
      (formData.purposeOfVisit === 'Visit resident' && rentedTrim);
    const payload = {
      plateNumber: plateTrimmed.toUpperCase(),
      ownerName: ownerTrimmed,
      contactNumber: contactClean,
      residentId: null as string | null,
      rented: persistRented ? formData.rented : null,
      purposeOfVisit: purposeValue,
      vehicleType: vehicleTypeValue,
      visitorCategory: apiCat,
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

    const visitorVehicles = vehicles.filter(
      (v) => !v.residentId || String(v.residentId).trim() === '',
    );
    const duplicateVisitorOwner = visitorVehicles.find(
      (v) => digitsOnly(v.contactNumber) === contactClean && v.id !== editingVehicle?.id,
    );
    if (duplicateVisitorOwner) {
      toast({
        title: 'Validation Error',
        description: 'A visitor with this contact number is already registered.',
        variant: 'destructive',
      });
      return;
    }

    try {
      if (editingVehicle) {
        await vehiclesAPI.update(editingVehicle.id, payload);
        toast({ title: 'Visitor Updated', description: 'Vehicle details updated successfully' });
      } else {
        const vehicleId = `VEH-${Date.now()}`;
        await vehiclesAPI.create({
          id: vehicleId,
          ...payload,
          dataSource: 'barangay',
        });
        toast({ title: 'Visitor Registered', description: 'Visitor vehicle registered successfully' });
      }
      resetForm(activeTab);
      loadVehicles();
      void loadResidents();
    } catch (error: unknown) {
      toast({
        title: 'Error',
        description: vehiclePlateSaveErrorMessage(error, 'Failed to save vehicle'),
        variant: 'destructive',
      });
    }
  };

  const requestDeleteVehicle = (vehicle: Vehicle) => {
    if (isEncoder || isBarangayUser) {
      toast({
        title: 'Permission Denied',
        description: 'You do not have permission to delete visitor vehicles.',
        variant: 'destructive',
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
    setIsDeletingVehicle(true);
    try {
      await vehiclesAPI.delete(vehicleToDelete.id);
      toast({ title: 'Vehicle Removed', description: 'Visitor vehicle removed from registry' });
      setVehicleToDelete(null);
      loadVehicles();
    } catch (error: unknown) {
      toast({
        title: 'Error',
        description: errMessage(error, 'Failed to delete vehicle'),
        variant: 'destructive',
      });
    } finally {
      setIsDeletingVehicle(false);
    }
  };

  const deleteButtonClassName =
    'h-8 w-8 border-red-600 text-red-600 hover:bg-red-600/15 hover:text-red-700 dark:hover:bg-red-600/20';

  const handleViewVisitorVehicle = (vehicle: Vehicle) => {
    setViewingVehicle(vehicle);
    setIsViewDialogOpen(true);
  };

  const purposeSelectValue = useMemo(() => {
    if (formData.purposeOfVisit === PURPOSE_OTHER) return PURPOSE_OTHER;
    if (PRESET_PURPOSE_TABS.some((x) => x === formData.purposeOfVisit)) return formData.purposeOfVisit;
    return PURPOSE_OTHER;
  }, [formData.purposeOfVisit]);

  const showRentedField = useMemo(() => {
    if (formData.purposeOfVisit === 'Visit resident') return true;
    if (formData.purposeOfVisit === 'Reservation') return true;
    if (PURPOSE_RENTAL_LEGACY.some((x) => x === formData.purposeOfVisit)) return true;
    if (
      formData.purposeOfVisit === PURPOSE_OTHER &&
      PURPOSE_RENTAL_LEGACY.some((x) => x === formData.purposeOfVisitOther.trim())
    ) {
      return true;
    }
    return Boolean(editingVehicle?.rented?.trim());
  }, [formData.purposeOfVisit, formData.purposeOfVisitOther, editingVehicle?.rented]);

  if (isInitialLoading) {
    return (
      <div className="min-h-screen">
        <Header
          title="Visitors"
          subtitle="Non-resident vehicles"
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
        title="Visitors"
        subtitle="Non-resident vehicles"
      />

      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {!isBarangayUser && (
          <div className="glass-card rounded-xl p-4 sm:p-6 space-y-4">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-foreground">
                {editingVehicle ? 'Edit Visitor Vehicle' : 'Register Visitor'}
              </h2>
              <p className="text-sm text-muted-foreground">
                {editingVehicle
                  ? 'Update visitor vehicle details.'
                  : activeTab === VISITOR_LIST_TAB_ALL
                    ? 'Register a visitor vehicle. Choose purpose in the form.'
                    : `Register a vehicle for the same purpose as this tab (${activeTab}). You can change purpose in the form if needed.`}
              </p>
            </div>
            <div className="space-y-4 max-h-[78vh] overflow-y-auto sm:max-h-none">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="v-plate">
                    Plate Number <span className="text-red-600">*</span>
                  </Label>
                  <Input
                    id="v-plate"
                    placeholder="ABC123"
                    value={formData.plateNumber}
                    onChange={(e) =>
                      setFormData({ ...formData, plateNumber: e.target.value.toUpperCase() })
                    }
                    className="bg-secondary uppercase"
                    spellCheck={false}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="v-type">
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
                    <SelectTrigger id="v-type" className="bg-secondary">
                      <SelectValue />
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
                  <Label htmlFor="v-owner">
                    Owner <span className="text-red-600">*</span>
                  </Label>
                  <Input
                    id="v-owner"
                    placeholder="Juan dela Cruz"
                    value={formData.ownerName}
                    onChange={(e) =>
                      setFormData({ ...formData, ownerName: lettersAndSpacesOnly(e.target.value) })
                    }
                    className="bg-secondary"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="v-contact">
                    Contact Number <span className="text-red-600">*</span>
                  </Label>
                  <Input
                    id="v-contact"
                    placeholder="09171234567"
                    maxLength={11}
                    value={formData.contactNumber}
                    onChange={(e) =>
                      setFormData({ ...formData, contactNumber: digitsOnly(e.target.value).slice(0, 11) })
                    }
                    className="bg-secondary"
                    inputMode="numeric"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="v-purpose">
                    Purpose of Visit <span className="text-red-600">(Required)</span>
                  </Label>
                  <Select
                    value={purposeSelectValue}
                    onValueChange={(v) =>
                      setFormData((prev) => ({
                        ...prev,
                        purposeOfVisit: v,
                        purposeOfVisitOther: v === PURPOSE_OTHER ? prev.purposeOfVisitOther : '',
                        rented: '',
                      }))
                    }
                  >
                    <SelectTrigger id="v-purpose" className="bg-secondary">
                      <SelectValue placeholder="Select purpose" />
                    </SelectTrigger>
                    <SelectContent>
                      {VISITOR_PURPOSE_TABS.map((opt) => (
                        <SelectItem key={opt} value={opt}>
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {formData.purposeOfVisit === PURPOSE_OTHER ? (
                    <Input
                      placeholder="Enter purpose of visit"
                      value={formData.purposeOfVisitOther}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, purposeOfVisitOther: e.target.value }))
                      }
                      className="bg-secondary"
                    />
                  ) : null}
                </div>
                {formData.purposeOfVisit === 'Visit resident' ? (
                  <SearchableResidentSelect
                    id="v-visit-resident"
                    label="Resident being visited"
                    requiredMark
                    placeholder="Search residents from registry…"
                    residents={residents}
                    value={formData.rented}
                    onChange={(v) => setFormData((prev) => ({ ...prev, rented: v }))}
                  />
                ) : showRentedField ? (
                  <SearchableLocationSelect
                    id="v-rented"
                    label="Rented / Location"
                    requiredMark
                    placeholder="Search facility…"
                    options={RENTED_OPTIONS}
                    value={formData.rented}
                    onChange={(v) => setFormData((prev) => ({ ...prev, rented: v }))}
                  />
                ) : null}
              </div>

              <div className="pt-2">
                <Button
                  type="button"
                  className="w-full bg-green-600 text-white hover:bg-green-700 sm:w-auto sm:min-w-[12rem]"
                  onClick={() => void handleSaveVehicle()}
                >
                  {editingVehicle ? 'Save Changes' : 'Register Visitor'}
                </Button>
              </div>
            </div>
          </div>
        )}

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as VisitorListTab)}
          className="w-full"
        >
          <TabsList className="flex w-full flex-wrap h-auto gap-1 p-1 justify-start">
            <TabsTrigger
              value={VISITOR_LIST_TAB_ALL}
              className="flex-1 min-w-[7.5rem] sm:flex-initial sm:min-w-0 text-xs sm:text-sm px-2 sm:px-3"
            >
              {VISITOR_LIST_TAB_ALL} ({nonResidentVehicles.length})
            </TabsTrigger>
            {VISITOR_PURPOSE_TABS.map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="flex-1 min-w-[7.5rem] sm:flex-initial sm:min-w-0 text-xs sm:text-sm px-2 sm:px-3"
              >
                {tab} ({categoryCounts[tab]})
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="glass-card rounded-xl p-4 space-y-1.5">
          <p className="text-sm text-foreground">
            <span className="font-semibold">{activeCategoryLabel}</span>
            <span className="text-muted-foreground">
              {' '}
              · {tabFiltered.length} vehicle{tabFiltered.length === 1 ? '' : 's'}{' '}
              {activeTab === VISITOR_LIST_TAB_ALL ? 'total' : 'in this tab'}
            </span>
          </p>
          {hasActiveVisitorFilters && displayedRows.length !== tabFiltered.length ? (
            <p className="text-xs text-muted-foreground">
              {displayedRows.length} match your filters
              {tabFiltered.length > 0 && displayedRows.length === 0
                ? ' — try clearing a filter or picking another tab.'
                : ''}
            </p>
          ) : hasActiveVisitorFilters ? (
            <p className="text-xs text-muted-foreground">Filters applied to this tab.</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Add filters below to narrow the list, or use the registration form at the top of the page.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3 sm:gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="visitor-filter-plate" className="text-xs text-muted-foreground">
                Plate number
              </Label>
              <Input
                id="visitor-filter-plate"
                placeholder="Any plate…"
                value={filterPlate}
                onChange={(e) => setFilterPlate(e.target.value.toUpperCase())}
                className="bg-secondary uppercase font-mono"
                spellCheck={false}
                autoCapitalize="characters"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="visitor-filter-vehicle-type" className="text-xs text-muted-foreground">
                Vehicle type
              </Label>
              <Select
                value={filterVehicleType || '__all__'}
                onValueChange={(v) => setFilterVehicleType(v === '__all__' ? '' : v)}
              >
                <SelectTrigger id="visitor-filter-vehicle-type" className="bg-secondary">
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
              <Label htmlFor="visitor-filter-owner" className="text-xs text-muted-foreground">
                Owner
              </Label>
              <Input
                id="visitor-filter-owner"
                placeholder="Owner name…"
                value={filterOwner}
                onChange={(e) => setFilterOwner(e.target.value)}
                className="bg-secondary"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="visitor-filter-registered" className="text-xs text-muted-foreground">
                Date registered
              </Label>
              <Input
                id="visitor-filter-registered"
                type="date"
                value={filterRegisteredOn}
                onChange={(e) => setFilterRegisteredOn(e.target.value)}
                className="bg-secondary"
              />
            </div>
          </div>
          {hasActiveVisitorFilters ? (
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={clearVisitorFilters}>
                Clear filters
              </Button>
            </div>
          ) : null}
        </div>

        {isRefreshing && <p className="text-xs text-muted-foreground">Refreshing results...</p>}

        {displayedRows.length > 0 ? (
          <>
            <div className="block sm:hidden space-y-3">
              {displayedRows.map((vehicle) => (
                <div key={vehicle.id} className="glass-card rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-mono font-medium text-lg">{vehicle.plateNumber}</div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => handleViewVisitorVehicle(vehicle)}
                      aria-label="View visitor summary"
                    >
                      <Info className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="text-sm text-muted-foreground">{formatVehicleTypeLabel(vehicle.vehicleType)}</div>
                  <div className="text-sm font-medium">{vehicle.ownerName}</div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="h-4 w-4 shrink-0" />
                    {vehicle.contactNumber}
                  </div>
                  {vehicle.rented ? (
                    <div className="text-xs text-muted-foreground">
                      {(vehicle.purposeOfVisit || '').trim() === 'Visit resident'
                        ? 'Resident visited'
                        : 'Location'}
                      : {locationOrVisitedResidentLabel(vehicle, residents)}
                    </div>
                  ) : null}
                  <div className="text-xs text-muted-foreground">
                    Registered {new Date(vehicle.registeredAt).toLocaleDateString()}
                  </div>
                  {!isEncoder && isAdmin && (
                    <div className="flex gap-1 pt-2">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(vehicle)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => requestDeleteVehicle(vehicle)}
                        className={deleteButtonClassName}
                        aria-label="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="glass-card rounded-xl overflow-hidden hidden sm:block">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead className="text-muted-foreground">Plate</TableHead>
                      <TableHead className="text-muted-foreground">Vehicle Type</TableHead>
                      <TableHead className="text-muted-foreground">Owner</TableHead>
                      <TableHead className="text-muted-foreground">Contact</TableHead>
                      <TableHead className="text-muted-foreground">Registered</TableHead>
                      <TableHead className="text-muted-foreground text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedRows.map((vehicle) => (
                      <TableRow key={vehicle.id} className="border-border">
                        <TableCell className="font-mono font-medium">{vehicle.plateNumber}</TableCell>
                        <TableCell>{formatVehicleTypeLabel(vehicle.vehicleType)}</TableCell>
                        <TableCell>{vehicle.ownerName}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-muted-foreground text-sm">
                            <Phone className="h-4 w-4 shrink-0" />
                            {vehicle.contactNumber}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {new Date(vehicle.registeredAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleViewVisitorVehicle(vehicle)}
                              aria-label="View visitor summary"
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
                                  aria-label="Delete visitor vehicle"
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
                  setViewingVehicle(null);
                }
              }}
            >
              <DialogContent className="bg-card border-border mx-4 sm:mx-auto max-w-[calc(100vw-2rem)] sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{viewingVehicle?.ownerName ?? 'Visitor summary'}</DialogTitle>
                  <DialogDescription>
                    {viewingVehicle ? (
                      <>
                        Visitor record for{' '}
                        <span className="font-mono font-medium text-foreground">{viewingVehicle.plateNumber}</span>
                      </>
                    ) : (
                      'Visitor details'
                    )}
                  </DialogDescription>
                </DialogHeader>
                {viewingVehicle ? (
                  <div className="space-y-4 py-2 text-sm">
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Vehicle type</p>
                      <p className="font-medium text-foreground">
                        {formatVehicleTypeLabel(viewingVehicle.vehicleType)}
                      </p>
                    </div>
                    <div className="flex items-start gap-2">
                      <Phone className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">Contact</p>
                        <p className="font-medium text-foreground">{viewingVehicle.contactNumber}</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Purpose of visit</p>
                      <p className="font-medium text-foreground">
                        {(viewingVehicle.purposeOfVisit || '').trim() || '—'}
                      </p>
                    </div>
                    {viewingVehicle.rented?.trim() ? (
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">
                          {(viewingVehicle.purposeOfVisit || '').trim() === 'Visit resident'
                            ? 'Resident visited'
                            : 'Location / facility'}
                        </p>
                        <p className="font-medium text-foreground">
                          {locationOrVisitedResidentLabel(viewingVehicle, residents)}
                        </p>
                      </div>
                    ) : null}
                    {formatResidentAddressLine(viewingVehicle) ? (
                      <div className="flex items-start gap-2">
                        <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs uppercase text-muted-foreground">Address</p>
                          <p className="font-medium text-foreground leading-snug">
                            {formatResidentAddressLine(viewingVehicle)}
                          </p>
                        </div>
                      </div>
                    ) : null}
                    {viewingVehicle.visitorCategory ? (
                      <p className="text-xs text-muted-foreground capitalize">
                        Category: {viewingVehicle.visitorCategory}
                      </p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      Registered {new Date(viewingVehicle.registeredAt).toLocaleDateString()}
                    </p>
                  </div>
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
                  <AlertDialogTitle>Remove visitor vehicle</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete this record?
                    {vehicleToDelete && (
                      <>
                        {' '}
                        This will permanently remove{' '}
                        <span className="font-mono font-medium text-foreground">
                          {vehicleToDelete.plateNumber}
                        </span>{' '}
                        from the visitor registry.
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
        ) : hasActiveVisitorFilters && tabFiltered.length > 0 && displayedRows.length === 0 ? (
          <div className="glass-card rounded-xl p-8 sm:p-12 text-center">
            <Info className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No matching visitor vehicles</h3>
            <p className="text-muted-foreground mb-6 text-sm max-w-md mx-auto">
              Nothing in this tab matches the plate, type, owner, or registration date you selected. Try clearing filters
              or switching tabs.
            </p>
            <Button type="button" variant="default" onClick={clearVisitorFilters}>
              Clear filters
            </Button>
          </div>
        ) : !registryHasRows ? (
          <div className="glass-card rounded-xl p-8 sm:p-12 text-center">
            <UserPlus className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No visitor vehicles yet</h3>
            <p className="text-muted-foreground mb-6 text-sm max-w-md mx-auto">
              Use the tabs to register by purpose: {VISITOR_PURPOSE_TABS.join(', ')}. Resident-linked vehicles stay on the
              Vehicles page.
            </p>
            {!isBarangayUser && (
              <Button className="bg-green-600 text-white hover:bg-green-700" onClick={() => handleOpenDialog()}>
                <Plus className="h-4 w-4 mr-2" />
                Register Visitor
              </Button>
            )}
          </div>
        ) : (
          <div className="glass-card rounded-xl p-8 sm:p-12 text-center">
            <Info className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No records in this tab</h3>
            <p className="text-muted-foreground mb-6 text-sm max-w-md mx-auto">
              Switch tabs or register a visitor for this category.
            </p>
            {!isBarangayUser && (
              <Button className="bg-green-600 text-white hover:bg-green-700" onClick={() => handleOpenDialog()}>
                <Plus className="h-4 w-4 mr-2" />
                Register Visitor
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
