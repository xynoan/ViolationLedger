const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const REQUEST_TIMEOUT = 10000; // 10 seconds

export function getTrustedDeviceTokenStorageKey(email: string) {
  return `trusted_device_token:${String(email || '').trim().toLowerCase()}`;
}

export function getTrustedDeviceExpiresAtStorageKey(email: string) {
  return `trusted_device_expires_at:${String(email || '').trim().toLowerCase()}`;
}

// Request cache for GET requests
const requestCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5000; // 5 seconds cache

// Abort controllers for request cancellation
const abortControllers = new Map<string, AbortController>();


interface FetchAPIOptions extends Omit<RequestInit, 'cache'> {
  cache?: boolean;
  timeout?: number;
}

async function fetchAPI(
  endpoint: string,
  options?: FetchAPIOptions
): Promise<any> {
  const cacheKey = options?.method === 'GET' ? endpoint : null;
  const useCache = options?.cache !== false && cacheKey;
  const timeout = options?.timeout || REQUEST_TIMEOUT;

  // Check cache for GET requests
  if (useCache && cacheKey) {
    const cached = requestCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }
  }

  // Cancel previous request for the same endpoint if it's a GET
  if (cacheKey && abortControllers.has(cacheKey)) {
    abortControllers.get(cacheKey)?.abort();
  }

  // Create abort controller for this request
  const abortController = new AbortController();
  if (cacheKey) {
    abortControllers.set(cacheKey, abortController);
  }

  // Create timeout
  const timeoutId = setTimeout(() => abortController.abort(), timeout);

  // Extract custom properties and create valid RequestInit
  const { cache: _cache, timeout: _timeout, ...fetchOptions } = options || {};

  try {
    // Get auth token from localStorage
    const token = localStorage.getItem('auth_token');
    
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...fetchOptions,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...fetchOptions.headers,
      },
      signal: abortController.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Network error' }));
      throw new Error(error.error || `HTTP error! status: ${response.status}`);
    }

    // Handle 204 No Content (empty response) for DELETE requests
    if (response.status === 204 || response.status === 201) {
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        return null;
      }
    }

    // Try to parse JSON, but handle empty responses gracefully
    const text = await response.text();
    if (!text || text.trim() === '') {
      return null;
    }

    try {
      const data = JSON.parse(text);
      
      // Cache GET requests
      if (useCache && cacheKey) {
        requestCache.set(cacheKey, { data, timestamp: Date.now() });
      }

      return data;
    } catch (error) {
      return null;
    }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('Request timeout or cancelled');
    }
    
    // Handle network errors (connection refused, etc.)
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error(
        `Unable to connect to server. Please make sure the backend server is running on ${API_BASE_URL}`
      );
    }
    
    // Re-throw with more context if it's a connection error
    if (error.message?.includes('Failed to fetch') || error.message?.includes('ERR_CONNECTION_REFUSED')) {
      throw new Error(
        `Connection refused. Please start the backend server: cd server && npm run dev`
      );
    }
    
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (cacheKey) {
      abortControllers.delete(cacheKey);
    }
  }
}

// Cameras API
export const camerasAPI = {
  getAll: (opts?: { cache?: boolean }) =>
    fetchAPI('/cameras', { cache: opts?.cache !== false }),
  getById: (id: string) => fetchAPI(`/cameras/${id}`, { cache: true }),
  create: (data: any) => fetchAPI('/cameras', {
    method: 'POST',
    body: JSON.stringify(data),
    cache: false,
  }),
  update: (id: string, data: any) => fetchAPI(`/cameras/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
    cache: false,
  }),
  delete: (id: string) => fetchAPI(`/cameras/${id}`, {
    method: 'DELETE',
    cache: false,
  }),
};

// Vehicles API
export const vehiclesAPI = {
  getAll: (search?: string) => {
    const query = search ? `?search=${encodeURIComponent(search)}` : '';
    return fetchAPI(`/vehicles${query}`);
  },
  getById: (id: string) => fetchAPI(`/vehicles/${id}`),
  create: (data: any) => fetchAPI('/vehicles', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  update: (id: string, data: any) => fetchAPI(`/vehicles/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  delete: (id: string) => fetchAPI(`/vehicles/${id}`, {
    method: 'DELETE',
  }),
};

// Residents API
export const residentsAPI = {
  getAll: (search?: string) => {
    const query = search ? `?search=${encodeURIComponent(search)}` : '';
    return fetchAPI(`/residents${query}`);
  },
  getById: (id: string) => fetchAPI(`/residents/${id}`),
  create: (data: any) => fetchAPI('/residents', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  update: (id: string, data: any) => fetchAPI(`/residents/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  delete: (id: string) => fetchAPI(`/residents/${id}`, {
    method: 'DELETE',
  }),
};

// Violations API
export const violationsAPI = {
  getAll: (filters?: {
    status?: string;
    locationId?: string;
    startDate?: string;
    endDate?: string;
    plateNumber?: string;
    residentId?: string;
    limit?: number;
  }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.locationId) params.append('locationId', filters.locationId);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.plateNumber) params.append('plateNumber', filters.plateNumber);
    if (filters?.residentId) params.append('residentId', filters.residentId);
    if (filters?.limit != null) params.append('limit', String(filters.limit));
    const query = params.toString();
    return fetchAPI(`/violations${query ? `?${query}` : ''}`, { cache: false });
  },
  getStats: (filters?: { startDate?: string; endDate?: string; locationId?: string }) => {
    const params = new URLSearchParams();
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.locationId) params.append('locationId', filters.locationId);
    const query = params.toString();
    return fetchAPI(`/violations/stats${query ? `?${query}` : ''}`);
  },
  getById: (id: string) => fetchAPI(`/violations/${id}`),
  create: (data: any) => fetchAPI('/violations', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  update: (id: string, data: any) => fetchAPI(`/violations/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  delete: (id: string) => fetchAPI(`/violations/${id}`, {
    method: 'DELETE',
  }),
  /** Resend owner reminder SMS for an active warning; may take up to ~30s for the provider. */
  sendSms: (id: string) =>
    fetchAPI(`/violations/${encodeURIComponent(id)}/send-sms`, {
      method: 'POST',
      timeout: 35000,
    }),
  assignToMe: (id: string) =>
    fetchAPI(`/violations/${encodeURIComponent(id)}/assign`, {
      method: 'PUT',
      cache: false,
    }),
  /**
   * Dev / ALLOW_TEST_VIOLATION_SEED: inserts a random warning with random elapsed time since detection.
   */
  seedTestActiveWarning: () =>
    fetchAPI('/violations/test-seed-active-warning', { method: 'POST' }),
  seedTestUnregisteredWarning: () =>
    fetchAPI('/violations/test-seed-unregistered-warning', { method: 'POST' }),
};

// Detections API
export const detectionsAPI = {
  getByCamera: (cameraId: string) => fetchAPI(`/detections/camera/${cameraId}`, { cache: true }),
  getLatest: (cameraId: string) => fetchAPI(`/detections/camera/${cameraId}/latest`, { cache: true, timeout: 5000 }),
  getAll: () => fetchAPI('/detections/all', { cache: true }),
};

// Captures API
export const capturesAPI = {
  trigger: (cameraId: string, imageData?: string) => fetchAPI(`/captures/${cameraId}`, {
    method: 'POST',
    body: JSON.stringify({ imageData }),
    timeout: 120000, // 120 seconds timeout for AI processing (can take up to 90 seconds)
  }),
  triggerAll: () => fetchAPI('/captures', {
    method: 'POST',
  }),
};

// Notifications API
export const notificationsAPI = {
  getAll: (unread?: boolean) => {
    const query = unread ? '?unread=true' : '';
    return fetchAPI(`/notifications${query}`);
  },
  getById: (id: string) => fetchAPI(`/notifications/${id}`),
  markAsRead: (id: string) => fetchAPI(`/notifications/${id}/read`, {
    method: 'PUT',
  }),
  markAllAsRead: () => fetchAPI('/notifications/read-all', {
    method: 'PUT',
  }),
  delete: (id: string) => fetchAPI(`/notifications/${id}`, {
    method: 'DELETE',
  }),
  handle: (id: string) => fetchAPI(`/notifications/${id}/handle`, {
    method: 'PUT',
  }),
};

// Upload API
export const uploadAPI = {
  analyze: (imageData: string, locationId?: string) => fetchAPI('/upload/analyze', {
    method: 'POST',
    body: JSON.stringify({ imageData, locationId }),
    timeout: 60000, // 60 seconds timeout for AI analysis
  }),
};

// OCR API (live plate recognition)
export const ocrAPI = {
  plate: (imageBase64: string) => fetchAPI('/ocr/plate', {
    method: 'POST',
    body: JSON.stringify({ imageBase64 }),
    timeout: 60000,
  }),
};

// YOLO detection API (vehicles + license plates)
export const detectAPI = {
  yolo: (imageBase64: string) => fetchAPI('/detect/yolo', {
    method: 'POST',
    body: JSON.stringify({ imageBase64 }),
    timeout: 65000, // 65s - backend has 60s; model load + inference can take 30s+ on first run
  }),
};

// Detection enable/disable (pause YOLO workers)
export const detectionAPI = {
  getEnabled: () => fetchAPI('/detect/enabled', { cache: false }),
  setEnabled: (enabled: boolean) =>
    fetchAPI('/detect/enabled', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
      cache: false,
    }),
};

// Health API
export const healthAPI = {
  getStatus: () => fetchAPI('/health/status', { cache: false, timeout: 15000 }),
  getOwnerSmsDelayConfig: () => fetchAPI('/health/owner-sms-delay', { cache: false }),
  setOwnerSmsDelay: (payload: { disabledForDemo?: boolean; delayMinutes?: number }) =>
    fetchAPI('/health/owner-sms-delay', {
      method: 'POST',
      body: JSON.stringify(payload),
      cache: false,
    }),
  getRuntimeConfig: () => fetchAPI('/health/runtime-config', { cache: false }),
  updateRuntimeConfig: (payload: {
    ownerSmsDelayMinutes?: number;
    ownerSmsDelayDisabledForDemo?: boolean;
    gracePeriodMinutes?: number;
  }) =>
    fetchAPI('/health/runtime-config', {
      method: 'POST',
      body: JSON.stringify(payload),
      cache: false,
    }),
};

// Analytics API
export interface AnalyticsResponse {
  users: {
    total: number;
    byRole: Record<string, number>;
  };
  vehicles: {
    total: number;
    bySource: Record<string, number>;
    registrationTrends: Array<{ date: string; count: number }>;
  };
  violations: {
    total: number;
    byStatus: Record<string, number>;
    byLocation: Array<{ cameraLocationId: string; count: number }>;
    overTime: Array<{ date: string; count: number }>;
    byHour: Array<{ hour: number; count: number }>;
    descriptive: {
      hourHeatmap: Array<{ hour: number; count: number }>;
      avgInfractionDurationMinutes: number | null;
      avgInfractionToActionMinutes: number | null;
      avgInfractionToActionLabel: string;
      byVehicleType: Array<{ vehicleType: string; count: number }>;
      topVehicleType: { vehicleType: string; count: number } | null;
      aiNarrative: string | null;
      repeatOffenders: {
        uniqueVehicles: number;
        recurringVehicles: number;
        recurringPct: number;
        threshold: number;
      };
      sevenDayComparison: {
        currentTotal: number;
        previousTotal: number;
        delta: number;
        deltaPct: number;
        basis: 'previous_7_day_period';
      };
      periodComparison: {
        currentTotal: number;
        previousTotal: number;
        delta: number;
        deltaPct: number;
        basis: 'previous_month_same_span';
      };
    };
  };
  warnings: {
    total: number;
    overTime: Array<{ date: string; count: number }>;
    converted: number;
    conversionRate: string;
    sevenDayComparison: {
      currentTotal: number;
      previousTotal: number;
      delta: number;
      deltaPct: number;
      basis: 'previous_7_day_period';
    };
  };
  detections: {
    total: number;
    byClass: Record<string, number>;
    overTime: Array<{ date: string; count: number }>;
  };
  sms: {
    total: number;
    byStatus: Record<string, number>;
  };
  incidents: {
    total: number;
    byStatus: Record<string, number>;
  };
  cameras: {
    total: number;
    byStatus: Record<string, number>;
  };
  recent: {
    violations: number;
    vehicles: number;
    detections: number;
  };
}

export const analyticsAPI = {
  getAll: (filters?: { startDate?: string; endDate?: string; locationId?: string }) => {
    const params = new URLSearchParams();
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.locationId) params.append('locationId', filters.locationId);
    const query = params.toString();
    return fetchAPI(`/analytics${query ? `?${query}` : ''}`, { cache: false }) as Promise<AnalyticsResponse>;
  },
};

// Users API
export type UserStatus = 'active' | 'inactive';

export interface CreateUserPayload {
  email: string;
  password: string;
  name: string;
  role?: string;
  contactNumber?: string;
  status?: UserStatus;
}

export interface UpdateUserPayload {
  email?: string;
  password?: string;
  name?: string;
  role?: string;
  contactNumber?: string;
  status?: UserStatus;
}

export const usersAPI = {
  getAll: () => fetchAPI('/users', { cache: false }),
  getById: (id: string) => fetchAPI(`/users/${id}`, { cache: false }),
  create: (data: CreateUserPayload) =>
    fetchAPI('/users', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: UpdateUserPayload) =>
    fetchAPI(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => fetchAPI(`/users/${id}`, { method: 'DELETE' }),
};

// Audit Logs API
export const auditLogsAPI = {
  getAll: (filters?: { userId?: string; action?: string; startDate?: string; endDate?: string; page?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (filters?.userId) params.append('userId', filters.userId);
    if (filters?.action) params.append('action', filters.action);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.page) params.append('page', filters.page.toString());
    if (filters?.limit) params.append('limit', filters.limit.toString());
    const query = params.toString();
    return fetchAPI(`/audit-logs${query ? `?${query}` : ''}`, { cache: false });
  },
  getStats: (filters?: { startDate?: string; endDate?: string }) => {
    const params = new URLSearchParams();
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    const query = params.toString();
    return fetchAPI(`/audit-logs/stats${query ? `?${query}` : ''}`, { cache: false });
  },
  clearAll: () => fetchAPI('/audit-logs', { method: 'DELETE' }),
  logActivity: async (data: { action: string; resource?: string; resourceId?: string; details?: any }) => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    
    try {
      const response = await fetch(`${API_BASE_URL}/audit-logs/log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        throw new Error('Failed to log activity');
      }
      
      return response.json();
    } catch (error) {
      // Silently fail - don't interrupt user experience
      console.error('Error logging activity:', error);
    }
  },
};

// Auth API
export const authAPI = {
  /** Public — activate account via email link (no auth header). */
  activateAccount: async (token: string) => {
    const response = await fetch(
      `${API_BASE_URL}/auth/activate?token=${encodeURIComponent(token)}`,
      { method: 'GET', headers: { Accept: 'application/json' } }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error((data as { error?: string }).error || 'Activation failed');
    }
    return data as { success?: boolean; message?: string; alreadyActivated?: boolean };
  },
  login: async (email: string, password: string) => {
    const token = localStorage.getItem('auth_token');
    const expiresAtKey = getTrustedDeviceExpiresAtStorageKey(email);
    const tokenKey = getTrustedDeviceTokenStorageKey(email);
    const expiresAt = Number(localStorage.getItem(expiresAtKey) || 0);
    const trustedDeviceToken =
      expiresAt && Date.now() < expiresAt ? localStorage.getItem(tokenKey) : null;

    if (expiresAt && Date.now() >= expiresAt) {
      localStorage.removeItem(expiresAtKey);
      localStorage.removeItem(tokenKey);
    }

    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({ email, password, trustedDeviceToken }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Login failed' }));
      throw new Error(error.error || `HTTP error! status: ${response.status}`);
    }

    return response.json();
  },
  verify: async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) return null;

    try {
      const response = await fetch(`${API_BASE_URL}/auth/verify`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        // If 401, token is invalid/expired - silently fail
        if (response.status === 401) {
          return null;
        }
        return null;
      }

      return response.json();
    } catch (error) {
      // Silently handle network errors
      return null;
    }
  },
  verify2FA: async (tempToken: string, code: string, trustDevice: boolean) => {
    const response = await fetch(`${API_BASE_URL}/auth/verify-2fa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken, code, trustDevice }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Verification failed' }));
      throw new Error(error.error || `HTTP error! status: ${response.status}`);
    }

    return response.json();
  },
  changePassword: async (currentPassword: string, newPassword: string) => {
    const token = localStorage.getItem('auth_token');
    if (!token) throw new Error('Not authenticated');

    const response = await fetch(`${API_BASE_URL}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to change password' }));
      throw new Error(error.error || `HTTP error! status: ${response.status}`);
    }

    return response.json();
  },
};

