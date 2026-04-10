import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const LOGIN_URL = import.meta.env.VITE_LOGIN_URL?.trim() || '/login';

function goToLogin(navigate: ReturnType<typeof useNavigate>) {
  if (/^https?:\/\//i.test(LOGIN_URL)) {
    window.location.assign(LOGIN_URL);
    return;
  }

  navigate(LOGIN_URL, { replace: true });
}

export default function ActivateAccount() {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => goToLogin(navigate), 1000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-sm text-center space-y-4">
        <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
        <h1 className="text-lg font-semibold text-foreground">Account setup removed</h1>
        <p className="text-sm text-muted-foreground">
          Accounts are now ready to use immediately. You will be redirected to sign in.
        </p>
        <Button className="w-full" onClick={() => goToLogin(navigate)}>
          Login
        </Button>
      </div>
    </div>
  );
}
