import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { authAPI } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

type Status = 'loading' | 'success' | 'error' | 'idle';

export default function ActivateAccount() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState('');
  useEffect(() => {
    const token = searchParams.get('token')?.trim();
    if (!token) {
      setStatus('error');
      setMessage('Missing activation link. Ask your administrator for a new invitation.');
      return;
    }

    let redirectTimer: ReturnType<typeof setTimeout> | undefined;

    (async () => {
      try {
        const data = await authAPI.activateAccount(token);
        const msg =
          data.message ||
          (data.alreadyActivated
            ? 'Your account is already activated.'
            : 'Your account has been activated.');
        setMessage(msg);
        setStatus('success');
        toast({
          title: data.alreadyActivated ? 'Already active' : 'Account activated',
          description: msg,
        });
        redirectTimer = setTimeout(() => navigate('/login', { replace: true }), 2500);
      } catch (e: unknown) {
        const err = e instanceof Error ? e.message : 'Activation failed';
        setMessage(err);
        setStatus('error');
        toast({
          title: 'Activation failed',
          description: err,
          variant: 'destructive',
        });
      }
    })();

    return () => {
      if (redirectTimer) clearTimeout(redirectTimer);
    };
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-sm text-center space-y-4">
        {status === 'loading' && (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
            <h1 className="text-lg font-semibold text-foreground">Activating your account…</h1>
            <p className="text-sm text-muted-foreground">Please wait.</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
            <h1 className="text-lg font-semibold text-foreground">You&apos;re all set</h1>
            <p className="text-sm text-muted-foreground">{message}</p>
            <p className="text-xs text-muted-foreground">Redirecting to sign in…</p>
            <Button className="w-full" onClick={() => navigate('/login', { replace: true })}>
              Go to sign in
            </Button>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle className="h-12 w-12 text-destructive mx-auto" />
            <h1 className="text-lg font-semibold text-foreground">Could not activate</h1>
            <p className="text-sm text-destructive/90">{message}</p>
            <Button variant="outline" className="w-full" onClick={() => navigate('/login', { replace: true })}>
              Back to sign in
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
