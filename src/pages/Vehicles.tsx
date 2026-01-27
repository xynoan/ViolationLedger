import { useState, useEffect } from 'react';
import { Plus, Search, Edit, Trash2, Phone, Car } from 'lucide-react';
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { vehiclesAPI, hostsAPI } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

export default function Vehicles() {
  usePageTracking();
  const { user } = useAuth();
  const isEncoder = user?.role === 'encoder';
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [formData, setFormData] = useState({
    plateNumber: '',
    ownerName: '',
    contactNumber: '',
    hostId: '',
    rented: '',
    purposeOfVisit: '',
  });

  // Load vehicles from API
  useEffect(() => {
    loadVehicles();
  }, [searchTerm]);

  // Load hosts when dialog opens
  useEffect(() => {
    if (isDialogOpen) {
      loadHosts();
    }
  }, [isDialogOpen]);

  const loadHosts = async () => {
    try {
      const data = await hostsAPI.getAll();
      setHosts(data);
    } catch (error) {
      console.error('Error loading hosts:', error);
    }
  };

  const loadVehicles = async () => {
    try {
      setIsLoading(true);
      const data = await vehiclesAPI.getAll(searchTerm || undefined);
      setVehicles(data);
    } catch (error) {
      console.error('Error loading vehicles:', error);
      toast({
        title: "Error",
        description: "Failed to load vehicles. Make sure the backend server is running.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

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
        plateNumber: vehicle.plateNumber,
        ownerName: vehicle.ownerName,
        contactNumber: vehicle.contactNumber,
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
    if (!formData.plateNumber || !formData.ownerName || !formData.purposeOfVisit) {
      toast({
        title: "Validation Error",
        description: "Please fill in plate number, owner name, and purpose of visit",
        variant: "destructive",
      });
      return;
    }

    // If host is selected and not rented, contact number will be fetched from host
    // If rented, contact number is required
    if (formData.rented && !formData.contactNumber) {
      toast({
        title: "Validation Error",
        description: "Contact number is required when vehicle is rented",
        variant: "destructive",
      });
      return;
    }

    try {
      if (editingVehicle) {
        await vehiclesAPI.update(editingVehicle.id, {
          ...formData,
          hostId: formData.hostId || null,
          rented: formData.rented || null,
        });
        toast({
          title: "Vehicle Updated",
          description: "Vehicle details updated successfully",
        });
      } else {
        const vehicleId = `VEH-${Date.now()}`;
        await vehiclesAPI.create({
          id: vehicleId,
          ...formData,
          hostId: formData.hostId || null,
          rented: formData.rented || null,
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
        contactNumber: selectedHost.contactNumber, // Automatically fill contact number from host
        rented: '', // Clear rented field when host is selected
      });
    } else {
      setFormData({
        ...formData,
        hostId: hostId,
      });
    }
  };

  const handleDeleteVehicle = async (id: string) => {
    // Encoders cannot delete vehicles
    if (isEncoder) {
      toast({
        title: "Permission Denied",
        description: "Encoders can only add new vehicles, not delete existing ones.",
        variant: "destructive",
      });
      return;
    }
    
    try {
      await vehiclesAPI.delete(id);
      toast({
        title: "Vehicle Deleted",
        description: "Vehicle removed from registry",
      });
      loadVehicles();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete vehicle",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen">
      <Header 
        title="Vehicle Registry" 
        subtitle="Manage registered vehicles"
      />

      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
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
                    onChange={(e) => setFormData({ ...formData, plateNumber: e.target.value })}
                    className="bg-secondary"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ownerName">Owner Name *</Label>
                  <Input
                    id="ownerName"
                    placeholder="Juan dela Cruz"
                    value={formData.ownerName}
                    onChange={(e) => setFormData({ ...formData, ownerName: e.target.value })}
                    className="bg-secondary"
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
                  <Input
                    id="rented"
                    placeholder="Court, etc."
                    value={formData.rented}
                    onChange={(e) => {
                      const rentedValue = e.target.value;
                      setFormData({ 
                        ...formData, 
                        rented: rentedValue,
                        hostId: rentedValue ? '' : formData.hostId, // Clear host if rented is filled
                      });
                    }}
                    className="bg-secondary"
                  />
                  <p className="text-xs text-muted-foreground">
                    If vehicle is rented, enter the location (e.g., Court). Contact number will be the renter's.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactNumber">Contact Number *</Label>
                  <Input
                    id="contactNumber"
                    placeholder="+639171234567"
                    value={formData.contactNumber}
                    onChange={(e) => setFormData({ ...formData, contactNumber: e.target.value })}
                    className="bg-secondary"
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
                  <Input
                    id="purposeOfVisit"
                    placeholder="e.g., Delivery, Appointment with Kap, Visit resident"
                    value={formData.purposeOfVisit}
                    onChange={(e) => setFormData({ ...formData, purposeOfVisit: e.target.value })}
                    className="bg-secondary"
                  />
                  <p className="text-xs text-muted-foreground">
                    Required for all vehicles entering the barangay
                  </p>
                </div>
                <Button onClick={handleSaveVehicle} className="w-full">
                  {editingVehicle ? 'Save Changes' : 'Register Vehicle'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {vehicles.length > 0 ? (
          <>
            {/* Mobile Cards */}
            <div className="block sm:hidden space-y-3">
              {filteredVehicles.map((vehicle) => (
                <div key={vehicle.id} className="glass-card rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-medium text-lg">{vehicle.plateNumber}</span>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(vehicle)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon"
                        onClick={() => handleDeleteVehicle(vehicle.id)}
                        className="text-destructive hover:text-destructive h-8 w-8"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
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
                      <TableHead className="text-muted-foreground">Owner</TableHead>
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
                          {!isEncoder && (
                            <div className="flex items-center justify-end gap-2">
                              <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(vehicle)}>
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon"
                                onClick={() => handleDeleteVehicle(vehicle.id)}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </>
        ) : (
          <div className="glass-card rounded-xl p-8 sm:p-12 text-center">
            <Car className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No Vehicles Registered</h3>
            <p className="text-muted-foreground mb-6">
              Add your first vehicle to the registry
            </p>
            <Button onClick={() => handleOpenDialog()}>
              <Plus className="h-4 w-4 mr-2" />
              Add Your First Vehicle
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
