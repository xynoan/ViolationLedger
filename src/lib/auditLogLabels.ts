/**
 * Human-readable labels for audit log actions and resources (non-developer friendly).
 *
 * Use {@link mapAuditSlugToFriendly} for a single entry point, or the specific helpers below.
 */

const ACTION_LABELS: Record<string, string> = {
  view: 'Viewed',
  page_view: 'Viewed',
  button_click: 'Button action',
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  login: 'Signed in',
  logout: 'Signed out',
  capture: 'Capture',
  upload: 'Upload',
  export: 'Export',
  filter: 'Filtered',
  search: 'Search',
  edit: 'Edited',
  unknown: 'Other',
};

/** App routes (path → label) for page views & API path hints */
const ROUTE_LABELS: Record<string, string> = {
  '/': 'Dashboard',
  '/vehicles': 'Vehicle Registry',
  '/hosts': 'Residents Registry',
  '/residents': 'Residents Registry',
  '/cameras': 'Cameras',
  '/warnings': 'Warnings',
  '/tickets': 'Tickets',
  '/violations': 'Violations History',
  '/upload': 'Upload Image',
  '/settings': 'Settings',
  '/analytics': 'Analytics',
  '/users': 'User List',
  '/audit-logs': 'Activity Logs',
};

/** Resource slugs stored in DB (from middleware) → readable */
const RESOURCE_LABELS: Record<string, string> = {
  root: 'Dashboard',
  camera: 'Cameras',
  vehicle: 'Vehicle Registry',
  resident: 'Residents Registry',
  violation: 'Violations',
  detection: 'Detections',
  incident: 'Incidents',
  notification: 'Notifications',
  user: 'User List',
  audit_log: 'Activity Logs',
  audit_logging: 'Activity logging',
  capture: 'Captures',
  upload: 'Upload',
  health: 'System health',
  analytics: 'Analytics',
  settings: 'Settings',
  authentication: 'Sign-in',
  sms: 'SMS',
  frontend: 'Application',
  page: 'Page',
  unknown: 'Other',
};

/** Map API or app path to a short friendly name */
export function friendlyPathLabel(path: string): string {
  if (!path || path === '/') return ROUTE_LABELS['/'] || 'Dashboard';
  const clean = path.split('?')[0];
  const noApi = clean.replace(/^\/api/, '') || '/';
  const key = noApi.replace(/\/$/, '') || '/';

  if (ROUTE_LABELS[key]) return ROUTE_LABELS[key];
  if (ROUTE_LABELS[noApi]) return ROUTE_LABELS[noApi];

  // Segment-based fallbacks
  const segments = key.split('/').filter(Boolean);
  const first = segments[0] || '';
  const segmentMap: Record<string, string> = {
    vehicles: 'Vehicle Registry',
    hosts: 'Residents Registry',
    residents: 'Residents Registry',
    cameras: 'Cameras',
    violations: 'Violations',
    detections: 'Detections',
    users: 'User List',
    'audit-logs': 'Activity Logs',
    captures: 'Captures',
    notifications: 'Notifications',
    settings: 'Settings',
    analytics: 'Analytics',
    auth: 'Authentication',
    stats: 'Statistics',
    health: 'Health check',
  };
  if (first && segmentMap[first]) return segmentMap[first];

  if (noApi.startsWith('/api/')) {
    const rest = segments.join(' › ');
    return rest ? `API: ${rest}` : 'API';
  }

  return key;
}

export function humanizeAction(action: string): string {
  if (!action) return 'Other';
  const key = action.toLowerCase().trim();
  return ACTION_LABELS[key] ?? action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Maps stored slugs and routes to friendly labels for admins (single helper entry point). */
export function mapAuditSlugToFriendly(
  kind: 'action' | 'resource' | 'path',
  value: string
): string {
  switch (kind) {
    case 'action':
      return humanizeAction(value);
    case 'resource':
      return humanizeResource(value);
    case 'path':
      return friendlyPathLabel(value);
    default:
      return value;
  }
}

export function humanizeResource(resource: string): string {
  if (!resource) return '—';
  const key = resource.toLowerCase().trim();
  return RESOURCE_LABELS[key] ?? resource.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function verbForMethod(method: string): string {
  const m = (method || 'GET').toUpperCase();
  if (m === 'GET') return 'Viewed';
  if (m === 'POST') return 'Submitted';
  if (m === 'PUT' || m === 'PATCH') return 'Updated';
  if (m === 'DELETE') return 'Removed';
  return m;
}

/**
 * Turn raw JSON details into a short sentence for admins.
 */
export function friendlyDetails(details: string, resourceSlug: string): string {
  if (!details || details === '{}') return '—';
  try {
    const parsed = JSON.parse(details) as {
      method?: string;
      path?: string;
      page?: string;
      body?: Record<string, unknown>;
      action?: string;
      resource?: string;
    };

    // Frontend page tracking (no HTTP method)
    if (parsed.path && typeof parsed.path === 'string' && parsed.page && !parsed.method) {
      return `Viewed ${friendlyPathLabel(parsed.path)}`;
    }

    const method = (parsed.method || 'GET').toUpperCase();
    const path = parsed.path || '';
    const pathLower = path.toLowerCase();

    if (method === 'POST' && pathLower.includes('user')) {
      const body = (parsed.body || {}) as Record<string, unknown>;
      const role = String(body.role || body.newRole || '');
      const email = String(body.email || '');
      if (email && role) return `Created user account (${email}) · role: ${role}`;
      if (email) return `Created user account (${email})`;
      if (role) return `Created user account · role: ${role}`;
      return 'Created user account';
    }

    if (parsed.resource === 'user' && parsed.action === 'create') {
      const body = (parsed.body || {}) as Record<string, unknown>;
      const role = String(body.role || body.newRole || '');
      return role ? `Created user account (role: ${role})` : 'Created user account';
    }

    const place = friendlyPathLabel(path);

    if (method === 'GET' && path) {
      return `${verbForMethod(method)} ${place}`;
    }
    if ((method === 'POST' || method === 'PUT' || method === 'PATCH') && path) {
      return `${verbForMethod(method)} · ${place}`;
    }
    if (method === 'DELETE' && path) {
      return `Removed item · ${place}`;
    }

    if (path) return `${verbForMethod(method)} · ${place}`;

    const body = parsed.body;
    if (body && typeof body === 'object' && Object.keys(body).length > 0) {
      return 'Request with additional data';
    }

    return humanizeResource(resourceSlug);
  } catch {
    return details.length > 120 ? `${details.slice(0, 117)}…` : details;
  }
}

/** Compact readable time, e.g. "Apr 7, 7:33 AM" (adds year if not current year). */
export function formatLogTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const datePart = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  const timePart = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${datePart}, ${timePart}`;
}

/** Primary palette: blue = views, green = creates, red = deletes; other actions use neutral. */
export type ActionTone = 'view' | 'create' | 'delete' | 'neutral';

export function getActionTone(action: string): ActionTone {
  const a = action.toLowerCase();
  if (a === 'view' || a === 'page_view' || a === 'filter' || a === 'search') return 'view';
  if (a === 'create' || a === 'upload' || a === 'capture' || a === 'export') return 'create';
  if (a === 'delete') return 'delete';
  return 'neutral';
}

export const ACTION_BADGE_CLASSES: Record<ActionTone, string> = {
  view: 'border-blue-500/40 bg-blue-500/12 text-blue-900 dark:text-blue-100',
  create: 'border-emerald-500/40 bg-emerald-500/12 text-emerald-900 dark:text-emerald-100',
  delete: 'border-red-500/45 bg-red-500/12 text-red-900 dark:text-red-100',
  neutral: 'border-border/80 bg-muted/60 text-foreground',
};
