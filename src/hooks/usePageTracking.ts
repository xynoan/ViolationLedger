import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';
import { auditLogsAPI } from '@/lib/api';

/**
 * Hook to track page views for audit logging
 * This logs when a user navigates to a page
 */
export function usePageTracking() {
  const location = useLocation();
  const { user, isAuthenticated } = useAuth();
  const previousPath = useRef<string>('');

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    
    // Skip if it's the same path (e.g., re-render)
    if (previousPath.current === location.pathname) return;
    previousPath.current = location.pathname;

    // Log page view
    const logPageView = async () => {
      try {
        const pageName = location.pathname === '/' ? 'dashboard' : location.pathname.slice(1).replace(/-/g, '_');
        
        await auditLogsAPI.logActivity({
          action: 'page_view',
          resource: 'page',
          resourceId: location.pathname,
          details: {
            page: pageName,
            path: location.pathname,
            timestamp: new Date().toISOString()
          }
        });
      } catch (error) {
        // Silently fail - don't interrupt user experience
        console.error('Error tracking page view:', error);
      }
    };

    // Small delay to ensure user is fully authenticated
    const timer = setTimeout(logPageView, 100);
    return () => clearTimeout(timer);
  }, [location.pathname, user, isAuthenticated]);
}

