import { useState, useEffect, useCallback } from 'react';
import { Plus, Search, Edit, Trash2, Phone, Car, Info } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { usePageTracking } from '@/hooks/usePageTracking';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Vehicle, Host } from '@/types/parking';
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
import { toast } from '@/hooks/use-toast';
import { vehiclesAPI, hostsAPI } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

const RENTED_OPTIONS = ['Court', 'Community Center', 'Barangay Hall'] as const;
const RENTED_NONE = '__rented_none__';
const PURPOSE_OPTIONS = ['Visit resident', 'Barangay hall', 'Reservation'] as const;

const digitsOnly = (value: string) => value.replace(/\D/g, '');
const lettersAndSpacesOnly = (value: string) => value.replace(/[^a-zA-Z\s]/g, '');
const ownerNameValid = (value: string) => /^[a-zA-Z\s]+$/.test(value.trim());

export default function Vehicles() {
  usePageTracking();
  const { user } = useAuth();
  const isEncoder = user?.role === 'encoder';
   const isBarangayUser = user?.role === 'barangay_user';
   const isAdmin = user?.role === 'admin';
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
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
    contactNumber: '',
    hostId: '',
    rented: '',
    purposeOfVisit: '',
  });

  // Load vehicles from API
  const loadHosts = useCallback(async () => {
    try {
      const data = await hostsAPI.getAll();
      setHosts(data);
    } catch (error) {
      console.error('Error loading hosts:', error);
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

  // Load hosts on mount so view dialog can resolve host names
  useEffect(() => {
    loadHosts();
  }, [loadHosts]);

  const filteredVehicles = vehicles.filter(
    (v) =>
      v.plateNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      v.ownerName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const resetForm = () => {
    setFormData({ 
      plateNumber: '', 
      ownerName: '', 
      contactNumber: '',
      hostId: '',
      rented: '',
      purposeOfVisit: '',
    });
    setEditingVehicle(null);
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
      setEditingVehicle(vehicle);
      setFormData({
        plateNumber: vehicle.plateNumber.toUpperCase(),
        ownerName: vehicle.ownerName,
        contactNumber: digitsOnly(vehicle.contactNumber),
        hostId: vehicle.hostId || '',
        rented: vehicle.rented || '',
        purposeOfVisit: vehicle.purposeOfVisit || '',
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
    const contactClean = digitsOnly(formData.contactNumber);
    const contactFromHost = !!formData.hostId && !formData.rented;

    if (!plateTrimmed || !ownerTrimmed || !formData.purposeOfVisit) {
      toast({
        title: "Validation Error",
        description: "Please fill in plate number, owner name, and purpose of visit",
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

    const purposeIsAllowed =
      PURPOSE_OPTIONS.includes(formData.purposeOfVisit as (typeof PURPOSE_OPTIONS)[number]) ||
      (!!editingVehicle && formData.purposeOfVisit === editingVehicle.purposeOfVisit);
    if (!purposeIsAllowed) {
      toast({
        title: "Validation Error",
        description: "Please select a valid purpose of visit",
        variant: "destructive",
      });
      return;
    }

    if (formData.rented && !contactClean) {
      toast({
        title: "Validation Error",
        description: "Contact number is required when vehicle is rented",
        variant: "destructive",
      });
      return;
    }

    if (!contactFromHost && !contactClean) {
      toast({
        title: "Validation Error",
        description: "Contact number is required",
        variant: "destructive",
      });
      return;
    }

    const payloadBase = {
      plateNumber: plateTrimmed.toUpperCase(),
      ownerName: ownerTrimmed,
      contactNumber: contactClean,
      hostId: formData.hostId || null,
      rented: formData.rented || null,
      purposeOfVisit: formData.purposeOfVisit,
    };

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
          dataSource: 'barangay', // All vehicles are provided by Barangay
        });
        toast({
          title: "Vehicle Registered",
          description: "New vehicle registered successfully",
        });
      }
      handleCloseDialog();
      loadVehicles();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save vehicle",
        variant: "destructive",
      });
    }
  };

  const handleHostChange = (hostId: string) => {
    if (!hostId) {
      // Clear host selection - keep contact number as is
      setFormData({
        ...formData,
        hostId: '',
      });
      return;
    }
    // Find the selected host and auto-fill contact number
    const selectedHost = hosts.find(h => h.id === hostId);
    if (selectedHost) {
      setFormData({
        ...formData,
        hostId: hostId,
        contactNumber: digitsOnly(selectedHost.contactNumber),
        rented: '',
      });
    } else {
      setFormData({
        ...formData,
        hostId: hostId,
      });
    }
  };

  const getHostNameForVehicle = (vehicle: Vehicle) => {
    if (!vehicle.hostId) return null;
    const host = hosts.find((h) => h.id === vehicle.hostId);
    return host?.name || null;
  };

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
    setIsDeletingVehicle(true);
    try {
      await vehiclesAPI.delete(id);
      toast({
        title: "Vehicle Deleted",
        description: "Vehicle removed from registry",
      });
      setVehicleToDelete(null);
      loadVehicles();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete vehicle",
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
            Here's where we add non-resident vehicle details if their plate number is detected on cctv, text message will be sent to their number.
          </p>
        </div>
        {/* Actions Bar */}
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
            <Dialog open={isDialogOpen} onOpenChange={(open) => open ? handleOpenDialog() : handleCloseDialog()}>
              <DialogTrigger asChild>
                <Button className="w-full sm:w-auto">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Vehicle
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border mx-4 sm:mx-auto max-w-[calc(100vw-2rem)] sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>{editingVehicle ? 'Edit Vehicle' : 'Register New Vehicle'}</DialogTitle>
                  <DialogDescription>
                    {editingVehicle 
                      ? 'Update the vehicle information below.' 
                      : 'Enter the vehicle details to register it in the system.'}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4 max-h-[80vh] overflow-y-auto">
                  <div className="space-y-2">
                    <Label htmlFor="plateNumber">Plate Number *</Label>
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
                    <Label htmlFor="ownerName">Owner Name *</Label>
                    <Input
                      id="ownerName"
                      placeholder="Juan dela Cruz"
                      value={formData.ownerName}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          ownerName: lettersAndSpacesOnly(e.target.value),
                        })
                      }
                      className="bg-secondary"
                      inputMode="text"
                      autoComplete="name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="hostId">Host (Optional)</Label>
                    <Select 
                      value={formData.hostId || undefined} 
                      onValueChange={handleHostChange}
                    >
                      <SelectTrigger id="hostId" className="bg-secondary">
                        <SelectValue placeholder="Select a host" />
                      </SelectTrigger>
                      <SelectContent>
                        {hosts.map((host) => (
                          <SelectItem key={host.id} value={host.id}>
                            {host.name} - {host.contactNumber}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {formData.hostId && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => handleHostChange('')}
                      >
                        Clear selection
                      </Button>
                    )}
                    <p className="text-xs text-muted-foreground">
                      If selected, contact number will be automatically filled from host
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rented">Rented (Optional)</Label>
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
                      <SelectTrigger id="rented" className="bg-secondary">
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={RENTED_NONE}>None</SelectItem>
                        {RENTED_OPTIONS.map((opt) => (
                          <SelectItem key={opt} value={opt}>
                            {opt}
                          </SelectItem>
                        ))}
                        {formData.rented &&
                          !RENTED_OPTIONS.includes(formData.rented as (typeof RENTED_OPTIONS)[number]) &&
                          formData.rented !== '' && (
                            <SelectItem value={formData.rented}>{formData.rented}</SelectItem>
                          )}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      If vehicle is rented, choose the location. Contact number will be the renter&apos;s.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contactNumber">Contact Number *</Label>
                    <Input
                      id="contactNumber"
                      placeholder="09171234567"
                      value={formData.contactNumber}
                      onChange={(e) =>
                        setFormData({ ...formData, contactNumber: digitsOnly(e.target.value) })
                      }
                      className="bg-secondary"
                      inputMode="numeric"
                      autoComplete="tel"
                      disabled={!!formData.hostId && !formData.rented}
                    />
                    {formData.hostId && !formData.rented && (
                      <p className="text-xs text-muted-foreground">
                        Contact number is automatically set from selected host
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="purposeOfVisit">Purpose of Visit *</Label>
                    <Select
                      value={
                        formData.purposeOfVisit &&
                        !PURPOSE_OPTIONS.includes(formData.purposeOfVisit as (typeof PURPOSE_OPTIONS)[number])
                          ? formData.purposeOfVisit
                          : formData.purposeOfVisit || undefined
                      }
                      onValueChange={(v) => setFormData({ ...formData, purposeOfVisit: v })}
                    >
                      <SelectTrigger id="purposeOfVisit" className="bg-secondary">
                        <SelectValue placeholder="Select purpose of visit" />
                      </SelectTrigger>
                      <SelectContent>
                        {PURPOSE_OPTIONS.map((opt) => (
                          <SelectItem key={opt} value={opt}>
                            {opt}
                          </SelectItem>
                        ))}
                        {formData.purposeOfVisit &&
                          !PURPOSE_OPTIONS.includes(
                            formData.purposeOfVisit as (typeof PURPOSE_OPTIONS)[number],
                          ) && (
                            <SelectItem value={formData.purposeOfVisit}>
                              {formData.purposeOfVisit}
                            </SelectItem>
                          )}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Required for all vehicles entering the barangay
                    </p>
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
                      onClick={handleSaveVehicle}
                    >
                      {editingVehicle ? 'Save Changes' : 'Register Vehicle'}
                    </Button>
                  </DialogFooter>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
        {isRefreshing && (
          <p className="text-xs text-muted-foreground">Refreshing results...</p>
        )}

        {vehicles.length > 0 ? (
          <>
            {/* Mobile Cards */}
            <div className="block sm:hidden space-y-3">
              {filteredVehicles.map((vehicle) => (
                <div key={vehicle.id} className="glass-card rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-medium text-lg">{vehicle.plateNumber}</span>
                    {!isEncoder && isAdmin && (
                      <div className="flex items-center gap-1">
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
                  <div className="text-sm text-foreground">{vehicle.ownerName}</div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="h-4 w-4" />
                    {vehicle.contactNumber}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Registered: {new Date(vehicle.registeredAt).toLocaleDateString()}
                  </div>
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
                      <TableHead className="text-muted-foreground">Name</TableHead>
                      <TableHead className="text-muted-foreground">Contact</TableHead>
                      <TableHead className="text-muted-foreground">Registered</TableHead>
                      <TableHead className="text-muted-foreground text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredVehicles.map((vehicle) => (
                      <TableRow key={vehicle.id} className="border-border">
                        <TableCell className="font-mono font-medium">{vehicle.plateNumber}</TableCell>
                        <TableCell>{vehicle.ownerName}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Phone className="h-4 w-4" />
                            {vehicle.contactNumber}
                          </div>
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
                              aria-label="View details"
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
                  <DialogTitle>Vehicle Details</DialogTitle>
                  <DialogDescription>
                    {selectedVehicle ? `Full information for ${selectedVehicle.plateNumber}` : 'Full vehicle information'}
                  </DialogDescription>
                </DialogHeader>
                {selectedVehicle && (
                  <div className="space-y-4 py-2 text-sm">
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Plate Number</p>
                      <p className="font-mono font-medium">{selectedVehicle.plateNumber}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Owner Name</p>
                      <p className="font-medium">{selectedVehicle.ownerName}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Contact Number</p>
                      <p>{selectedVehicle.contactNumber}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Purpose of Visit</p>
                      <p>{selectedVehicle.purposeOfVisit || '—'}</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">Host</p>
                        <p>{getHostNameForVehicle(selectedVehicle) || 'None'}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">Rented</p>
                        <p>{selectedVehicle.rented || 'No'}</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Registered</p>
                      <p>{new Date(selectedVehicle.registeredAt).toLocaleString()}</p>
                    </div>
                  </div>
                )}
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
