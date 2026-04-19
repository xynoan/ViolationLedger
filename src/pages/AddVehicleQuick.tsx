import { FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Car, CheckCircle2, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { usePageTracking } from '@/hooks/usePageTracking';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { residentsAPI, vehiclesAPI } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { Resident } from '@/types/parking';
import { useDropdownOptions } from '@/hooks/useDropdownOptions';

const VEHICLE_TYPE_OTHER = 'other';

export default function AddVehicleQuick() {
  usePageTracking();
  const { options: catalog } = useDropdownOptions();
  const vehicleTypeOptions = catalog.vehicleTypes;
  const plateInputRef = useRef<HTMLInputElement | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [lastSavedPlate, setLastSavedPlate] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    plateNumber: '',
    vehicleType: 'car',
    vehicleTypeOther: '',
    residentId: '',
  });

  useEffect(() => {
    let cancelled = false;
    residentsAPI
      .getAll()
      .then((data) => {
        if (!cancelled) setResidents(data);
      })
      .catch(() => {
        if (!cancelled) {
          toast({
            title: 'Resident list unavailable',
            description: 'Could not load residents for owner selection.',
            variant: 'destructive',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resetFormForNext = () => {
    setFormData({
      plateNumber: '',
      vehicleType: 'car',
      vehicleTypeOther: '',
      residentId: '',
    });
    requestAnimationFrame(() => {
      plateInputRef.current?.focus();
      plateInputRef.current?.select();
    });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const plateNumber = formData.plateNumber.trim().toUpperCase();
    if (!plateNumber) {
      toast({
        title: 'Validation Error',
        description: 'License plate is required.',
        variant: 'destructive',
      });
      return;
    }
    if (!formData.residentId) {
      toast({
        title: 'Validation Error',
        description: 'Owner selection is required.',
        variant: 'destructive',
      });
      return;
    }
    const selectedResident = residents.find((r) => r.id === formData.residentId);
    if (!selectedResident) {
      toast({
        title: 'Validation Error',
        description: 'Please select a valid resident owner.',
        variant: 'destructive',
      });
      return;
    }
    const customVehicleType = formData.vehicleTypeOther.trim();
    const vehicleTypeValue =
      formData.vehicleType === VEHICLE_TYPE_OTHER ? customVehicleType : formData.vehicleType;
    if (!vehicleTypeValue) {
      toast({
        title: 'Validation Error',
        description: 'Please enter the vehicle type.',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    try {
      await vehiclesAPI.create({
        id: `VEH-${Date.now()}`,
        plateNumber,
        ownerName: selectedResident.name,
        contactNumber: '',
        residentId: selectedResident.id,
        dataSource: 'barangay',
        rented: null,
        vehicleType: vehicleTypeValue,
      });

      setLastSavedPlate(plateNumber);
      toast({
        title: 'Vehicle added',
        description: `${plateNumber} saved. Ready for next plate.`,
      });
      resetFormForNext();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save vehicle';
      toast({
        title: 'Save failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen">
      <Header title="Quick Add Vehicle" subtitle="Fast plate-based entry for guards" />

      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        <div className="flex items-center justify-between">
          <Button asChild variant="outline" size="sm">
            <Link to="/vehicles">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Vehicle Registry
            </Link>
          </Button>
          {lastSavedPlate ? (
            <div className="text-xs sm:text-sm text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Last saved: <span className="font-mono text-foreground">{lastSavedPlate}</span>
            </div>
          ) : null}
        </div>

        <div className="glass-card rounded-xl p-4 sm:p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="quick-plate">
                License Plate <span className="text-red-600">*</span>
              </Label>
              <Input
                id="quick-plate"
                ref={plateInputRef}
                value={formData.plateNumber}
                onChange={(e) => setFormData((prev) => ({ ...prev, plateNumber: e.target.value.toUpperCase() }))}
                placeholder="e.g. ABC 1234"
                className="bg-secondary uppercase font-mono text-base sm:text-lg"
                autoFocus
                autoCapitalize="characters"
                spellCheck={false}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="quick-owner">
                Owner (Resident) <span className="text-red-600">*</span>
              </Label>
              <Select
                value={formData.residentId}
                onValueChange={(v) => setFormData((prev) => ({ ...prev, residentId: v }))}
              >
                <SelectTrigger id="quick-owner" className="bg-secondary">
                  <SelectValue placeholder="Select resident owner" />
                </SelectTrigger>
                <SelectContent className="max-h-[280px]">
                  {residents.map((resident) => (
                    <SelectItem key={resident.id} value={resident.id}>
                      {resident.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="quick-vehicle-type">
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
                <SelectTrigger id="quick-vehicle-type" className="bg-secondary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {vehicleTypeOptions.map((opt) => (
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
                  onChange={(e) => setFormData((prev) => ({ ...prev, vehicleTypeOther: e.target.value }))}
                  className="bg-secondary"
                />
              ) : null}
            </div>

            <Button type="submit" className="w-full sm:w-auto" disabled={isSaving}>
              <Plus className="h-4 w-4 mr-2" />
              {isSaving ? 'Saving...' : 'Save and Add Next'}
            </Button>
          </form>
        </div>

        <div className="text-xs text-muted-foreground rounded-lg border border-border bg-card/60 px-3 py-2">
          This quick-entry flow stays on this page after each save and resets the form for the next plate.
        </div>
      </div>
    </div>
  );
}
