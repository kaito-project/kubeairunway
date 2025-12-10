import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useHuggingFaceOAuth, useExchangeHuggingFaceToken, useSaveHuggingFaceToken, saveHfAccessToken } from '@/hooks/useHuggingFace';
import { useToast } from '@/hooks/useToast';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type CallbackStatus = 'processing' | 'success' | 'error';

export function HuggingFaceCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { validateState, clearOAuthSession } = useHuggingFaceOAuth();
  const exchangeToken = useExchangeHuggingFaceToken();
  const saveToken = useSaveHuggingFaceToken();

  const [status, setStatus] = useState<CallbackStatus>('processing');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [username, setUsername] = useState<string>('');
  
  // Prevent duplicate processing (React Strict Mode runs effects twice)
  const processedRef = useRef(false);

  useEffect(() => {
    const processCallback = async () => {
      // Skip if already processed
      if (processedRef.current) {
        return;
      }
      processedRef.current = true;
      // Check for error from HuggingFace
      const error = searchParams.get('error');
      const errorDescription = searchParams.get('error_description');
      if (error) {
        setStatus('error');
        setErrorMessage(errorDescription || error);
        clearOAuthSession();
        return;
      }

      // Get authorization code and state
      const code = searchParams.get('code');
      const state = searchParams.get('state');

      if (!code) {
        setStatus('error');
        setErrorMessage('No authorization code received from HuggingFace');
        clearOAuthSession();
        return;
      }

      // Validate state to prevent CSRF attacks
      if (!state || !validateState(state)) {
        setStatus('error');
        setErrorMessage('Invalid state parameter. This may be a security issue. Please try again.');
        clearOAuthSession();
        return;
      }

      try {
        // Exchange code for token
        const redirectUri = `${window.location.origin}/oauth/callback/huggingface`;
        console.log('[HF OAuth] Exchanging code for token...');
        const tokenResponse = await exchangeToken.mutateAsync({ code, redirectUri });
        console.log('[HF OAuth] Token exchange successful, user:', tokenResponse.user.name);

        setUsername(tokenResponse.user.name);

        // Save token to localStorage for frontend use (model searches, etc.)
        saveHfAccessToken(tokenResponse.accessToken);
        console.log('[HF OAuth] Saved token to localStorage');

        // Save token to K8s secrets
        console.log('[HF OAuth] Saving token to K8s secrets...');
        const saveResult = await saveToken.mutateAsync(tokenResponse.accessToken);
        console.log('[HF OAuth] Save result:', saveResult);

        setStatus('success');

        // Redirect to settings after a short delay
        setTimeout(() => {
          navigate('/settings', { replace: true });
          toast({
            title: 'HuggingFace Connected',
            description: `Successfully connected as ${tokenResponse.user.name}`,
          });
        }, 2000);
      } catch (err) {
        console.error('[HF OAuth] Error:', err);
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : 'Failed to complete OAuth flow');
        clearOAuthSession();
      }
    };

    processCallback();
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRetry = () => {
    navigate('/settings');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="flex items-center justify-center gap-2">
            {status === 'processing' && (
              <>
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                Connecting to HuggingFace
              </>
            )}
            {status === 'success' && (
              <>
                <CheckCircle className="h-6 w-6 text-green-500" />
                Connected Successfully
              </>
            )}
            {status === 'error' && (
              <>
                <XCircle className="h-6 w-6 text-red-500" />
                Connection Failed
              </>
            )}
          </CardTitle>
          <CardDescription>
            {status === 'processing' && 'Please wait while we complete the authentication...'}
            {status === 'success' && `Welcome, ${username}! Redirecting to settings...`}
            {status === 'error' && 'There was a problem connecting your HuggingFace account.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status === 'processing' && (
            <div className="flex flex-col items-center gap-4">
              <div className="text-sm text-muted-foreground text-center">
                Exchanging authorization code and saving your HuggingFace token...
              </div>
            </div>
          )}

          {status === 'success' && (
            <div className="flex flex-col items-center gap-4">
              <div className="text-sm text-green-600 dark:text-green-400 text-center">
                Your HuggingFace token has been securely saved to your Kubernetes cluster.
                You can now deploy models that require HuggingFace authentication.
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="flex flex-col items-center gap-4">
              <div className="text-sm text-red-600 dark:text-red-400 text-center bg-red-50 dark:bg-red-950 p-3 rounded-lg">
                {errorMessage}
              </div>
              <Button onClick={handleRetry} variant="outline">
                Back to Settings
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
