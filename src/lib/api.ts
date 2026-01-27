const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const REQUEST_TIMEOUT = 10000; // 10 seconds

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
  getAll: () => fetchAPI('/cameras', { cache: true }),
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

// Hosts API
export const hostsAPI = {
  getAll: (search?: string) => {
    const query = search ? `?search=${encodeURIComponent(search)}` : '';
    return fetchAPI(`/hosts${query}`);
  },
  getById: (id: string) => fetchAPI(`/hosts/${id}`),
  create: (data: any) => fetchAPI('/hosts', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  update: (id: string, data: any) => fetchAPI(`/hosts/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  delete: (id: string) => fetchAPI(`/hosts/${id}`, {
    method: 'DELETE',
  }),
};

// Violations API
export const violationsAPI = {
  getAll: (filters?: { status?: string; locationId?: string; startDate?: string; endDate?: string; plateNumber?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.locationId) params.append('locationId', filters.locationId);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.plateNumber) params.append('plateNumber', filters.plateNumber);
    const query = params.toString();
    return fetchAPI(`/violations${query ? `?${query}` : ''}`);
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
};

// Upload API
export const uploadAPI = {
  analyze: (imageData: string, locationId?: string) => fetchAPI('/upload/analyze', {
    method: 'POST',
    body: JSON.stringify({ imageData, locationId }),
    timeout: 60000, // 60 seconds timeout for AI analysis
  }),
};

// Health API
export const healthAPI = {
  getStatus: () => fetchAPI('/health/status', { cache: false, timeout: 15000 }),
};

// Analytics API
export const analyticsAPI = {
  getAll: (filters?: { startDate?: string; endDate?: string; locationId?: string }) => {
    const params = new URLSearchParams();
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.locationId) params.append('locationId', filters.locationId);
    const query = params.toString();
    return fetchAPI(`/analytics${query ? `?${query}` : ''}`, { cache: false });
  },
};

// Users API
export const usersAPI = {
  getAll: () => fetchAPI('/users', { cache: false }),
  getById: (id: string) => fetchAPI(`/users/${id}`, { cache: false }),
  create: (data: { email: string; password: string; name?: string; role?: string }) =>
    fetchAPI('/users', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: { email?: string; password?: string; name?: string; role?: string }) =>
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
  login: async (email: string, password: string) => {
    const token = localStorage.getItem('auth_token');
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({ email, password }),
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
};

