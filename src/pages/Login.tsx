import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, Lock, Mail, Eye, EyeOff, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [twoFAState, setTwoFAState] = useState<{ tempToken: string } | null>(null);
  const [code, setCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const { login, verify2FA } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim() || !password.trim()) {
      toast({
        title: "Validation Error",
        description: "Please enter both email and password",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const response = await login(email.trim(), password);
      if (response.requires2FA && response.tempToken) {
        setTwoFAState({ tempToken: response.tempToken });
        toast({
          title: "Verification code sent",
          description: response.message || "Enter the 6-digit code sent to your contact number.",
        });
      } else if (response.token && response.user) {
        const user = response.user;
        if (user.mustResetPassword) {
          navigate('/reset-password');
        } else {
          toast({
            title: "Login Successful",
            description: "Welcome back!",
          });
          navigate(user.role === 'encoder' ? '/vehicles' : '/');
        }
      } else {
        throw new Error('Invalid response from server');
      }
    } catch (error: any) {
      toast({
        title: "Login Failed",
        description: error.message || "Invalid email or password",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twoFAState || !code.trim()) {
      toast({
        title: "Enter code",
        description: "Please enter the 6-digit code from your contact number.",
        variant: "destructive",
      });
      return;
    }
    const normalizedCode = code.trim().replace(/\s/g, '');
    if (!/^\d{6}$/.test(normalizedCode)) {
      toast({
        title: "Invalid code",
        description: "Please enter a 6-digit code.",
        variant: "destructive",
      });
      return;
    }
    setIsVerifying(true);
    try {
      const user = await verify2FA(twoFAState.tempToken, normalizedCode, trustDevice);
      toast({
        title: "Login Successful",
        description: "Welcome back!",
      });
      if (user.mustResetPassword) {
        navigate('/reset-password');
      } else {
        navigate(user.role === 'encoder' ? '/vehicles' : '/');
      }
    } catch (error: any) {
      toast({
        title: "Verification Failed",
        description: error.message || "Invalid or expired code. Try again or log in again.",
        variant: "destructive",
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleBackToLogin = () => {
    setTwoFAState(null);
    setCode('');
    setTrustDevice(false);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <img src="/logo.png" alt="ViolationLedger" className="h-12 w-12" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">
            ViolationLedger
          </h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            Sign in to access the monitoring dashboard
          </p>
        </div>

        {/* 2FA verification step */}
        {twoFAState ? (
          <div className="glass-card rounded-xl p-6 sm:p-8 shadow-lg">
            <form onSubmit={handleVerify2FA} className="space-y-6">
              <div className="text-center mb-4">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-3">
                  <Smartphone className="h-6 w-6 text-primary" />
                </div>
                <h2 className="text-lg font-semibold text-foreground">Two-factor verification</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Enter the 6-digit code sent to your contact number
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="code" className="text-sm font-medium">
                  Verification code
                </Label>
                <Input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="text-center text-lg tracking-[0.5em] font-mono"
                  disabled={isVerifying}
                  maxLength={6}
                />
              </div>
              <div className="flex items-start gap-3">
                <Checkbox
                  id="trustDevice"
                  checked={trustDevice}
                  onCheckedChange={(checked) => setTrustDevice(checked === true)}
                  disabled={isVerifying}
                  className="mt-0.5"
                />
                <Label
                  htmlFor="trustDevice"
                  className="text-sm text-muted-foreground cursor-pointer leading-tight"
                >
                  Trust this device for 30 days — you won&apos;t need to enter a code again on this device for 30 days.
                </Label>
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={isVerifying || code.replace(/\D/g, '').length !== 6}
              >
                {isVerifying ? (
                  <>
                    <div className="h-4 w-4 border-2 border-background border-t-transparent rounded-full animate-spin mr-2" />
                    Verifying...
                  </>
                ) : (
                  'Verify and sign in'
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full text-muted-foreground"
                onClick={handleBackToLogin}
                disabled={isVerifying}
              >
                Back to sign in
              </Button>
            </form>
          </div>
        ) : (
        /* Login Card */
        <div className="glass-card rounded-xl p-6 sm:p-8 shadow-lg">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">
                Email Address
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9"
                  disabled={isLoading}
                  autoComplete="email"
                  autoFocus
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium">
                Password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9 pr-10"
                  disabled={isLoading}
                  autoComplete="current-password"
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
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <div className="h-4 w-4 border-2 border-background border-t-transparent rounded-full animate-spin mr-2" />
                  Signing in...
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4 mr-2" />
                  Sign In
                </>
              )}
            </Button>
          </form>
        </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground mt-6">
          © 2026 ViolationLedger. All rights reserved.
        </p>
      </div>
    </div>
  );
}


