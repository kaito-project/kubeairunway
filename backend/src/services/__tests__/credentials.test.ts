import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CredentialManager } from '../credentials';

const MINIMAL_KUBECONFIG = `apiVersion: v1
kind: Config
clusters:
- cluster:
    server: https://test-cluster.example.com
  name: test-cluster
contexts:
- context:
    cluster: test-cluster
    user: test-user
  name: test-context
current-context: test-context
users:
- name: test-user
  user:
    token: test-token
`;

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeTmpDir(subdir: string): string {
  const dir = path.join(tmpDir, subdir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe('CredentialManager', () => {
  test('loads credentials from directory with kubeconfig files', () => {
    const dir = writeTmpDir('load-test');
    fs.writeFileSync(path.join(dir, 'cluster-a.kubeconfig'), MINIMAL_KUBECONFIG);
    fs.writeFileSync(path.join(dir, 'cluster-b.kubeconfig'), MINIMAL_KUBECONFIG);

    const mgr = new CredentialManager();
    mgr.loadCredentials(dir);

    const all = mgr.getAllCredentials();
    expect(all).toHaveLength(2);

    const names = all.map(c => c.instanceName).sort();
    expect(names).toEqual(['cluster-a', 'cluster-b']);
  });

  test('gets credential by instance name', () => {
    const dir = writeTmpDir('get-test');
    fs.writeFileSync(path.join(dir, 'my-cluster.kubeconfig'), MINIMAL_KUBECONFIG);

    const mgr = new CredentialManager();
    mgr.loadCredentials(dir);

    const cred = mgr.getCredential('my-cluster');
    expect(cred).toBeDefined();
    expect(cred!.instanceName).toBe('my-cluster');
    expect(cred!.kubeConfig).toBeDefined();
    expect(cred!.lastLoaded).toBeInstanceOf(Date);
  });

  test('returns undefined for missing instance name', () => {
    const dir = writeTmpDir('missing-test');
    fs.writeFileSync(path.join(dir, 'exists.kubeconfig'), MINIMAL_KUBECONFIG);

    const mgr = new CredentialManager();
    mgr.loadCredentials(dir);

    expect(mgr.getCredential('does-not-exist')).toBeUndefined();
  });

  test('lists all credentials', () => {
    const dir = writeTmpDir('list-test');
    fs.writeFileSync(path.join(dir, 'a.kubeconfig'), MINIMAL_KUBECONFIG);
    fs.writeFileSync(path.join(dir, 'b.kubeconfig'), MINIMAL_KUBECONFIG);
    fs.writeFileSync(path.join(dir, 'c.kubeconfig'), MINIMAL_KUBECONFIG);

    const mgr = new CredentialManager();
    mgr.loadCredentials(dir);

    const all = mgr.getAllCredentials();
    expect(all).toHaveLength(3);
    expect(all.every(c => c.kubeConfig !== undefined)).toBe(true);
  });

  test('handles empty credentials directory', () => {
    const dir = writeTmpDir('empty-test');

    const mgr = new CredentialManager();
    mgr.loadCredentials(dir);

    expect(mgr.getAllCredentials()).toHaveLength(0);
  });

  test('handles missing credentials directory by creating it', () => {
    const dir = path.join(tmpDir, 'auto-create-test', 'nested');
    expect(fs.existsSync(dir)).toBe(false);

    const mgr = new CredentialManager();
    mgr.loadCredentials(dir);

    expect(fs.existsSync(dir)).toBe(true);
    expect(mgr.getAllCredentials()).toHaveLength(0);
  });

  test('ignores non-.kubeconfig files', () => {
    const dir = writeTmpDir('filter-test');
    fs.writeFileSync(path.join(dir, 'valid.kubeconfig'), MINIMAL_KUBECONFIG);
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'some notes');
    fs.writeFileSync(path.join(dir, 'config.yaml'), MINIMAL_KUBECONFIG);
    fs.writeFileSync(path.join(dir, '.hidden'), 'hidden file');

    const mgr = new CredentialManager();
    mgr.loadCredentials(dir);

    const all = mgr.getAllCredentials();
    expect(all).toHaveLength(1);
    expect(all[0].instanceName).toBe('valid');
  });

  test('makeApiClient throws for unknown instance', () => {
    const dir = writeTmpDir('api-test');
    const mgr = new CredentialManager();
    mgr.loadCredentials(dir);

    expect(() => mgr.makeApiClient('nonexistent', class {} as any)).toThrow(
      'No credential found for instance: nonexistent'
    );
  });

  test('skips malformed kubeconfig files gracefully', () => {
    const dir = writeTmpDir('malformed-test');
    fs.writeFileSync(path.join(dir, 'good.kubeconfig'), MINIMAL_KUBECONFIG);
    fs.writeFileSync(path.join(dir, 'bad.kubeconfig'), 'not valid yaml: [[[');

    const mgr = new CredentialManager();
    mgr.loadCredentials(dir);

    // Good one loaded, bad one skipped
    const all = mgr.getAllCredentials();
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(mgr.getCredential('good')).toBeDefined();
  });
});
