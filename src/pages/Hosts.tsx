import { useState, useEffect } from 'react';
import { Plus, Search, Edit, Trash2, Phone, Home, MapPin } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { usePageTracking } from '@/hooks/usePageTracking';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Host } from '@/types/parking';
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
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { hostsAPI } from '@/lib/api';

export default function Hosts() {
  usePageTracking();
  const [hosts, setHosts] = useState<Host[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingHost, setEditingHost] = useState<Host | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    contactNumber: '',
    address: '',
  });

  // Load hosts from API
  useEffect(() => {
    loadHosts();
  }, [searchTerm]);

  const loadHosts = async () => {
    try {
      setIsLoading(true);
      const data = await hostsAPI.getAll(searchTerm || undefined);
      setHosts(data);
    } catch (error) {
      console.error('Error loading hosts:', error);
      toast({
        title: "Error",
        description: "Failed to load hosts. Make sure the backend server is running.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const filteredHosts = hosts.filter(
    (h) =>
      h.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      h.contactNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (h.address && h.address.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const resetForm = () => {
    setFormData({ name: '', contactNumber: '', address: '' });
    setEditingHost(null);
  };

  const handleOpenDialog = (host?: Host) => {
    if (host) {
      setEditingHost(host);
      setFormData({
        name: host.name,
        contactNumber: host.contactNumber,
        address: host.address || '',
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

  const handleSaveHost = async () => {
    if (!formData.name || !formData.contactNumber) {
      toast({
        title: "Validation Error",
        description: "Please fill in name and contact number",
        variant: "destructive",
      });
      return;
    }

    try {
      if (editingHost) {
        await hostsAPI.update(editingHost.id, formData);
        toast({
          title: "Host Updated",
          description: "Host details updated successfully",
        });
      } else {
        const hostId = `HOST-${Date.now()}`;
        await hostsAPI.create({
          id: hostId,
          ...formData,
        });
        toast({
          title: "Host Added",
          description: "New host added successfully",
        });
      }
      handleCloseDialog();
      loadHosts();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save host",
        variant: "destructive",
      });
    }
  };

  const handleDeleteHost = async (id: string) => {
    try {
      await hostsAPI.delete(id);
      toast({
        title: "Host Deleted",
        description: "Host removed from registry",
      });
      loadHosts();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete host",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen">
      <Header 
        title="Hosts Registry" 
        subtitle="Manage registered hosts"
      />

      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* Actions Bar */}
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

          <Dialog open={isDialogOpen} onOpenChange={(open) => open ? handleOpenDialog() : handleCloseDialog()}>
            <DialogTrigger asChild>
              <Button className="w-full sm:w-auto">
                <Plus className="h-4 w-4 mr-2" />
                Add Host
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border mx-4 sm:mx-auto max-w-[calc(100vw-2rem)] sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>{editingHost ? 'Edit Host' : 'Add New Host'}</DialogTitle>
                <DialogDescription>
                  {editingHost 
                    ? 'Update the host information below.' 
                    : 'Enter the host details to add them to the system.'}
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
                <Button onClick={handleSaveHost} className="w-full">
                  {editingHost ? 'Save Changes' : 'Add Host'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {hosts.length > 0 ? (
          <>
            {/* Mobile Cards */}
            <div className="block sm:hidden space-y-3">
              {filteredHosts.map((host) => (
                <div key={host.id} className="glass-card rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-lg">{host.name}</span>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(host)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon"
                        onClick={() => handleDeleteHost(host.id)}
                        className="text-destructive hover:text-destructive h-8 w-8"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="h-4 w-4" />
                    {host.contactNumber}
                  </div>
                  {host.address && (
                    <div className="flex items-start gap-2 text-sm text-muted-foreground">
                      <MapPin className="h-4 w-4 mt-0.5" />
                      <span>{host.address}</span>
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
                      <TableHead className="text-muted-foreground">Name</TableHead>
                      <TableHead className="text-muted-foreground">Contact</TableHead>
                      <TableHead className="text-muted-foreground">Address</TableHead>
                      <TableHead className="text-muted-foreground text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredHosts.map((host) => (
                      <TableRow key={host.id} className="border-border">
                        <TableCell className="font-semibold">{host.name}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Phone className="h-4 w-4" />
                            {host.contactNumber}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {host.address || '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(host)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon"
                              onClick={() => handleDeleteHost(host.id)}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
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
            <Home className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No Hosts Registered</h3>
            <p className="text-muted-foreground mb-6">
              Add your first host to the registry
            </p>
            <Button onClick={() => handleOpenDialog()}>
              <Plus className="h-4 w-4 mr-2" />
              Add Your First Host
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}


