import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  const isResetPasswordPage = location.pathname === '/reset-password';

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Force password reset on first login
  if (user?.mustResetPassword && !isResetPasswordPage) {
    return <Navigate to="/reset-password" replace />;
  }

  // Already reset - don't allow access to reset page
  if (isResetPasswordPage && !user?.mustResetPassword) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}








