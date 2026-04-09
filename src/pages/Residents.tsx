import { useState, useEffect, useCallback } from 'react';
import { Plus, Search, Edit, Trash2, Phone, Home, MapPin, Info } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { usePageTracking } from '@/hooks/usePageTracking';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Resident } from '@/types/parking';
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
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { residentsAPI } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

export default function Residents() {
  usePageTracking();
  const { user } = useAuth();
  const isBarangayUser = user?.role === 'barangay_user';
  const [residents, setResidents] = useState<Resident[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingResident, setEditingResident] = useState<Resident | null>(null);
  const [residentToDelete, setResidentToDelete] = useState<Resident | null>(null);
  const [isDeletingResident, setIsDeletingResident] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    contactNumber: '',
    address: '',
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
        title: "Error",
        description: "Failed to load residents. Make sure the backend server is running.",
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
    loadResidents(true);
  }, [loadResidents]);

  useEffect(() => {
    if (isInitialLoading) return;
    const timeout = setTimeout(() => {
      loadResidents(false, searchTerm);
    }, 250);
    return () => clearTimeout(timeout);
  }, [isInitialLoading, loadResidents, searchTerm]);

  const filteredResidents = residents.filter(
    (r) =>
      r.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.contactNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (r.address && r.address.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const resetForm = () => {
    setFormData({ name: '', contactNumber: '', address: '' });
    setEditingResident(null);
  };

  const handleOpenDialog = (resident?: Resident) => {
    if (isBarangayUser) {
      toast({
        title: "Permission Denied",
        description: "Barangay users are not allowed to modify residents.",
        variant: "destructive",
      });
      return;
    }
    if (resident) {
      setEditingResident(resident);
      setFormData({
        name: resident.name,
        contactNumber: resident.contactNumber,
        address: resident.address || '',
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
        title: "Permission Denied",
        description: "Barangay users are not allowed to modify residents.",
        variant: "destructive",
      });
      return;
    }
    if (!formData.name || !formData.contactNumber) {
      toast({
        title: "Validation Error",
        description: "Please fill in name and contact number",
        variant: "destructive",
      });
      return;
    }

    try {
      if (editingResident) {
        await residentsAPI.update(editingResident.id, formData);
        toast({
          title: "Resident Updated",
          description: "Resident details updated successfully",
        });
      } else {
        const residentId = `RESIDENT-${Date.now()}`;
        await residentsAPI.create({
          id: residentId,
          ...formData,
        });
        toast({
          title: "Resident Added",
          description: "New resident added successfully",
        });
      }
      handleCloseDialog();
      loadResidents();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save resident",
        variant: "destructive",
      });
    }
  };

  const requestDeleteResident = (resident: Resident) => {
    if (isBarangayUser) {
      toast({
        title: "Permission Denied",
        description: "Barangay users are not allowed to modify residents.",
        variant: "destructive",
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
        title: "Resident Deleted",
        description: "Resident removed from registry",
      });
      setResidentToDelete(null);
      loadResidents();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete resident",
        variant: "destructive",
      });
    } finally {
      setIsDeletingResident(false);
    }
  };

  const deleteButtonClassName =
    'h-8 w-8 border-red-600 text-red-600 hover:bg-red-600/15 hover:text-red-700 dark:hover:bg-red-600/20';

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
      <Header 
        title="Residents Registry" 
        subtitle="Manage registered residents"
      />

      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        <div className="flex items-start gap-2 rounded-lg border border-border bg-card/70 px-3 py-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 text-primary" />
          <p className="leading-relaxed">
            Residents listed here are the contacts who receive a text message when a visitor (non-resident) parks illegally.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4">
          <div className="relative flex-1 sm:max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, contact, or address..."
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
                  <div className="space-y-2">
                    <Label htmlFor="address">Address</Label>
                    <Textarea
                      id="address"
                      placeholder="Street, Barangay, City"
                      value={formData.address}
                      onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                      className="bg-secondary"
                      rows={3}
                    />
                  </div>
                  <Button onClick={handleSaveResident} className="w-full">
                    {editingResident ? 'Save Changes' : 'Add Resident'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
        {isRefreshing && (
          <p className="text-xs text-muted-foreground">Refreshing results...</p>
        )}

        {residents.length > 0 ? (
          <>
            <div className="block sm:hidden space-y-3">
              {filteredResidents.map((resident) => (
                <div key={resident.id} className="glass-card rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-lg">{resident.name}</span>
                    {!isBarangayUser && (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(resident)}>
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
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="h-4 w-4" />
                    {resident.contactNumber}
                  </div>
                  {resident.address && (
                    <div className="flex items-start gap-2 text-sm text-muted-foreground">
                      <MapPin className="h-4 w-4 mt-0.5" />
                      <span>{resident.address}</span>
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
                      <TableHead className="text-muted-foreground">Name</TableHead>
                      <TableHead className="text-muted-foreground">Contact</TableHead>
                      <TableHead className="text-muted-foreground">Address</TableHead>
                      <TableHead className="text-muted-foreground text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredResidents.map((resident) => (
                      <TableRow key={resident.id} className="border-border">
                        <TableCell className="font-semibold">{resident.name}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Phone className="h-4 w-4" />
                            {resident.contactNumber}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {resident.address || '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          {!isBarangayUser && (
                            <div className="flex items-center justify-end gap-2">
                              <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(resident)}>
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
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

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
                        <span className="font-semibold text-foreground">{residentToDelete.name}</span>{' '}
                        from the registry.
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
        ) : (
          <div className="glass-card rounded-xl p-8 sm:p-12 text-center">
            <Home className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No Residents Registered</h3>
            <p className="text-muted-foreground mb-6">
              Add your first resident to the registry
            </p>
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

