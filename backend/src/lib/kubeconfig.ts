import * as k8s from '@kubernetes/client-node';
import logger from './logger';

/**
 * Load a KubeConfig from the default location.
 *
 * When AUTH_ENABLED=true, client certificates are stripped from the current
 * user BEFORE any API client is created.  This is critical because Bun shares
 * TLS sessions process-wide: if *any* HTTP client establishes a connection
 * with admin client certificates, all subsequent requests to the same K8s API
 * server (including native `fetch`) inherit that TLS identity, causing the API
 * server to authenticate them as admin and ignore Bearer tokens.
 */
export function loadKubeConfig(): k8s.KubeConfig {
  const kc = new k8s.KubeConfig();

  try {
    kc.loadFromDefault();
  } catch {
    logger.warn('No kubeconfig found, using mock mode');
  }

  if (process.env.AUTH_ENABLED?.toLowerCase() === 'true' || process.env.AUTH_ENABLED === '1') {
    const currentUser = kc.getCurrentUser();
    if (currentUser) {
      (currentUser as any).certData = undefined;
      (currentUser as any).certFile = undefined;
      (currentUser as any).keyData = undefined;
      (currentUser as any).keyFile = undefined;
      logger.debug('Stripped client certificates from kubeconfig (AUTH_ENABLED)');
    }
  }

  return kc;
}
