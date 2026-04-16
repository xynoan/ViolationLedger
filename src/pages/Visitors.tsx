import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Search, Edit, Trash2, Phone, Info, UserPlus } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { usePageTracking } from '@/hooks/usePageTracking';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Vehicle } from '@/types/parking';
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
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/hooks/use-toast';
import { vehiclesAPI } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { SearchNoMatchesEmpty } from '@/components/search/SearchNoMatchesEmpty';

const VEHICLE_TYPE_OPTIONS = [
  { value: 'car', label: 'Car' },
  { value: 'motorcycle', label: 'Motorcycle' },
  { value: 'truck', label: 'Truck' },
  { value: 'van', label: 'Van' },
  { value: 'suv', label: 'SUV' },
  { value: 'tricycle', label: 'Tricycle' },
  { value: 'other', label: 'Other' },
] as const;

const RENTED_OPTIONS = ['Court', 'Community Center', 'Barangay Hall'] as const;
const RENTED_NONE = '__rented_none__';

const PURPOSE_GUEST = ['Visit resident', 'Barangay hall', 'Reservation', 'Drop-off', 'Delivery'] as const;
const PURPOSE_DELIVERY = ['Delivery', 'Drop-off', 'Pickup', 'Package delivery'] as const;
const PURPOSE_RENTAL = ['Short-term rental', 'Event parking', 'Overnight stay'] as const;

type VisitorTab = 'guest' | 'delivery' | 'rental';

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

function deriveVisitorCategory(v: Vehicle): VisitorTab {
  const c = v.visitorCategory?.toLowerCase();
  if (c === 'guest' || c === 'delivery' || c === 'rental') return c;
  if (v.rented && String(v.rented).trim()) return 'rental';
  if ((v.purposeOfVisit || '').toLowerCase().includes('deliver')) return 'delivery';
  return 'guest';
}

function purposeOptionsForCategory(cat: VisitorTab): readonly string[] {
  switch (cat) {
    case 'delivery':
      return PURPOSE_DELIVERY;
    case 'rental':
      return PURPOSE_RENTAL;
    default:
      return PURPOSE_GUEST;
  }
}

export default function NonResidents() {
  usePageTracking();
  const { user } = useAuth();
  const isEncoder = user?.role === 'encoder';
  const isBarangayUser = user?.role === 'barangay_user';
  const isAdmin = user?.role === 'admin';

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<VisitorTab>('guest');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [vehicleToDelete, setVehicleToDelete] = useState<Vehicle | null>(null);
  const [isDeletingVehicle, setIsDeletingVehicle] = useState(false);
  const [formData, setFormData] = useState({
    plateNumber: '',
    ownerName: '',
    contactNumber: '',
    vehicleType: 'car' as string,
    purposeOfVisit: '',
    rented: '',
    visitorCategory: 'guest' as VisitorTab,
  });

  const loadVehicles = useCallback(async (initial = false, term = '') => {
    try {
      if (initial) setIsInitialLoading(true);
      else setIsRefreshing(true);
      const data = await vehiclesAPI.getAll(term || undefined);
      setVehicles(data);
    } catch (error) {
      console.error('Error loading vehicles:', error);
      toast({
        title: 'Error',
        description: 'Failed to load non-resident vehicles. Make sure the backend server is running.',
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

  useEffect(() => {
    if (isInitialLoading) return;
    const t = setTimeout(() => loadVehicles(false, searchTerm), 250);
    return () => clearTimeout(t);
  }, [isInitialLoading, loadVehicles, searchTerm]);

  const nonResidentVehicles = useMemo(
    () => vehicles.filter((v) => !v.residentId || String(v.residentId).trim() === ''),
    [vehicles],
  );

  const tabFiltered = useMemo(
    () => nonResidentVehicles.filter((v) => deriveVisitorCategory(v) === activeTab),
    [nonResidentVehicles, activeTab],
  );
  const categoryCounts = useMemo(
    () => ({
      guest: nonResidentVehicles.filter((v) => deriveVisitorCategory(v) === 'guest').length,
      delivery: nonResidentVehicles.filter((v) => deriveVisitorCategory(v) === 'delivery').length,
      rental: nonResidentVehicles.filter((v) => deriveVisitorCategory(v) === 'rental').length,
    }),
    [nonResidentVehicles],
  );

  const displayedRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return tabFiltered;
    return tabFiltered.filter(
      (v) =>
        v.plateNumber.toLowerCase().includes(q) || v.ownerName.toLowerCase().includes(q),
    );
  }, [tabFiltered, searchTerm]);

  const registryHasRows = nonResidentVehicles.length > 0;
  const activeCategoryLabel =
    activeTab === 'guest' ? 'Active Guests' : activeTab === 'delivery' ? 'Deliveries' : 'Short-term Rentals';

  const resetForm = (category: VisitorTab) => {
    const purposes = purposeOptionsForCategory(category);
    setFormData({
      plateNumber: '',
      ownerName: '',
      contactNumber: '',
      vehicleType: 'car',
      purposeOfVisit: purposes[0] ?? '',
      rented: '',
      visitorCategory: category,
    });
    setEditingVehicle(null);
  };

  const handleOpenDialog = (vehicle?: Vehicle) => {
    if (isBarangayUser) {
      toast({
        title: 'Permission Denied',
        description: 'Barangay users are not allowed to modify non-resident vehicles.',
        variant: 'destructive',
      });
      return;
    }
    if (vehicle && isEncoder) {
      toast({
        title: 'Permission Denied',
        description: 'Encoders can only add new non-resident vehicles, not edit existing ones.',
        variant: 'destructive',
      });
      return;
    }

    if (vehicle) {
      const cat = deriveVisitorCategory(vehicle);
      setEditingVehicle(vehicle);
      setFormData({
        plateNumber: vehicle.plateNumber.toUpperCase(),
        ownerName: vehicle.ownerName,
        contactNumber: digitsOnly(vehicle.contactNumber),
        vehicleType: vehicle.vehicleType || 'car',
        purposeOfVisit: vehicle.purposeOfVisit || purposeOptionsForCategory(cat)[0] || '',
        rented: vehicle.rented || '',
        visitorCategory: cat,
      });
    } else {
      resetForm(activeTab);
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    resetForm(activeTab);
  };

  const handleSaveVehicle = async () => {
    if (isBarangayUser) {
      toast({
        title: 'Permission Denied',
        description: 'Barangay users are not allowed to modify non-resident vehicles.',
        variant: 'destructive',
      });
      return;
    }
    const plateTrimmed = formData.plateNumber.trim();
    const ownerTrimmed = formData.ownerName.trim();
    const contactClean = digitsOnly(formData.contactNumber);
    const cat = formData.visitorCategory;

    if (!plateTrimmed || !ownerTrimmed || !formData.purposeOfVisit) {
      toast({
        title: 'Validation Error',
        description: 'Please fill in plate number, owner name, purpose of visit, and contact number',
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
    if (cat === 'rental' && !formData.rented) {
      toast({
        title: 'Validation Error',
        description: 'Select a rental location for short-term rentals',
        variant: 'destructive',
      });
      return;
    }
    const payload = {
      plateNumber: plateTrimmed.toUpperCase(),
      ownerName: ownerTrimmed,
      contactNumber: contactClean,
      residentId: null as string | null,
      rented: cat === 'rental' ? formData.rented : null,
      purposeOfVisit: formData.purposeOfVisit,
      vehicleType: formData.vehicleType,
      visitorCategory: cat,
    };

    try {
      if (editingVehicle) {
        await vehiclesAPI.update(editingVehicle.id, payload);
        toast({ title: 'Non-Resident Updated', description: 'Vehicle details updated successfully' });
      } else {
        const vehicleId = `VEH-${Date.now()}`;
        await vehiclesAPI.create({
          id: vehicleId,
          ...payload,
          dataSource: 'barangay',
        });
        toast({ title: 'Non-Resident Registered', description: 'Vehicle registered successfully' });
      }
      handleCloseDialog();
      loadVehicles();
    } catch (error: unknown) {
      toast({
        title: 'Error',
        description: errMessage(error, 'Failed to save vehicle'),
        variant: 'destructive',
      });
    }
  };

  const requestDeleteVehicle = (vehicle: Vehicle) => {
    if (isEncoder || isBarangayUser) {
      toast({
        title: 'Permission Denied',
        description: 'You do not have permission to delete non-resident vehicles.',
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
      toast({ title: 'Vehicle Removed', description: 'Non-resident vehicle removed from registry' });
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

  const purposeSelectValue = useMemo(() => {
    const opts = purposeOptionsForCategory(formData.visitorCategory);
    if (opts.includes(formData.purposeOfVisit as (typeof opts)[number])) return formData.purposeOfVisit;
    return opts[0] ?? '';
  }, [formData.purposeOfVisit, formData.visitorCategory]);

  if (isInitialLoading) {
    return (
      <div className="min-h-screen">
        <Header title="Non-Residents" subtitle="Guest, delivery, and short-term rental vehicles" />
        <div className="p-4 sm:p-6 flex items-center justify-center min-h-[50vh]">
          <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header title="Non-Residents" subtitle="Guest, delivery, and short-term rental vehicles" />

      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as VisitorTab)}
          className="w-full"
        >
          <TabsList className="flex w-full flex-wrap h-auto gap-1 sm:inline-flex sm:w-auto p-1">
            <TabsTrigger value="guest" className="flex-1 sm:flex-initial">
              Active Guests ({categoryCounts.guest})
            </TabsTrigger>
            <TabsTrigger value="delivery" className="flex-1 sm:flex-initial">
              Deliveries ({categoryCounts.delivery})
            </TabsTrigger>
            <TabsTrigger value="rental" className="flex-1 sm:flex-initial">
              Short-term Rentals ({categoryCounts.rental})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="glass-card rounded-xl p-4">
          <p className="text-sm text-muted-foreground">
            Currently viewing: <span className="font-semibold text-foreground">{activeCategoryLabel}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {tabFiltered.length} record{tabFiltered.length === 1 ? '' : 's'} in this category
          </p>
        </div>

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

          {!isBarangayUser && (
            <Dialog open={isDialogOpen} onOpenChange={(open) => (open ? handleOpenDialog() : handleCloseDialog())}>
              <DialogTrigger asChild>
                <Button className="w-full sm:w-auto bg-green-600 text-white hover:bg-green-700">
                  <Plus className="h-4 w-4 mr-2" />
                  Register Non-Resident
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border mx-4 sm:mx-auto max-w-[calc(100vw-2rem)] sm:max-w-4xl">
                <DialogHeader>
                  <DialogTitle>
                    {editingVehicle ? 'Edit Non-Resident Vehicle' : 'Register Non-Resident'}
                  </DialogTitle>
                  <DialogDescription>
                    {editingVehicle
                      ? 'Update non-resident vehicle details.'
                      : `Register a vehicle for ${activeTab === 'guest' ? 'an active guest' : activeTab === 'delivery' ? 'a delivery' : 'a short-term rental'}.`}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4 max-h-[78vh] overflow-y-auto">
                  {editingVehicle ? (
                    <div className="space-y-2">
                      <Label>Category</Label>
                      <Select
                        value={formData.visitorCategory}
                        onValueChange={(v) => {
                          const nextCat = v as VisitorTab;
                          const nextPurposes = purposeOptionsForCategory(nextCat);
                          setFormData((prev) => ({
                            ...prev,
                            visitorCategory: nextCat,
                            purposeOfVisit: nextPurposes[0] ?? prev.purposeOfVisit,
                            rented: nextCat === 'rental' ? prev.rented : '',
                          }));
                        }}
                      >
                        <SelectTrigger className="bg-secondary">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="guest">Active Guest</SelectItem>
                          <SelectItem value="delivery">Delivery</SelectItem>
                          <SelectItem value="rental">Short-term Rental</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-2">
                    <Label htmlFor="v-plate">
                      Plate Number <span className="text-red-600">*</span>
                    </Label>
                    <Input
                      id="v-plate"
                      placeholder="ABC 1234"
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
                      onValueChange={(v) => setFormData({ ...formData, vehicleType: v })}
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
                    </div>
                    <div className="space-y-2">
                    <Label htmlFor="v-owner">
                      Owner Name <span className="text-red-600">*</span>
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
                      value={formData.contactNumber}
                      onChange={(e) =>
                        setFormData({ ...formData, contactNumber: digitsOnly(e.target.value) })
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
                      onValueChange={(v) => setFormData({ ...formData, purposeOfVisit: v })}
                    >
                      <SelectTrigger id="v-purpose" className="bg-secondary">
                        <SelectValue placeholder="Select purpose" />
                      </SelectTrigger>
                      <SelectContent>
                        {purposeOptionsForCategory(formData.visitorCategory).map((opt) => (
                          <SelectItem key={opt} value={opt}>
                            {opt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    </div>
                  {formData.visitorCategory === 'rental' ? (
                    <div className="space-y-2">
                      <Label htmlFor="v-rented">
                        Rented / Location <span className="text-red-600">*</span>
                      </Label>
                      <Select
                        value={
                          formData.rented &&
                          !RENTED_OPTIONS.includes(formData.rented as (typeof RENTED_OPTIONS)[number])
                            ? formData.rented
                            : formData.rented || RENTED_NONE
                        }
                        onValueChange={(v) =>
                          setFormData((prev) => ({
                            ...prev,
                            rented: v === RENTED_NONE ? '' : v,
                          }))
                        }
                      >
                        <SelectTrigger id="v-rented" className="bg-secondary">
                          <SelectValue placeholder="Select location" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={RENTED_NONE}>Select location</SelectItem>
                          {RENTED_OPTIONS.map((opt) => (
                            <SelectItem key={opt} value={opt}>
                              {opt}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
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
                      onClick={() => void handleSaveVehicle()}
                    >
                      {editingVehicle ? 'Save Changes' : 'Register Non-Resident'}
                    </Button>
                  </DialogFooter>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {isRefreshing && <p className="text-xs text-muted-foreground">Refreshing results...</p>}

        {displayedRows.length > 0 ? (
          <>
            <div className="block sm:hidden space-y-3">
              {displayedRows.map((vehicle) => (
                <div key={vehicle.id} className="glass-card rounded-xl p-4 space-y-2">
                  <div className="font-mono font-medium text-lg">{vehicle.plateNumber}</div>
                  <div className="text-sm text-muted-foreground">{formatVehicleTypeLabel(vehicle.vehicleType)}</div>
                  <div className="text-sm font-medium">{vehicle.ownerName}</div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="h-4 w-4 shrink-0" />
                    {vehicle.contactNumber}
                  </div>
                  {vehicle.rented ? (
                    <div className="text-xs text-muted-foreground">Rental: {vehicle.rented}</div>
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
                      {activeTab === 'rental' ? (
                        <TableHead className="text-muted-foreground">Rented</TableHead>
                      ) : null}
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
                        {activeTab === 'rental' ? (
                          <TableCell className="text-muted-foreground text-sm">{vehicle.rented || '—'}</TableCell>
                        ) : null}
                        <TableCell className="text-muted-foreground text-sm">
                          {new Date(vehicle.registeredAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
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
                                  aria-label="Delete non-resident vehicle"
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

            <AlertDialog
              open={!!vehicleToDelete}
              onOpenChange={(open) => {
                if (!open) setVehicleToDelete(null);
              }}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove non-resident vehicle</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete this record?
                    {vehicleToDelete && (
                      <>
                        {' '}
                        This will permanently remove{' '}
                        <span className="font-mono font-medium text-foreground">
                          {vehicleToDelete.plateNumber}
                        </span>{' '}
                        from the non-resident registry.
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
        ) : searchTerm.trim() && registryHasRows ? (
          <SearchNoMatchesEmpty
            searchTerm={searchTerm}
            onClear={() => setSearchTerm('')}
            hint="Try a different plate or owner name."
          />
        ) : !registryHasRows ? (
          <div className="glass-card rounded-xl p-8 sm:p-12 text-center">
            <UserPlus className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No non-resident vehicles yet</h3>
            <p className="text-muted-foreground mb-6 text-sm max-w-md mx-auto">
              Register guests, deliveries, and short-term rentals here. Resident-linked vehicles stay on the Vehicles
              page.
            </p>
            {!isBarangayUser && (
              <Button className="bg-green-600 text-white hover:bg-green-700" onClick={() => handleOpenDialog()}>
                <Plus className="h-4 w-4 mr-2" />
                Register Non-Resident
              </Button>
            )}
          </div>
        ) : (
          <div className="glass-card rounded-xl p-8 sm:p-12 text-center">
            <Info className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No records in this tab</h3>
            <p className="text-muted-foreground mb-6 text-sm max-w-md mx-auto">
              Switch tabs or register a non-resident for this category.
            </p>
            {!isBarangayUser && (
              <Button className="bg-green-600 text-white hover:bg-green-700" onClick={() => handleOpenDialog()}>
                <Plus className="h-4 w-4 mr-2" />
                Register Non-Resident
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
