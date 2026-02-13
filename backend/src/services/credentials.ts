import * as k8s from '@kubernetes/client-node';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../lib/logger';

const CREDENTIALS_PATH = process.env.CREDENTIALS_PATH || './credentials';
const KUBECONFIG_EXTENSION = '.kubeconfig';
const DEBOUNCE_MS = 1000;

interface ClusterCredential {
  instanceName: string;
  kubeConfig: k8s.KubeConfig;
  lastLoaded: Date;
}

class CredentialManager {
  private credentials: Map<string, ClusterCredential> = new Map();
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  loadCredentials(credentialsPath: string = CREDENTIALS_PATH): void {
    this.ensureDirectory(credentialsPath);

    const files = fs.readdirSync(credentialsPath)
      .filter(f => f.endsWith(KUBECONFIG_EXTENSION));

    const loaded = new Map<string, ClusterCredential>();

    for (const file of files) {
      const instanceName = file.slice(0, -KUBECONFIG_EXTENSION.length);
      const filePath = path.join(credentialsPath, file);

      try {
        const kc = new k8s.KubeConfig();
        kc.loadFromFile(filePath);
        loaded.set(instanceName, {
          instanceName,
          kubeConfig: kc,
          lastLoaded: new Date(),
        });
        logger.info({ instanceName, file }, 'Loaded credential');
      } catch (err) {
        logger.warn({ instanceName, file, error: (err as Error).message }, 'Failed to load kubeconfig, skipping');
      }
    }

    this.credentials = loaded;
    logger.info({ count: loaded.size }, 'Credentials loaded');
  }

  getCredential(instanceName: string): ClusterCredential | undefined {
    return this.credentials.get(instanceName);
  }

  getAllCredentials(): ClusterCredential[] {
    return Array.from(this.credentials.values());
  }

  makeApiClient<T>(instanceName: string, apiClass: new (...args: any[]) => T): T {
    const cred = this.credentials.get(instanceName);
    if (!cred) {
      throw new Error(`No credential found for instance: ${instanceName}`);
    }
    return cred.kubeConfig.makeApiClient(apiClass);
  }

  startWatcher(credentialsPath: string = CREDENTIALS_PATH): void {
    this.ensureDirectory(credentialsPath);

    try {
      this.watcher = fs.watch(credentialsPath, (_eventType, _filename) => {
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
          logger.info('Credential directory changed, reloading');
          try {
            this.loadCredentials(credentialsPath);
          } catch (err) {
            logger.warn({ error: (err as Error).message }, 'Failed to reload credentials after file change');
          }
        }, DEBOUNCE_MS);
      });
      logger.info({ path: credentialsPath }, 'Started watching credentials directory');
    } catch (err) {
      logger.warn({ error: (err as Error).message }, 'Failed to start credentials watcher');
    }
  }

  stopWatcher(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      logger.info('Stopped watching credentials directory');
    }
  }

  private ensureDirectory(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      logger.warn({ path: dirPath }, 'Credentials directory does not exist, creating');
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
}

export { CredentialManager, ClusterCredential };
export const credentialManager = new CredentialManager();
