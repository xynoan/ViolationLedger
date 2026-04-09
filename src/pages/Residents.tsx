import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Phone,
  Home,
  MapPin,
  Info,
  MessageSquare,
  Car,
  ShieldCheck,
  UserCircle,
  ScrollText,
  SlidersHorizontal,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { usePageTracking } from '@/hooks/usePageTracking';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Resident, ResidentStatus, Vehicle, Violation } from '@/types/parking';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { toast } from '@/hooks/use-toast';
import { residentsAPI, vehiclesAPI, violationsAPI } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { SearchNoMatchesEmpty } from '@/components/search/SearchNoMatchesEmpty';
import {
  formatResidentAddressLine,
  RESIDENT_STREET_OPTIONS,
  RESIDENT_STREET_SET,
} from '@/lib/residentStreets';

type StandingFilter = 'all' | 'active_violations' | 'clean';
type ResidentSort = 'name_asc' | 'most_vehicles' | 'recent_violation';

const normPlate = (p: string) => String(p || '').replace(/\s+/g, '').toUpperCase();

/** Parse address text into unique location keys: Barangay numbers + comma-separated street/area segments (excludes leading Lot lines). */
function extractLocationKeysFromAddress(address: string | undefined): string[] {
  const raw = (address || '').trim();
  if (!raw) return [];
  const keys = new Set<string>();

  const brgyGlobal = /\b(?:Barangay|BRGY|Brgy\.?)\s*(\d+)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = brgyGlobal.exec(raw)) !== null) {
    keys.add(`Barangay ${m[1]}`);
  }

  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    if (/^lot\s+/i.test(part)) continue;
    const brgyOnly = part.match(/^(?:Barangay|BRGY|Brgy\.?)\s*(\d+)$/i);
    if (brgyOnly) {
      keys.add(`Barangay ${brgyOnly[1]}`);
      continue;
    }
    if (part.length >= 2) keys.add(part);
  }

  return [...keys];
}

/** Order filter dropdown: Barangay first, then streets in catalog order, then any other legacy keys. */
function sortLocationFilterOptions(keys: string[]): string[] {
  const streetOrder = new Map(RESIDENT_STREET_OPTIONS.map((s, i) => [s, i]));
  return [...keys].sort((a, b) => {
    const ma = a.match(/^Barangay\s+(\d+)$/i);
    const mb = b.match(/^Barangay\s+(\d+)$/i);
    if (ma && mb) return Number(ma[1]) - Number(mb[1]);
    if (ma && !mb) return -1;
    if (!ma && mb) return 1;
    const ia = streetOrder.has(a) ? streetOrder.get(a)! : 1000;
    const ib = streetOrder.has(b) ? streetOrder.get(b)! : 1000;
    if (ia !== 1000 || ib !== 1000) return ia - ib;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
}

/**
 * Location filter = street when `streetName` is set (current model).
 * Legacy rows: barangay + comma segments, and lines like "12 Twin Peaks Drive" collapse to the known street name.
 */
function collectResidentLocationKeys(resident: Resident): string[] {
  const sn = resident.streetName?.trim();
  if (sn) return sortLocationFilterOptions([sn]);

  const set = new Set<string>(extractLocationKeysFromAddress(resident.address));
  for (const k of [...set]) {
    const m = k.match(/^\s*\S+\s+(.+)$/);
    if (m && RESIDENT_STREET_SET.has(m[1].trim())) {
      set.add(m[1].trim());
      set.delete(k);
    }
  }
  return sortLocationFilterOptions([...set]);
}

function residentMatchesLocationFilter(resident: Resident, locationKey: string): boolean {
  if (locationKey === 'all') return true;
  return collectResidentLocationKeys(resident).includes(locationKey);
}

function violationsForResidentLinkedPlates(
  residentId: string,
  vehicles: Vehicle[],
  violations: Violation[],
): Violation[] {
  const plates = new Set(
    vehicles.filter((v) => v.residentId === residentId).map((v) => normPlate(v.plateNumber)),
  );
  if (plates.size === 0) return [];
  return violations.filter((vi) => plates.has(normPlate(vi.plateNumber)));
}

function hasActiveViolationsStanding(residentId: string, vehicles: Vehicle[], violations: Violation[]): boolean {
  return violationsForResidentLinkedPlates(residentId, vehicles, violations).some(
    (vi) => vi.status === 'issued' || vi.status === 'pending',
  );
}

function isCleanViolationRecord(residentId: string, vehicles: Vehicle[], violations: Violation[]): boolean {
  return violationsForResidentLinkedPlates(residentId, vehicles, violations).length === 0;
}

function linkedVehicleCount(residentId: string, vehicles: Vehicle[]): number {
  return vehiclesForResident(residentId, vehicles).length;
}

function lastViolationActivityMs(residentId: string, vehicles: Vehicle[], violations: Violation[]): number {
  const list = violationsForResidentLinkedPlates(residentId, vehicles, violations);
  if (list.length === 0) return 0;
  return Math.max(...list.map((vi) => new Date(vi.timeDetected).getTime()));
}

function resolveResidentStatus(r: Resident): ResidentStatus {
  return r.residentStatus === 'guest' ? 'guest' : 'verified';
}

function statusBadgeVariant(s: ResidentStatus): 'success' | 'secondary' {
  return s === 'verified' ? 'success' : 'secondary';
}

function violationAccentClass(status: Violation['status']): string {
  switch (status) {
    case 'warning':
      return 'bg-amber-500';
    case 'pending':
      return 'bg-blue-500';
    case 'issued':
      return 'bg-destructive';
    case 'cancelled':
      return 'bg-muted-foreground';
    case 'cleared':
    case 'resolved':
      return 'bg-emerald-500';
    default:
      return 'bg-muted-foreground';
  }
}

function vehiclesForResident(residentId: string, vehicles: Vehicle[]) {
  return vehicles.filter((v) => v.residentId === residentId);
}

function recentViolationsForResident(residentId: string, vehicles: Vehicle[], violations: Violation[]) {
  const plates = new Set(
    vehicles.filter((v) => v.residentId === residentId).map((v) => normPlate(v.plateNumber)),
  );
  if (plates.size === 0) return [];
  return violations
    .filter((vi) => plates.has(normPlate(vi.plateNumber)))
    .sort((a, b) => new Date(b.timeDetected).getTime() - new Date(a.timeDetected).getTime())
    .slice(0, 3);
}

function smsHrefForNumber(contact: string): string | null {
  const digits = contact.replace(/\D/g, '');
  if (!digits) return null;
  return `sms:${digits}`;
}

export default function Residents() {
  usePageTracking();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isBarangayUser = user?.role === 'barangay_user';
  const [residents, setResidents] = useState<Resident[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [standingFilter, setStandingFilter] = useState<StandingFilter>('all');
  const [sortBy, setSortBy] = useState<ResidentSort>('name_asc');
  const [registryHasResidents, setRegistryHasResidents] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingResident, setEditingResident] = useState<Resident | null>(null);
  const [residentToDelete, setResidentToDelete] = useState<Resident | null>(null);
  const [isDeletingResident, setIsDeletingResident] = useState(false);
  const [profileResident, setProfileResident] = useState<Resident | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    contactNumber: '',
    houseNumber: '',
    streetName: '',
    residentStatus: 'verified' as ResidentStatus,
  });

  const loadResidents = useCallback(async (initial = false, term = '') => {
    try {
      if (initial) {
        setIsInitialLoading(true);
      } else {
        setIsRefreshing(true);
      }
      const data = await residentsAPI.getAll(term || undefined);
      setResidents(data);
    } catch (error) {
      console.error('Error loading residents:', error);
      toast({
        title: 'Error',
        description: 'Failed to load residents. Make sure the backend server is running.',
        variant: 'destructive',
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
    loadResidents(true);
  }, [loadResidents]);

  useEffect(() => {
    if (isInitialLoading) return;
    const timeout = setTimeout(() => {
      loadResidents(false, searchTerm);
    }, 250);
    return () => clearTimeout(timeout);
  }, [isInitialLoading, loadResidents, searchTerm]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [v, viol] = await Promise.all([
          vehiclesAPI.getAll(),
          violationsAPI.getAll({ limit: 500 }),
        ]);
        if (!cancelled) {
          setVehicles(
            v.map((x: Vehicle) => ({
              ...x,
              registeredAt: x.registeredAt instanceof Date ? x.registeredAt : new Date(x.registeredAt),
            })),
          );
          setViolations(
            viol.map((x: Violation) => ({
              ...x,
              timeDetected: x.timeDetected instanceof Date ? x.timeDetected : new Date(x.timeDetected),
              timeIssued: x.timeIssued
                ? x.timeIssued instanceof Date
                  ? x.timeIssued
                  : new Date(x.timeIssued)
                : undefined,
              warningExpiresAt: x.warningExpiresAt
                ? x.warningExpiresAt instanceof Date
                  ? x.warningExpiresAt
                  : new Date(x.warningExpiresAt)
                : undefined,
            })),
          );
        }
      } catch (e) {
        console.error('Error loading registry context:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (searchTerm.trim() === '') {
      setRegistryHasResidents(residents.length > 0);
    }
  }, [residents, searchTerm]);

  const uniqueLocationOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of residents) {
      for (const k of collectResidentLocationKeys(r)) {
        set.add(k);
      }
    }
    return sortLocationFilterOptions([...set]);
  }, [residents]);

  useEffect(() => {
    if (locationFilter !== 'all' && !uniqueLocationOptions.includes(locationFilter)) {
      setLocationFilter('all');
    }
  }, [locationFilter, uniqueLocationOptions]);

  const hasActiveFilters =
    locationFilter !== 'all' || standingFilter !== 'all' || sortBy !== 'name_asc';

  const clearSearchAndFilters = useCallback(() => {
    setSearchTerm('');
    setLocationFilter('all');
    setStandingFilter('all');
    setSortBy('name_asc');
  }, []);

  const filteredResidents = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    let list = residents.filter(
      (r) =>
        !q ||
        r.name.toLowerCase().includes(q) ||
        r.contactNumber.toLowerCase().includes(q) ||
        formatResidentAddressLine(r).toLowerCase().includes(q) ||
        (r.address && r.address.toLowerCase().includes(q)) ||
        (r.houseNumber && r.houseNumber.toLowerCase().includes(q)) ||
        (r.streetName && r.streetName.toLowerCase().includes(q)),
    );

    if (locationFilter !== 'all') {
      list = list.filter((r) => residentMatchesLocationFilter(r, locationFilter));
    }

    if (standingFilter === 'active_violations') {
      list = list.filter((r) => hasActiveViolationsStanding(r.id, vehicles, violations));
    } else if (standingFilter === 'clean') {
      list = list.filter((r) => isCleanViolationRecord(r.id, vehicles, violations));
    }

    list = [...list].sort((a, b) => {
      switch (sortBy) {
        case 'most_vehicles': {
          const ca = linkedVehicleCount(a.id, vehicles);
          const cb = linkedVehicleCount(b.id, vehicles);
          if (cb !== ca) return cb - ca;
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        }
        case 'recent_violation': {
          const ta = lastViolationActivityMs(a.id, vehicles, violations);
          const tb = lastViolationActivityMs(b.id, vehicles, violations);
          if (tb !== ta) return tb - ta;
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        }
        default:
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      }
    });

    return list;
  }, [
    residents,
    searchTerm,
    vehicles,
    violations,
    locationFilter,
    standingFilter,
    sortBy,
  ]);

  const resetForm = () => {
    setFormData({
      name: '',
      contactNumber: '',
      houseNumber: '',
      streetName: '',
      residentStatus: 'verified',
    });
    setEditingResident(null);
  };

  const handleOpenDialog = (resident?: Resident) => {
    if (isBarangayUser) {
      toast({
        title: 'Permission Denied',
        description: 'Barangay users are not allowed to modify residents.',
        variant: 'destructive',
      });
      return;
    }
    if (resident) {
      setEditingResident(resident);
      setFormData({
        name: resident.name,
        contactNumber: resident.contactNumber,
        houseNumber: resident.houseNumber || '',
        streetName: resident.streetName || '',
        residentStatus: resolveResidentStatus(resident),
      });
    } else {
      resetForm();
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    resetForm();
  };

  const handleSaveResident = async () => {
    if (isBarangayUser) {
      toast({
        title: 'Permission Denied',
        description: 'Barangay users are not allowed to modify residents.',
        variant: 'destructive',
      });
      return;
    }
    if (!formData.name || !formData.contactNumber) {
      toast({
        title: 'Validation Error',
        description: 'Please fill in name and contact number',
        variant: 'destructive',
      });
      return;
    }
    const street = formData.streetName.trim();
    if (!street) {
      toast({
        title: 'Validation Error',
        description: 'Please select a street',
        variant: 'destructive',
      });
      return;
    }
    if (!RESIDENT_STREET_SET.has(street)) {
      toast({
        title: 'Validation Error',
        description: 'Please choose a street from the list',
        variant: 'destructive',
      });
      return;
    }

    const payload = {
      name: formData.name,
      contactNumber: formData.contactNumber,
      houseNumber: formData.houseNumber.trim(),
      streetName: street,
      residentStatus: formData.residentStatus,
    };

    try {
      let saved: Resident;
      if (editingResident) {
        saved = await residentsAPI.update(editingResident.id, payload);
        toast({
          title: 'Resident Updated',
          description: 'Resident details updated successfully',
        });
      } else {
        const residentId = `RESIDENT-${Date.now()}`;
        saved = await residentsAPI.create({
          id: residentId,
          ...payload,
        });
        toast({
          title: 'Resident Added',
          description: 'New resident added successfully',
        });
      }
      handleCloseDialog();
      loadResidents();
      const normalizedSaved: Resident = {
        ...saved,
        createdAt: saved.createdAt instanceof Date ? saved.createdAt : new Date(saved.createdAt as unknown as string),
      };
      setProfileResident((prev) =>
        prev && editingResident && prev.id === editingResident.id ? { ...prev, ...normalizedSaved } : prev,
      );
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save resident',
        variant: 'destructive',
      });
    }
  };

  const requestDeleteResident = (resident: Resident) => {
    if (isBarangayUser) {
      toast({
        title: 'Permission Denied',
        description: 'Barangay users are not allowed to modify residents.',
        variant: 'destructive',
      });
      return;
    }
    setResidentToDelete(resident);
  };

  const confirmDeleteResident = async () => {
    if (!residentToDelete) return;
    if (isBarangayUser) {
      setResidentToDelete(null);
      return;
    }
    const id = residentToDelete.id;
    setIsDeletingResident(true);
    try {
      await residentsAPI.delete(id);
      toast({
        title: 'Resident Deleted',
        description: 'Resident removed from registry',
      });
      setResidentToDelete(null);
      setProfileResident((p) => (p?.id === id ? null : p));
      loadResidents();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete resident',
        variant: 'destructive',
      });
    } finally {
      setIsDeletingResident(false);
    }
  };

  const deleteButtonClassName =
    'h-8 w-8 border-red-600 text-red-600 hover:bg-red-600/15 hover:text-red-700 dark:hover:bg-red-600/20';

  const profileVehicles = profileResident ? vehiclesForResident(profileResident.id, vehicles) : [];
  const profileViolations = profileResident
    ? recentViolationsForResident(profileResident.id, vehicles, violations)
    : [];
  const profileSms = profileResident ? smsHrefForNumber(profileResident.contactNumber) : null;

  if (isInitialLoading) {
    return (
      <div className="min-h-screen">
        <Header title="Residents Registry" subtitle="Manage registered residents" />
        <div className="p-4 sm:p-6 flex items-center justify-center min-h-[50vh]">
          <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header title="Residents Registry" subtitle="Manage registered residents" />

      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        <div className="flex items-start gap-2 rounded-lg border border-border bg-card/70 px-3 py-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 text-primary shrink-0" />
          <p className="leading-relaxed">
            Search the grid and open a resident to see vehicles, recent violations, and quick actions. Residents
            receive SMS when a linked visitor vehicle is involved in enforcement workflows.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 min-w-0 sm:max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, contact, or address..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-secondary"
              id="residents-search"
            />
          </div>

          {!isBarangayUser && (
            <Dialog open={isDialogOpen} onOpenChange={(open) => (open ? handleOpenDialog() : handleCloseDialog())}>
              <DialogTrigger asChild>
                <Button className="w-full sm:w-auto">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Resident
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border mx-4 sm:mx-auto max-w-[calc(100vw-2rem)] sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>{editingResident ? 'Edit Resident' : 'Add New Resident'}</DialogTitle>
                  <DialogDescription>
                    {editingResident
                      ? 'Update the resident information below.'
                      : 'Enter the resident details to add them to the system.'}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name *</Label>
                    <Input
                      id="name"
                      placeholder="Juan dela Cruz"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="bg-secondary"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contactNumber">Contact Number *</Label>
                    <Input
                      id="contactNumber"
                      placeholder="+639171234567"
                      value={formData.contactNumber}
                      onChange={(e) => setFormData({ ...formData, contactNumber: e.target.value })}
                      className="bg-secondary"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="houseNumber">House number</Label>
                      <Input
                        id="houseNumber"
                        placeholder="e.g. 12-A"
                        value={formData.houseNumber}
                        onChange={(e) => setFormData({ ...formData, houseNumber: e.target.value })}
                        className="bg-secondary"
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-1">
                      <Label htmlFor="streetName">Street *</Label>
                      <Select
                        value={formData.streetName || '__unset__'}
                        onValueChange={(v) =>
                          setFormData({ ...formData, streetName: v === '__unset__' ? '' : v })
                        }
                      >
                        <SelectTrigger id="streetName" className="bg-secondary">
                          <SelectValue placeholder="Select street" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[280px]">
                          <SelectItem value="__unset__" className="text-muted-foreground">
                            Select street
                          </SelectItem>
                          {RESIDENT_STREET_OPTIONS.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Resident status</Label>
                    <Select
                      value={formData.residentStatus}
                      onValueChange={(v) => setFormData({ ...formData, residentStatus: v as ResidentStatus })}
                    >
                      <SelectTrigger className="bg-secondary">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="verified">Verified</SelectItem>
                        <SelectItem value="guest">Guest</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={handleSaveResident} className="w-full">
                    {editingResident ? 'Save Changes' : 'Add Resident'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card/50 p-3 sm:p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
            Filters
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="filter-standing" className="text-xs text-muted-foreground">
                Standing
              </Label>
              <Select
                value={standingFilter}
                onValueChange={(v) => setStandingFilter(v as StandingFilter)}
              >
                <SelectTrigger id="filter-standing" className="bg-secondary">
                  <SelectValue placeholder="Standing" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="active_violations">Active Violations</SelectItem>
                  <SelectItem value="clean">Clean Record</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Based on violations for vehicles linked to each resident (issued or pending vs. none).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-location" className="text-xs text-muted-foreground">
                Location
              </Label>
              <Select value={locationFilter} onValueChange={setLocationFilter}>
                <SelectTrigger id="filter-location" className="bg-secondary w-full max-w-full">
                  <SelectValue placeholder="All locations" />
                </SelectTrigger>
                <SelectContent className="max-h-[280px]">
                  <SelectItem value="all">All locations</SelectItem>
                  {uniqueLocationOptions.map((loc) => (
                    <SelectItem key={loc} value={loc}>
                      {loc}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Matches each resident&apos;s street (from the registry). Older free-text addresses still pick up
                Barangay tags and comma-separated segments when present.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <span className="text-xs text-muted-foreground font-medium">Sort by</span>
            <ToggleGroup
              type="single"
              value={sortBy}
              onValueChange={(v) => {
                if (v) setSortBy(v as ResidentSort);
              }}
              variant="outline"
              size="sm"
              className="flex flex-wrap justify-start gap-1.5"
              aria-label="Sort residents"
            >
              <ToggleGroupItem value="name_asc" className="text-xs px-2.5">
                Name (A–Z)
              </ToggleGroupItem>
              <ToggleGroupItem value="most_vehicles" className="text-xs px-2.5">
                Most Vehicles
              </ToggleGroupItem>
              <ToggleGroupItem value="recent_violation" className="text-xs px-2.5">
                Recent Activity
              </ToggleGroupItem>
            </ToggleGroup>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Recent activity uses the latest violation date for vehicles linked to each resident.
            </p>
          </div>
          {hasActiveFilters && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button type="button" variant="ghost" size="sm" className="h-8" onClick={clearSearchAndFilters}>
                Reset filters &amp; sort
              </Button>
            </div>
          )}
        </div>

        {isRefreshing && <p className="text-xs text-muted-foreground">Refreshing results...</p>}

        {filteredResidents.length > 0 ? (
          <>
            <div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
              role="list"
              aria-label="Residents"
            >
              {filteredResidents.map((resident) => {
                const status = resolveResidentStatus(resident);
                const rv = vehiclesForResident(resident.id, vehicles);
                const rvCount = rv.length;
                const hasActiveStanding = hasActiveViolationsStanding(resident.id, vehicles, violations);
                return (
                  <button
                    key={resident.id}
                    type="button"
                    role="listitem"
                    onClick={() => setProfileResident(resident)}
                    className={cn(
                      'glass-card rounded-xl p-4 text-left transition-shadow hover:shadow-md hover:ring-1 hover:ring-primary/20',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="min-w-0 flex-1 flex items-start gap-2">
                        {hasActiveStanding && (
                          <span
                            className="mt-2 h-2 w-2 shrink-0 rounded-full bg-destructive shadow-sm"
                            title="Has issued or pending violations on linked vehicles"
                            aria-hidden
                          />
                        )}
                        <div className="min-w-0 flex-1">
                        <p className="font-semibold text-lg text-foreground truncate">{resident.name}</p>
                        <Badge variant={statusBadgeVariant(status)} className="mt-1.5 capitalize">
                          {status === 'verified' ? (
                            <span className="inline-flex items-center gap-1">
                              <ShieldCheck className="h-3 w-3" /> Verified
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <UserCircle className="h-3 w-3" /> Guest
                            </span>
                          )}
                        </Badge>
                        </div>
                      </div>
                      {!isBarangayUser && (
                        <div
                          className="flex items-center gap-0.5 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label="Edit resident"
                            onClick={() => handleOpenDialog(resident)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => requestDeleteResident(resident)}
                            className={deleteButtonClassName}
                            aria-label="Delete resident"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <Phone className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{resident.contactNumber}</span>
                    </div>
                    {formatResidentAddressLine(resident) && (
                      <div className="flex items-start gap-2 text-xs text-muted-foreground line-clamp-2">
                        <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span>{formatResidentAddressLine(resident)}</span>
                      </div>
                    )}
                    <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                      <Car className="h-3.5 w-3.5" />
                      <span>
                        {rvCount === 0 ? 'No linked vehicles' : `${rvCount} vehicle${rvCount === 1 ? '' : 's'}`}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            <Sheet open={!!profileResident} onOpenChange={(open) => !open && setProfileResident(null)}>
              <SheetContent
                side="right"
                className="w-full sm:max-w-lg overflow-y-auto border-border bg-background px-4 sm:px-6"
              >
                {profileResident && (
                  <>
                    <SheetHeader className="text-left space-y-1 pr-8">
                      <SheetTitle className="text-xl">{profileResident.name}</SheetTitle>
                      <SheetDescription>Resident profile and registry context</SheetDescription>
                    </SheetHeader>
                    <div className="mt-6 space-y-6 pb-8">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={statusBadgeVariant(resolveResidentStatus(profileResident))} className="capitalize">
                          {resolveResidentStatus(profileResident) === 'verified' ? 'Verified' : 'Guest'}
                        </Badge>
                      </div>
                      <div className="space-y-3 text-sm">
                        <div className="flex items-start gap-2">
                          <Phone className="h-4 w-4 text-muted-foreground mt-0.5" />
                          <div>
                            <p className="text-xs uppercase text-muted-foreground">Contact</p>
                            <p className="font-medium">{profileResident.contactNumber}</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-2">
                          <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                          <div className="space-y-2 min-w-0">
                            {(profileResident.houseNumber?.trim() || profileResident.streetName?.trim()) ? (
                              <>
                                <div>
                                  <p className="text-xs uppercase text-muted-foreground">House number</p>
                                  <p className="font-medium">{profileResident.houseNumber?.trim() || '—'}</p>
                                </div>
                                <div>
                                  <p className="text-xs uppercase text-muted-foreground">Street</p>
                                  <p className="font-medium">{profileResident.streetName?.trim() || '—'}</p>
                                </div>
                              </>
                            ) : (
                              <div>
                                <p className="text-xs uppercase text-muted-foreground">Address (legacy)</p>
                                <p className="font-medium break-words">
                                  {profileResident.address?.trim() || '—'}
                                </p>
                                <p className="text-[11px] text-muted-foreground mt-1">
                                  Edit this resident and choose a street from the list to use the new address format.
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div>
                        <p className="text-xs uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
                          <Car className="h-3.5 w-3.5" /> Registered vehicles
                        </p>
                        {profileVehicles.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No vehicles linked to this resident.</p>
                        ) : (
                          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
                            {profileVehicles.map((v) => (
                              <div
                                key={v.id}
                                className="shrink-0 rounded-lg border border-border bg-secondary/40 px-3 py-2 min-w-[130px] max-w-[180px]"
                              >
                                <p className="font-mono text-sm font-medium">{v.plateNumber}</p>
                                <p className="text-xs text-muted-foreground truncate" title={v.ownerName}>
                                  {v.ownerName}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <p className="text-xs uppercase text-muted-foreground mb-2">Violation history</p>
                        {profileViolations.length === 0 ? (
                          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
                            Clean record — no recent infractions on file for linked plates.
                          </div>
                        ) : (
                          <ul className="space-y-3 border-l-2 border-border pl-4 ml-1">
                            {profileViolations.map((vi) => (
                              <li key={vi.id} className="relative">
                                <span
                                  className={cn(
                                    'absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full',
                                    violationAccentClass(vi.status),
                                  )}
                                />
                                <p className="text-xs text-muted-foreground">
                                  {new Date(vi.timeDetected).toLocaleString()}
                                </p>
                                <p className="text-sm font-medium font-mono">{vi.plateNumber}</p>
                                <p className="text-xs capitalize text-muted-foreground">Status: {vi.status}</p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div className="flex flex-col gap-2 pt-2 border-t border-border">
                        <p className="text-xs uppercase text-muted-foreground">Quick actions</p>
                        <div className="flex flex-col sm:flex-row flex-wrap gap-2">
                          {profileSms ? (
                            <Button variant="default" className="gap-2" asChild>
                              <a href={profileSms}>
                                <MessageSquare className="h-4 w-4" />
                                SMS resident
                              </a>
                            </Button>
                          ) : (
                            <Button variant="outline" disabled className="gap-2">
                              <MessageSquare className="h-4 w-4" />
                              SMS unavailable
                            </Button>
                          )}
                          {!isBarangayUser && (
                            <Button
                              variant="secondary"
                              className="gap-2"
                              onClick={() => {
                                handleOpenDialog(profileResident);
                                setProfileResident(null);
                              }}
                            >
                              <Edit className="h-4 w-4" />
                              Edit profile
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            className="gap-2"
                            onClick={() => {
                              navigate('/audit-logs', { state: { presetSearch: profileResident.name } });
                              setProfileResident(null);
                            }}
                          >
                            <ScrollText className="h-4 w-4" />
                            View activity logs
                          </Button>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </SheetContent>
            </Sheet>

            <AlertDialog
              open={!!residentToDelete}
              onOpenChange={(open) => {
                if (!open) setResidentToDelete(null);
              }}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete resident</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete this record?
                    {residentToDelete && (
                      <>
                        {' '}
                        This will permanently remove{' '}
                        <span className="font-semibold text-foreground">{residentToDelete.name}</span> from the
                        registry.
                      </>
                    )}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isDeletingResident}>Cancel</AlertDialogCancel>
                  <Button
                    type="button"
                    className="bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600"
                    disabled={isDeletingResident}
                    onClick={() => void confirmDeleteResident()}
                  >
                    {isDeletingResident ? 'Deleting…' : 'Delete'}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : residents.length > 0 && filteredResidents.length === 0 ? (
          <div className="glass-card rounded-xl p-8 sm:p-12 text-center">
            <Search className="mx-auto mb-4 h-14 w-14 sm:h-16 sm:w-16 text-muted-foreground" strokeWidth={1.25} />
            <h3 className="text-lg font-semibold text-foreground mb-2">No matching residents</h3>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto text-sm leading-relaxed">
              Nothing in the current list matches your search text or filters. Try widening the search or resetting
              filters and sort.
            </p>
            <Button type="button" variant="secondary" onClick={clearSearchAndFilters}>
              Clear search, filters &amp; sort
            </Button>
          </div>
        ) : registryHasResidents && searchTerm.trim() ? (
          <SearchNoMatchesEmpty searchTerm={searchTerm} onClear={clearSearchAndFilters} />
        ) : (
          <div className="glass-card rounded-xl p-8 sm:p-12 text-center">
            <Home className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No Residents Registered</h3>
            <p className="text-muted-foreground mb-6">Add your first resident to the registry</p>
            {!isBarangayUser && (
              <Button onClick={() => handleOpenDialog()}>
                <Plus className="h-4 w-4 mr-2" />
                Add Your First Resident
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
