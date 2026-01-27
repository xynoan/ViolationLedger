import { auditLogsAPI } from './api';

/**
 * Track a user action/event for audit logging
 * Use this for button clicks, exports, and other frontend actions
 */
export async function trackAction(
  action: string,
  resource?: string,
  resourceId?: string,
  details?: any
) {
  try {
    await auditLogsAPI.logActivity({
      action,
      resource: resource || 'frontend',
      resourceId,
      details: {
        ...details,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    // Silently fail - don't interrupt user experience
    console.error('Error tracking action:', error);
  }
}

/**
 * Common action types
 */
export const ActionTypes = {
  PAGE_VIEW: 'page_view',
  BUTTON_CLICK: 'button_click',
  EXPORT: 'export',
  IMPORT: 'import',
  FILTER: 'filter',
  SEARCH: 'search',
  SORT: 'sort',
  DOWNLOAD: 'download',
  UPLOAD: 'upload',
  DELETE: 'delete',
  EDIT: 'edit',
  CREATE: 'create',
  VIEW: 'view',
};




