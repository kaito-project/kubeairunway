import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface AuthProviderInfo {
  type: string;
  enabled: boolean;
}

/**
 * Fetch enabled OAuth providers from the backend.
 * Returns an empty array if the endpoint is not available.
 */
function useOAuthProviders(hubMode: boolean) {
  const [providers, setProviders] = useState<AuthProviderInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!hubMode) return;

    setIsLoading(true);
    fetch('/api/auth/providers')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: AuthProviderInfo[]) => setProviders(data.filter((p) => p.enabled)))
      .catch(() => setProviders([]))
      .finally(() => setIsLoading(false));
  }, [hubMode]);

  return { providers, isLoading };
}

const handleOAuthLogin = (provider: string) => {
  window.location.href = `/api/auth/login/${provider}`;
};

function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading, error, login, checkTokenFromUrl } = useAuth();
  const { data: settings, isLoading: settingsLoading } = useSettings();
  const [manualToken, setManualToken] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);

  const hubMode = settings?.auth?.hubMode ?? false;
  const { providers: oauthProviders, isLoading: providersLoading } = useOAuthProviders(hubMode);

  // Check for token in URL on mount
  useEffect(() => {
    const foundToken = checkTokenFromUrl();
    if (foundToken) {
      // Token was found and processed, redirect will happen via isAuthenticated
    }
  }, [checkTokenFromUrl]);

  // Redirect when authenticated
  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);

  const handleManualLogin = () => {
    if (manualToken.trim()) {
      login(manualToken.trim());
    }
  };

  const handleRefresh = () => {
    window.location.reload();
  };

  if (isLoading || settingsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Checking authentication...</p>
        </div>
      </div>
    );
  }

  if (isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-muted-foreground">Redirecting...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-lg bg-primary flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-6 w-6 text-primary-foreground"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <CardTitle className="text-2xl">KubeFoundry</CardTitle>
          <CardDescription>
            {hubMode ? 'Sign in to continue' : 'Authentication Required'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {hubMode ? (
            /* Hub mode: OAuth login buttons */
            <div className="space-y-3">
              {providersLoading ? (
                <div className="flex justify-center py-4">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                </div>
              ) : oauthProviders.length > 0 ? (
                <>
                  {oauthProviders.some((p) => p.type === 'entra') && (
                    <Button
                      variant="outline"
                      className="w-full h-11 text-sm font-medium"
                      onClick={() => handleOAuthLogin('entra')}
                    >
                      <MicrosoftIcon className="h-5 w-5 mr-2" />
                      Sign in with Microsoft
                    </Button>
                  )}
                  {oauthProviders.some((p) => p.type === 'github') && (
                    <Button
                      variant="outline"
                      className="w-full h-11 text-sm font-medium"
                      onClick={() => handleOAuthLogin('github')}
                    >
                      <GitHubIcon className="h-5 w-5 mr-2" />
                      Sign in with GitHub
                    </Button>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground text-center">
                  No authentication providers are configured. Contact your administrator.
                </p>
              )}
            </div>
          ) : (
            /* Single-cluster mode: CLI login + manual token input */
            <>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Run this command in your terminal to authenticate:
                </p>
                <div className="rounded-lg bg-muted p-3 font-mono text-sm">
                  <code>kubefoundry login</code>
                </div>
                <p className="text-xs text-muted-foreground">
                  This will extract your credentials from kubeconfig and open this page automatically.
                </p>
              </div>

              <div className="flex items-center gap-4">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground uppercase">or</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              {showManualInput ? (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="token">Paste Token Manually</Label>
                    <Input
                      id="token"
                      type="password"
                      placeholder="eyJhbG..."
                      value={manualToken}
                      onChange={(e) => setManualToken(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleManualLogin();
                      }}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={handleManualLogin} className="flex-1">
                      Login
                    </Button>
                    <Button variant="outline" onClick={() => setShowManualInput(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleRefresh} className="flex-1">
                    Check Again
                  </Button>
                  <Button variant="ghost" onClick={() => setShowManualInput(true)}>
                    Paste Token
                  </Button>
                </div>
              )}
            </>
          )}

          {/* Help text */}
          <div className="text-center text-xs text-muted-foreground">
            <p>
              Need help?{' '}
              <a
                href="https://github.com/kubefoundry/kubefoundry#authentication"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                View documentation
              </a>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
