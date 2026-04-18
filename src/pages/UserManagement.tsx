import { useState, useEffect } from 'react';
import { Users, Plus, Edit, Trash2, Shield, User, RefreshCw, Eye, EyeOff, CheckCircle2, XCircle } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { usePageTracking } from '@/hooks/usePageTracking';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
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
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { usersAPI } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { trackAction } from '@/lib/auditTracking';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { isValidEmail, sanitizeEmail } from '@/lib/emailValidation';

const digitsOnly = (value: string) => value.replace(/\D/g, '');
const lettersAndSpacesOnly = (value: string) => value.replace(/[^a-zA-Z\s]/g, '');

interface User {
  id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'barangay_user' | 'encoder';
  contactNumber: string | null;
  status: 'active' | 'inactive';
  createdAt: string;
}

export default function UserManagement() {
  usePageTracking();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isStatusDialogOpen, setIsStatusDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [statusDialogUser, setStatusDialogUser] = useState<User | null>(null);
  const [statusDialogNextStatus, setStatusDialogNextStatus] = useState<'active' | 'inactive' | null>(null);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    name: '',
    role: 'encoder' as 'admin' | 'barangay_user' | 'encoder',
    contactNumber: '',
    status: 'active' as 'active' | 'inactive',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      setIsLoading(true);
      const data = await usersAPI.getAll();
      setUsers(data);
    } catch (error: any) {
      console.error('Error loading users:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to load users",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenDialog = (user?: User) => {
    if (user) {
      trackAction('button_click', 'user', user.id, { action: 'edit_user', email: user.email });
      setSelectedUser(user);
      setFormData({
        email: user.email,
        password: '',
        confirmPassword: '',
        name: user.name || '',
        role: user.role,
        contactNumber: user.contactNumber || '',
        status: user.status || 'active',
      });
    } else {
      trackAction('button_click', 'user', null, { action: 'add_user' });
      setSelectedUser(null);
      setFormData({
        email: '',
        password: '',
        confirmPassword: '',
        name: '',
        role: 'encoder',
        contactNumber: '',
        status: 'active',
      });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setSelectedUser(null);
    setFormData({
      email: '',
      password: '',
      confirmPassword: '',
      name: '',
      role: 'encoder',
      contactNumber: '',
      status: 'active',
    });
  };

  const emailTrimmed = formData.email.trim();
  const emailInvalid =
    emailTrimmed.length > 0 && !isValidEmail(emailTrimmed);
  const emailOk = emailTrimmed.length > 0 && isValidEmail(emailTrimmed);

  const handleSubmit = async () => {
    if (!emailTrimmed) {
      toast({
        title: "Validation Error",
        description: "Email is required",
        variant: "destructive",
      });
      return;
    }

    if (!isValidEmail(emailTrimmed)) {
      toast({
        title: "Validation Error",
        description: "Please enter a valid email address.",
        variant: "destructive",
      });
      return;
    }

    if (!formData.name.trim()) {
      toast({
        title: "Validation Error",
        description: "Name is required",
        variant: "destructive",
      });
      return;
    }

    if (!selectedUser && !formData.password) {
      toast({
        title: "Validation Error",
        description: "Password is required for new users",
        variant: "destructive",
      });
      return;
    }

    const hasPassword = !!formData.password && formData.password.length > 0;
    if (hasPassword) {
      const password = formData.password;
      const passwordErrors: string[] = [];

      if (password.length < 8) {
        passwordErrors.push("at least 8 characters");
      }
      if (!/[A-Z]/.test(password)) {
        passwordErrors.push("one uppercase letter");
      }
      if (!/[a-z]/.test(password)) {
        passwordErrors.push("one lowercase letter");
      }
      if (!/[0-9]/.test(password)) {
        passwordErrors.push("one number");
      }
      if (!/[!@#$%^&*(),.?":{}|<>_\-]/.test(password)) {
        passwordErrors.push("one special character");
      }

      if (passwordErrors.length > 0) {
        toast({
          title: "Password does not meet requirements",
          description: `Password must contain ${passwordErrors.join(', ')}.`,
          variant: "destructive",
        });
        return;
      }
    }

    if (formData.password && formData.password !== formData.confirmPassword) {
      toast({
        title: "Validation Error",
        description: "Password and Confirm Password do not match",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsSubmitting(true);
      const emailForApi = sanitizeEmail(formData.email);
      if (selectedUser) {
        // Update existing user
        const updateData: any = {
          email: emailForApi,
          name: formData.name.trim(),
          role: formData.role,
          contactNumber: formData.contactNumber.trim() || null,
          status: formData.status,
        };
        if (formData.password) {
          updateData.password = formData.password;
        }
        await usersAPI.update(selectedUser.id, updateData);
        toast({
          title: "Success",
          description: "User updated successfully",
        });
      } else {
        // Create new user - store to database via API
        const role = formData.role === 'admin' ? 'encoder' : formData.role;
        const created = await usersAPI.create({
          email: emailForApi,
          password: formData.password,
          name: formData.name.trim(),
          role,
          contactNumber: formData.contactNumber.trim() || undefined,
          status: formData.status,
        });
        toast({
          title: "Success",
          description:
            (created && typeof created === 'object' && 'message' in created && (created as { message?: string }).message) ||
            'Account created. Please check your email to activate your account.',
        });
      }
      handleCloseDialog();
      loadUsers();
    } catch (error: any) {
      console.error('Error saving user:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to save user",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const openStatusDialog = (user: User) => {
    if (user.id === currentUser?.id) return;
    const nextStatus: 'active' | 'inactive' = user.status === 'active' ? 'inactive' : 'active';
    setStatusDialogUser(user);
    setStatusDialogNextStatus(nextStatus);
    setIsStatusDialogOpen(true);
  };

  const handleConfirmStatusChange = async () => {
    if (!statusDialogUser || !statusDialogNextStatus) return;

    try {
      await usersAPI.update(statusDialogUser.id, { status: statusDialogNextStatus });
      toast({
        title: "Success",
        description: `User ${statusDialogNextStatus === 'active' ? 'activated' : 'deactivated'} successfully`,
      });
      setIsStatusDialogOpen(false);
      setStatusDialogUser(null);
      setStatusDialogNextStatus(null);
      loadUsers();
    } catch (error: any) {
      console.error('Error updating user status:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to update user status",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    if (!selectedUser) return;

    try {
      await trackAction('button_click', 'user', selectedUser.id, { action: 'delete_user', email: selectedUser.email });
      await usersAPI.delete(selectedUser.id);
      toast({
        title: "Success",
        description: "User deleted successfully",
      });
      setIsDeleteDialogOpen(false);
      setSelectedUser(null);
      loadUsers();
    } catch (error: any) {
      console.error('Error deleting user:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete user",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <Header title="User Management" subtitle="Manage system users and permissions" />
        <div className="p-6 flex items-center justify-center">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header
        title="User Management"
        subtitle="Manage system users and permissions"
        action={
          <Button onClick={() => handleOpenDialog()} disabled={isLoading}>
            <Plus className="h-4 w-4 mr-2" />
            Add User
          </Button>
        }
      />

      <div className="p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
            <CardDescription>All registered users in the system</CardDescription>
          </CardHeader>
          <CardContent>
            {users.length === 0 ? (
              <div className="text-center py-8">
                <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No users found</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">
                        {user.name || user.email.split('@')[0]}
                      </TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>
                        <Badge variant={user.role === 'admin' ? 'default' : user.role === 'encoder' ? 'outline' : 'secondary'}>
                          {user.role === 'admin' ? (
                            <>
                              <Shield className="h-3 w-3 mr-1" />
                              Admin
                            </>
                          ) : user.role === 'encoder' ? (
                            <>
                              <User className="h-3 w-3 mr-1" />
                              Encoder
                            </>
                          ) : (
                            <>
                              <User className="h-3 w-3 mr-1" />
                              Barangay User
                            </>
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.status === 'active' ? 'default' : 'secondary'}>
                          {user.status === 'active' ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {new Date(user.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenDialog(user)}
                            disabled={user.id === currentUser?.id}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openStatusDialog(user)}
                            disabled={user.id === currentUser?.id}
                            className={
                              user.status === 'active'
                                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                                : 'bg-emerald-600 text-white hover:bg-emerald-700'
                            }
                          >
                            {user.status === 'active' ? 'Deactivate' : 'Activate'}
                          </Button>
                          {/* Permanent delete: uncomment to show Delete button (removes user from DB) */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedUser(user);
                              setIsDeleteDialogOpen(true);
                            }}
                            disabled={user.id === currentUser?.id}
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
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add/Edit User Dialog */}
      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          if (!open) handleCloseDialog();
          else setIsDialogOpen(open);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedUser ? 'Edit User' : 'Add New User'}</DialogTitle>
            <DialogDescription>
              {selectedUser ? 'Update user information' : 'Create a new user account'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="email">
                Email <span className="text-destructive">*</span>
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="user@example.com"
                disabled={isSubmitting}
                aria-invalid={emailInvalid}
                aria-describedby={emailInvalid ? 'email-error' : undefined}
                className={cn(
                  emailInvalid &&
                    'border-destructive focus-visible:ring-destructive/40 focus-visible:border-destructive'
                )}
              />
              {emailInvalid && (
                <p id="email-error" className="text-xs text-destructive" role="alert">
                  Please enter a valid email address.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">
                Password {selectedUser && '(leave blank to keep current)'}
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="Enter password"
                  disabled={isSubmitting}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  className={cn(
                    'absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded'
                  )}
                  tabIndex={0}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {formData.password && (
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <div className="font-medium">Password must contain:</div>
                  <div className="grid gap-1 sm:grid-cols-2">
                    <span className="flex items-center gap-1">
                      {formData.password.length >= 8 ? (
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <XCircle className="h-3 w-3 text-destructive" />
                      )}
                      <span>At least 8 characters</span>
                    </span>
                    <span className="flex items-center gap-1">
                      {/[A-Z]/.test(formData.password) ? (
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <XCircle className="h-3 w-3 text-destructive" />
                      )}
                      <span>One uppercase letter (A-Z)</span>
                    </span>
                    <span className="flex items-center gap-1">
                      {/[a-z]/.test(formData.password) ? (
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <XCircle className="h-3 w-3 text-destructive" />
                      )}
                      <span>One lowercase letter (a-z)</span>
                    </span>
                    <span className="flex items-center gap-1">
                      {/[0-9]/.test(formData.password) ? (
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <XCircle className="h-3 w-3 text-destructive" />
                      )}
                      <span>One number (0-9)</span>
                    </span>
                    <span className="flex items-center gap-1 sm:col-span-2">
                      {/[!@#$%^&*(),.?":{}|<>_\-]/.test(formData.password) ? (
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <XCircle className="h-3 w-3 text-destructive" />
                      )}
                      <span>One special character (!@#$%^&amp;* etc.)</span>
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                placeholder="Re-enter password"
                disabled={isSubmitting}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: lettersAndSpacesOnly(e.target.value) })}
                placeholder="User's full name"
                disabled={isSubmitting}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="contactNumber">Contact Number for 2FA</Label>
              <Input
                id="contactNumber"
                type="tel"
                maxLength={11}
                value={formData.contactNumber}
                onChange={(e) => setFormData({ ...formData, contactNumber: digitsOnly(e.target.value).slice(0, 11) })}
                placeholder="09123456789"
                disabled={isSubmitting}
                inputMode="numeric"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              {selectedUser ? (
                <>
                  <Input
                    id="role"
                    value={selectedUser.role === 'admin' ? 'Admin' : selectedUser.role === 'encoder' ? 'Encoder' : 'Barangay User'}
                    disabled
                    className="bg-secondary"
                  />
                  <p className="text-xs text-muted-foreground">
                    Role cannot be changed when editing.
                  </p>
                </>
              ) : (
                <>
                  <Select
                    value={formData.role === 'admin' ? 'encoder' : formData.role}
                    onValueChange={(value: 'encoder' | 'barangay_user') => setFormData((prev) => ({ ...prev, role: value }))}
                    disabled={isSubmitting}
                  >
                    <SelectTrigger id="role">
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="encoder">Encoder</SelectItem>
                      <SelectItem value="barangay_user">Barangay User</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Encoders can add vehicles. Barangay users manage violations and receive system notifications.
                  </p>
                </>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Account Status</Label>
              <Select
                value={formData.status}
                onValueChange={(value: 'active' | 'inactive') =>
                  setFormData((prev) => ({ ...prev, status: value }))
                }
                disabled={isSubmitting}
              >
                <SelectTrigger id="status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* Contact number is used for 2FA and notification SMS */}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting || !emailOk}>
              {isSubmitting ? 'Saving...' : selectedUser ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete user</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete "{selectedUser?.email}"? This will remove the user and their preferences from the system. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Activate/Deactivate Confirmation Dialog */}
      <AlertDialog open={isStatusDialogOpen} onOpenChange={setIsStatusDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {statusDialogNextStatus === 'inactive' ? 'Deactivate User' : 'Activate User'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {statusDialogNextStatus === 'inactive'
                ? `Are you sure you want to deactivate "${statusDialogUser?.email}"? They will no longer be able to log in, but their history and audit logs will be preserved.`
                : `Are you sure you want to activate "${statusDialogUser?.email}" and allow them to log in again?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setIsStatusDialogOpen(false);
                setStatusDialogUser(null);
                setStatusDialogNextStatus(null);
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmStatusChange}>
              {statusDialogNextStatus === 'inactive' ? 'Deactivate' : 'Activate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

