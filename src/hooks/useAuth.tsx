import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authAPI } from '@/lib/api';

interface User {
  id: string;
  email: string;
  name?: string;
  role?: string;
  status?: string;
  mustResetPassword?: boolean;
}

export interface LoginResponse {
  token?: string;
  user?: User;
  requires2FA?: boolean;
  tempToken?: string;
  message?: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<LoginResponse>;
  verify2FA: (tempToken: string, code: string, trustDevice: boolean) => Promise<User>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check for existing session on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        if (token) {
          // Verify token is still valid
          const userData = await authAPI.verify();
          if (userData) {
            setUser(userData);
          } else {
            // Token is invalid or expired
            localStorage.removeItem('auth_token');
          }
        }
      } catch (error) {
        // Silently handle auth errors - user will need to log in again
        localStorage.removeItem('auth_token');
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  const login = async (email: string, password: string): Promise<LoginResponse> => {
    const response = await authAPI.login(email, password);
    if (response.requires2FA && response.tempToken) {
      return response;
    }
    if (response.token && response.user) {
      localStorage.setItem('auth_token', response.token);
      setUser(response.user);
      return response;
    }
    throw new Error('Invalid response from server');
  };

  const verify2FA = async (tempToken: string, code: string, trustDevice: boolean): Promise<User> => {
    const response = await authAPI.verify2FA(tempToken, code, trustDevice);
    if (response.token && response.user) {
      localStorage.setItem('auth_token', response.token);
      setUser(response.user);
      return response.user;
    }
    throw new Error('Invalid response from server');
  };

  const logout = () => {
    localStorage.removeItem('auth_token');
    setUser(null);
  };

  const refreshUser = async () => {
    const userData = await authAPI.verify();
    if (userData) {
      setUser(userData);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        verify2FA,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}


