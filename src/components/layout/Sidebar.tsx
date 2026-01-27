import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Car, 
  Camera, 
  AlertTriangle, 
  FileText,
  History,
  Upload,
  Settings,
  BarChart3,
  Users,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  Home
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useAuth } from '@/hooks/useAuth';

const navItems = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard', adminOnly: false },
  { path: '/vehicles', icon: Car, label: 'Vehicles', adminOnly: false },
  { path: '/hosts', icon: Home, label: 'Hosts', adminOnly: false },
  { path: '/cameras', icon: Camera, label: 'Cameras', adminOnly: false },
  { path: '/upload', icon: Upload, label: 'Upload Image', adminOnly: false },
  { path: '/warnings', icon: AlertTriangle, label: 'Warnings', adminOnly: false },
  { path: '/tickets', icon: FileText, label: 'Capture Results', adminOnly: false },
  { path: '/violations', icon: History, label: 'Violations History', adminOnly: false },
  { path: '/analytics', icon: BarChart3, label: 'Analytics', adminOnly: false },
  { path: '/users', icon: Users, label: 'User Management', adminOnly: true },
  { path: '/audit-logs', icon: ClipboardList, label: 'Audit Logs', adminOnly: true },
  { path: '/settings', icon: Settings, label: 'Settings', adminOnly: false },
];

function NavContent({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const location = useLocation();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isEncoder = user?.role === 'encoder';

  // Encoders can only see Vehicles page
  const filteredItems = navItems.filter(item => {
    if (isEncoder) {
      return item.path === '/vehicles';
    }
    return !item.adminOnly || isAdmin;
  });

  return (
    <nav className="flex-1 space-y-1 p-3">
      {filteredItems.map((item) => {
        const isActive = location.pathname === item.path;
        return (
          <Link
            key={item.path}
            to={item.path}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
              isActive 
                ? "bg-primary/10 text-primary" 
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <item.icon className={cn("h-5 w-5 shrink-0", isActive && "text-primary")} />
            {!collapsed && <span>{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

// Mobile sidebar using Sheet
export function MobileSidebar() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden fixed top-4 left-4 z-50">
          <Menu className="h-6 w-6" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-64 p-0 bg-card border-border">
        <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
        <SheetDescription className="sr-only">
          Main navigation menu for ViolationLedger application
        </SheetDescription>
        <div className="flex h-full flex-col">
          {/* Logo */}
          <div className="flex h-16 items-center justify-between border-b border-border px-4">
            <div className="flex items-center gap-2">
              <img src="/logo.png" alt="ViolationLedger" className="h-8 w-8" />
              <span className="font-semibold text-lg">ViolationLedger</span>
            </div>
          </div>

          <NavContent onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Desktop sidebar
export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      {/* Mobile Sidebar */}
      <MobileSidebar />

      {/* Desktop Sidebar */}
      <aside 
        className={cn(
          "fixed left-0 top-0 z-40 h-screen bg-card border-r border-border transition-all duration-300 hidden lg:block",
          collapsed ? "w-16" : "w-64"
        )}
      >
        <div className="flex h-full flex-col">
          {/* Logo */}
          <div className="flex h-16 items-center justify-between border-b border-border px-4">
            {!collapsed && (
              <div className="flex items-center gap-2">
                <img src="/logo.png" alt="ViolationLedger" className="h-8 w-8" />
                <span className="font-semibold text-lg">ViolationLedger</span>
              </div>
            )}
            {collapsed && <img src="/logo.png" alt="ViolationLedger" className="h-8 w-8 mx-auto" />}
          </div>

          <NavContent collapsed={collapsed} />

          {/* Collapse Toggle */}
          <div className="border-t border-border p-3">
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              {collapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
              {!collapsed && <span>Collapse</span>}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
