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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/hooks/use-toast';
import { vehiclesAPI, residentsAPI, violationsAPI, detectionsAPI } from '@/lib/api';
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

function formatLastSeenCompact(ts: string | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString([], { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

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

function isResidentLinkedVehicle(vehicle: Vehicle): boolean {
  return !!vehicle.residentId && String(vehicle.residentId).trim().length > 0;
}

function VehicleCategoryBadge({ vehicle }: { vehicle: Vehicle }) {
  if (isResidentLinkedVehicle(vehicle)) {
    return <Badge className="border-transparent bg-blue-900 text-blue-200 shadow-none">Resident</Badge>;
  }

  const cat = String(vehicle.visitorCategory ?? '').toLowerCase().trim();
  if (cat === 'delivery') {
    return <Badge className="border-transparent bg-orange-900 text-orange-200 shadow-none">Delivery</Badge>;
  }

  return <Badge className="border-transparent bg-purple-900 text-purple-200 shadow-none">Non-Resident</Badge>;
}

type MasterVehicleTableProps = {
  vehicles: Vehicle[];
  isAdmin: boolean;
  isEncoder: boolean;
  deleteButtonClassName: string;
  getResidentNameForVehicle: (vehicle: Vehicle) => string | null;
  onViewVehicle: (vehicle: Vehicle) => void;
  onEditVehicle: (vehicle: Vehicle) => void;
  onDeleteVehicle: (vehicle: Vehicle) => void;
  lastSeenByPlate: Record<string, string | null>;
  infractionCountByPlate: Record<string, number>;
  isMetaLoading: boolean;
};

function MasterVehicleTable({
  vehicles,
  isAdmin,
  isEncoder,
  deleteButtonClassName,
  getResidentNameForVehicle,
  onViewVehicle,
  onEditVehicle,
  onDeleteVehicle,
  lastSeenByPlate,
  infractionCountByPlate,
  isMetaLoading,
}: MasterVehicleTableProps) {
  const canDelete = isAdmin && !isEncoder;

  const renderOwner = (vehicle: Vehicle) => getResidentNameForVehicle(vehicle) ?? vehicle.ownerName;
  const renderLastSeen = (vehicle: Vehicle) => {
    if (isMetaLoading) return '—';
    const key = normPlate(vehicle.plateNumber);
    const ts = lastSeenByPlate[key];
    if (!ts) return '—';
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
  };
  const renderInfractions = (vehicle: Vehicle) => {
    if (isMetaLoading) return '—';
    const key = normPlate(vehicle.plateNumber);
    return String(infractionCountByPlate[key] ?? 0);
  };

  return (
    <>
      <div className="block sm:hidden space-y-3">
        {vehicles.map((vehicle) => {
          const canEdit = canDelete && isResidentLinkedVehicle(vehicle);
          return (
            <div key={vehicle.id} className="glass-card rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-medium text-lg">{vehicle.plateNumber}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => onViewVehicle(vehicle)}
                  aria-label="View vehicle"
                >
                  <Info className="h-4 w-4" />
                </Button>
              </div>

              <div className="text-sm text-muted-foreground">{formatVehicleTypeLabel(vehicle.vehicleType)}</div>

              <div className="flex items-start justify-between gap-3">
                <div className="text-sm text-foreground font-medium">{renderOwner(vehicle)}</div>
                <VehicleCategoryBadge vehicle={vehicle} />
              </div>

              {!isResidentLinkedVehicle(vehicle) ? (
                <div className="text-xs text-muted-foreground">Contact: {vehicle.contactNumber || '—'}</div>
              ) : null}

              <div className="text-xs text-muted-foreground">Last seen: {renderLastSeen(vehicle)}</div>
              <div className="text-xs text-muted-foreground">Infractions: {renderInfractions(vehicle)}</div>

              <div className="text-xs text-muted-foreground">
                Date registered: {new Date(vehicle.registeredAt).toLocaleDateString()}
              </div>

              {canDelete && (canEdit || canDelete) ? (
                <div className="flex items-center gap-1 pt-1">
                  {canEdit ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => onEditVehicle(vehicle)}
                      aria-label="Edit vehicle"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                  ) : null}

                  {canDelete ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => onDeleteVehicle(vehicle)}
                      className={deleteButtonClassName}
                      aria-label="Delete vehicle"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="glass-card rounded-xl overflow-hidden hidden sm:block">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Plate Number</TableHead>
                <TableHead className="text-muted-foreground">Vehicle Type</TableHead>
                <TableHead className="text-muted-foreground">Owner</TableHead>
                <TableHead className="text-muted-foreground">Category</TableHead>
                <TableHead className="text-muted-foreground">Last Seen</TableHead>
                <TableHead className="text-muted-foreground">Infractions</TableHead>
                <TableHead className="text-muted-foreground">Date Registered</TableHead>
                <TableHead className="text-muted-foreground text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vehicles.map((vehicle) => {
                const canEdit = canDelete && isResidentLinkedVehicle(vehicle);
                return (
                  <TableRow key={vehicle.id} className="border-border">
                    <TableCell className="font-mono font-medium">{vehicle.plateNumber}</TableCell>
                    <TableCell>{formatVehicleTypeLabel(vehicle.vehicleType)}</TableCell>
                    <TableCell className="font-medium">{renderOwner(vehicle)}</TableCell>
                    <TableCell>
                      <VehicleCategoryBadge vehicle={vehicle} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{renderLastSeen(vehicle)}</TableCell>
                    <TableCell className="text-muted-foreground">{renderInfractions(vehicle)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(vehicle.registeredAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onViewVehicle(vehicle)}
                          aria-label="View vehicle"
                        >
                          <Info className="h-4 w-4" />
                        </Button>
                        {canEdit ? (
                          <Button variant="ghost" size="icon" onClick={() => onEditVehicle(vehicle)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {canDelete ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => onDeleteVehicle(vehicle)}
                            className={deleteButtonClassName}
                            aria-label="Delete vehicle"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </>
  );
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
  const [allVehicles, setAllVehicles] = useState<Vehicle[]>([]);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [vehicleTab, setVehicleTab] = useState<'all' | 'residents' | 'non-residents'>('all');
  const [lastSeenByPlate, setLastSeenByPlate] = useState<Record<string, string | null>>({});
  const [infractionCountByPlate, setInfractionCountByPlate] = useState<Record<string, number>>({});
  const [isMetaLoading, setIsMetaLoading] = useState(false);
  const [recentlyDetectedPlates, setRecentlyDetectedPlates] = useState<
    Array<{ plateNumber: string; lastSeen: string | null }>
  >([]);
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
  const ownerNameInputRef = useRef<HTMLInputElement>(null);
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
      if (initial || !term) setAllVehicles(data);
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

  // Load plate-linked metadata (Last Seen + Infractions) + recent unknown-plate suggestions.
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!allVehicles.length) return;

      const plateNumbersRaw = Array.from(
        new Set(allVehicles.map((v) => String(v.plateNumber || '').trim()).filter(Boolean)),
      );
      if (!plateNumbersRaw.length) return;

      const registeredPlateKeys = new Set(plateNumbersRaw.map(normPlate));

      setIsMetaLoading(true);
      try {
        // Last Seen (detection)
        const lastSeenTemp: Record<string, string | null> = {};
        for (let i = 0; i < plateNumbersRaw.length; i += 60) {
          const chunk = plateNumbersRaw.slice(i, i + 60);
          const rows = await detectionsAPI.getLatestByPlates(chunk);
          rows.forEach((r: { plateNumber: string; lastSeen: string | null }) => {
            lastSeenTemp[normPlate(r.plateNumber)] = r.lastSeen;
          });
        }
        if (!cancelled) setLastSeenByPlate(lastSeenTemp);

        // Infractions count (violations)
        const infTemp: Record<string, number> = {};
        for (let i = 0; i < plateNumbersRaw.length; i += 60) {
          const chunk = plateNumbersRaw.slice(i, i + 60);
          const rows = await violationsAPI.getInfractionCountByPlates(chunk);
          rows.forEach((r: { plateNumber: string; infractionCount: number }) => {
            infTemp[normPlate(r.plateNumber)] = r.infractionCount;
          });
        }
        if (!cancelled) setInfractionCountByPlate(infTemp);
      } catch (error) {
        if (!cancelled) {
          // Keep UI usable even if meta endpoints fail.
          setRecentlyDetectedPlates([]);
          setLastSeenByPlate({});
          setInfractionCountByPlate({});
        }
        console.error('Failed to load plate metadata:', error);
      } finally {
        if (!cancelled) setIsMetaLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [allVehicles, isBarangayUser]);

  // Poll unknown-plate suggestions (rapid-entry UX).
  useEffect(() => {
    if (isBarangayUser) return;
    if (!allVehicles.length) return;

    let cancelled = false;
    const registeredPlateKeys = new Set(allVehicles.map((v) => normPlate(v.plateNumber)));

    const tick = async () => {
      try {
        const recent = await detectionsAPI.getRecentPlates(12);
        const unknown = recent
          .map((r: { plateNumber: string; lastSeen: string | null }) => ({
            plateNumber: r.plateNumber,
            lastSeen: r.lastSeen,
          }))
          .filter((r) => !registeredPlateKeys.has(normPlate(r.plateNumber)));

        if (!cancelled) setRecentlyDetectedPlates(unknown);
      } catch {
        // Non-fatal: keep the current suggestions.
      }
    };

    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, 25000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [allVehicles, isBarangayUser]);

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

  const nonResidentVehicles = useMemo(
    () =>
      vehicles.filter(
        (v) => !v.residentId || (typeof v.residentId === 'string' && v.residentId.trim() === ''),
      ),
    [vehicles],
  );

  const filteredNonResidentVehicles = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return nonResidentVehicles;
    return nonResidentVehicles.filter(
      (v) => v.plateNumber.toLowerCase().includes(q) || v.ownerName.toLowerCase().includes(q),
    );
  }, [nonResidentVehicles, searchTerm]);

  type VehicleCategoryTab = 'all' | 'residents' | 'non-residents';
  const effectiveVehicleTab: VehicleCategoryTab = residentFilterId ? 'residents' : vehicleTab;

  const vehiclesForTab = useMemo((): Vehicle[] => {
    if (effectiveVehicleTab === 'residents') return displayedLinkedVehicles;
    if (effectiveVehicleTab === 'non-residents') return filteredNonResidentVehicles;
    return [...displayedLinkedVehicles, ...filteredNonResidentVehicles];
  }, [effectiveVehicleTab, displayedLinkedVehicles, filteredNonResidentVehicles]);

  const ownerQuery = formData.ownerName.trim().toLowerCase();
  type OwnerKind = 'resident' | 'visitor';
  const suggestedOwners = useMemo(() => {
    const kindFromResident = (r: Resident): OwnerKind => (r.residentStatus === 'guest' ? 'visitor' : 'resident');

    if (!residents.length) return [];
    const q = ownerQuery;
    const matchesQuery = (r: Resident) => {
      if (!q) return true;
      const name = r.name.toLowerCase();
      const phone = String(r.contactNumber || '').replace(/\D/g, '');
      const qDigits = q.replace(/\D/g, '');
      return name.includes(q) || (qDigits.length > 0 && phone.includes(qDigits));
    };

    const residentMatches = residents
      .filter((r) => kindFromResident(r) === 'resident')
      .filter(matchesQuery)
      .map((resident) => ({ kind: 'resident' as const, resident }));

    const visitorMatches = residents
      .filter((r) => kindFromResident(r) === 'visitor')
      .filter(matchesQuery)
      .map((resident) => ({ kind: 'visitor' as const, resident }));

    return [...residentMatches, ...visitorMatches]
      .sort((a, b) => a.resident.name.localeCompare(b.resident.name))
      .slice(0, 12);
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

  const applyDetectedPlate = useCallback((plate: string) => {
    const nextPlate = plate.trim().toUpperCase();
    setFormData((prev) => ({ ...prev, plateNumber: nextPlate, ownerName: '', residentId: '' }));
    setOwnerSuggestSurface(null);
    requestAnimationFrame(() => {
      ownerNameInputRef.current?.focus();
    });
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

  const nonResidentForInfoDialog = useMemo(() => {
    if (!selectedVehicle) return null;
    const rid = selectedVehicle.residentId;
    if (rid && String(rid).trim() !== '') return null;
    return selectedVehicle;
  }, [selectedVehicle]);

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

                <div className="flex gap-2 items-start">
                  <div className="flex-1">
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

                  {!isBarangayUser && formData.plateNumber.trim() === '' && recentlyDetectedPlates.length > 0 ? (
                    <div className="hidden sm:block w-[220px]">
                      <p className="text-xs text-muted-foreground font-semibold">Recently Detected</p>
                      <ul className="mt-2 space-y-1">
                        {recentlyDetectedPlates.slice(0, 5).map((d) => (
                          <li key={d.plateNumber}>
                            <button
                              type="button"
                              className="w-full text-left px-2 py-1.5 rounded-md bg-popover border border-border hover:bg-accent hover:text-accent-foreground"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => applyDetectedPlate(d.plateNumber)}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono font-medium text-sm">{d.plateNumber}</span>
                                {d.lastSeen ? <span className="text-[11px] text-muted-foreground">{formatLastSeenCompact(d.lastSeen)}</span> : null}
                              </div>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>

                {!isBarangayUser && formData.plateNumber.trim() === '' && recentlyDetectedPlates.length > 0 ? (
                  <div className="sm:hidden">
                    <p className="text-xs text-muted-foreground font-semibold">Recently Detected</p>
                    <ul className="mt-2 space-y-1">
                      {recentlyDetectedPlates.slice(0, 5).map((d) => (
                        <li key={d.plateNumber}>
                          <button
                            type="button"
                            className="w-full text-left px-2 py-1.5 rounded-md bg-popover border border-border hover:bg-accent hover:text-accent-foreground"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => applyDetectedPlate(d.plateNumber)}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono font-medium text-sm">{d.plateNumber}</span>
                              {d.lastSeen ? <span className="text-[11px] text-muted-foreground">{formatLastSeenCompact(d.lastSeen)}</span> : null}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
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
                      ref={ownerNameInputRef}
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
                  {ownerSuggestSurface === 'inline' && suggestedOwners.length > 0 ? (
                    <ul
                      id="resident-owner-suggestions-inline"
                      role="listbox"
                      className={cn(
                        'absolute z-[100] mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-popover py-1 shadow-md',
                      )}
                    >
                      {suggestedOwners.map(({ kind, resident }) => (
                        <li
                          key={`${kind}-${resident.id}`}
                          role="option"
                          aria-selected={formData.residentId === resident.id}
                        >
                          <button
                            type="button"
                            className={cn(
                              'flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                              formData.residentId === resident.id && 'bg-accent/60',
                            )}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              selectOwnerResident(resident);
                            }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-foreground">{resident.name}</span>
                              <Badge
                                className={cn(
                                  'border-transparent text-white hover:bg-blue-900/80',
                                  kind === 'resident' ? 'bg-blue-900' : 'bg-purple-900 hover:bg-purple-900/80',
                                )}
                              >
                                {kind === 'resident' ? 'Resident' : 'Visitor'}
                              </Badge>
                            </div>
                            <span className="text-xs text-muted-foreground">{resident.contactNumber}</span>
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
                    Type to search residents and visitors by name or number, or enter a standalone owner name.
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
          <Tabs
            value={effectiveVehicleTab}
            onValueChange={(v) => {
              if (residentFilterId) return;
              setVehicleTab(v as 'all' | 'residents' | 'non-residents');
            }}
            className="w-full sm:w-auto"
          >
            <TabsList className="w-full sm:w-auto flex">
              <TabsTrigger value="all">All Vehicles</TabsTrigger>
              <TabsTrigger value="residents">Residents</TabsTrigger>
              <TabsTrigger value="non-residents">Non-Residents</TabsTrigger>
            </TabsList>
          </Tabs>

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
                    {ownerSuggestSurface === 'dialog' && suggestedOwners.length > 0 ? (
                      <ul
                        id="resident-owner-suggestions-dialog"
                        role="listbox"
                        className={cn(
                          'absolute z-[100] mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-popover py-1 shadow-md',
                        )}
                      >
                        {suggestedOwners.map(({ kind, resident }) => (
                          <li
                            key={`${kind}-${resident.id}`}
                            role="option"
                            aria-selected={formData.residentId === resident.id}
                          >
                            <button
                              type="button"
                              className={cn(
                                'flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                                formData.residentId === resident.id && 'bg-accent/60',
                              )}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                selectOwnerResident(resident);
                              }}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-foreground">{resident.name}</span>
                                <Badge
                                  className={cn(
                                    'border-transparent text-white hover:bg-blue-900/80',
                                    kind === 'resident' ? 'bg-blue-900' : 'bg-purple-900 hover:bg-purple-900/80',
                                  )}
                                >
                                  {kind === 'resident' ? 'Resident' : 'Visitor'}
                                </Badge>
                              </div>
                              <span className="text-xs text-muted-foreground">{resident.contactNumber}</span>
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
                      Type to search residents and visitors by name or number, or enter a standalone owner name.
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

        {vehiclesForTab.length > 0 ? (
          <>
            <MasterVehicleTable
              vehicles={vehiclesForTab}
              isAdmin={isAdmin}
              isEncoder={isEncoder}
              deleteButtonClassName={deleteButtonClassName}
              getResidentNameForVehicle={getResidentNameForVehicle}
              onViewVehicle={handleViewVehicle}
              onEditVehicle={handleOpenEditDialog}
              onDeleteVehicle={requestDeleteVehicle}
              lastSeenByPlate={lastSeenByPlate}
              infractionCountByPlate={infractionCountByPlate}
              isMetaLoading={isMetaLoading}
            />

            {/* Desktop Tables */}
            {/* Old resident/non-resident table blocks removed in favor of MasterVehicleTable */}
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
                    {residentForInfoDialog
                      ? residentForInfoDialog.name
                      : nonResidentForInfoDialog
                        ? 'Non-Resident Vehicle'
                        : 'Vehicle summary'}
                  </DialogTitle>
                  <DialogDescription>
                    {selectedVehicle ? (
                      <>
                        {residentForInfoDialog ? 'Linked resident for vehicle' : 'Non-resident vehicle'}{' '}
                        <span className="font-mono font-medium text-foreground">{selectedVehicle.plateNumber}</span>
                      </>
                    ) : (
                      'Vehicle details'
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
                ) : selectedVehicle && nonResidentForInfoDialog ? (
                  <div className="space-y-4 py-2 text-sm">
                    <div className="flex flex-wrap gap-2">
                      <Badge className="border-transparent bg-purple-900 text-white shadow-none">
                        Non-Resident
                      </Badge>
                      <Badge className="border-transparent bg-purple-900/80 text-white shadow-none">
                        {((nonResidentForInfoDialog.visitorCategory ?? 'guest') === 'delivery'
                          ? 'Delivery'
                          : (nonResidentForInfoDialog.visitorCategory ?? 'guest') === 'rental'
                            ? 'Rental'
                            : 'Guest') as string}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Owner</p>
                      <p className="font-medium text-foreground leading-snug">
                        {nonResidentForInfoDialog.ownerName || '—'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Contact: {nonResidentForInfoDialog.contactNumber || '—'}
                      </p>
                    </div>
                    {nonResidentForInfoDialog.purposeOfVisit ? (
                      <p className="text-xs text-muted-foreground">
                        Purpose: {nonResidentForInfoDialog.purposeOfVisit}
                      </p>
                    ) : nonResidentForInfoDialog.rented ? (
                      <p className="text-xs text-muted-foreground">Rented: {nonResidentForInfoDialog.rented}</p>
                    ) : null}
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
        ) : vehicles.length > 0 && searchTerm.trim() ? (
          <SearchNoMatchesEmpty
            searchTerm={searchTerm}
            onClear={() => setSearchTerm('')}
            hint="Check your spelling or try searching for a different plate number or owner name."
          />
        ) : vehicles.length > 0 && effectiveVehicleTab === 'residents' && vehiclesLinkedToRegisteredResidents.length === 0 ? (
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
        ) : vehicles.length > 0 && effectiveVehicleTab === 'non-residents' && nonResidentVehicles.length === 0 ? (
          <div className="glass-card rounded-xl p-8 sm:p-12 text-center">
            <Car className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No non-resident vehicles yet</h3>
            <p className="text-muted-foreground mb-6 text-sm max-w-md mx-auto">
              This list shows vehicles that are not linked to a registered resident. Register a vehicle by entering an
              owner name and leaving the linked resident unset.
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
