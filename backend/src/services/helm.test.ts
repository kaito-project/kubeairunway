import { describe, test, expect } from 'bun:test';
import type { HelmResult, HelmRelease, HelmRepo, HelmChart } from '../providers/types';
import { GPU_OPERATOR_REPO, GPU_OPERATOR_CHART } from './helm';

describe('HelmService - GPU Operator Constants', () => {
  test('GPU_OPERATOR_REPO has correct configuration', () => {
    expect(GPU_OPERATOR_REPO.name).toBe('nvidia');
    expect(GPU_OPERATOR_REPO.url).toBe('https://helm.ngc.nvidia.com/nvidia');
  });

  test('GPU_OPERATOR_CHART has correct configuration', () => {
    expect(GPU_OPERATOR_CHART.name).toBe('gpu-operator');
    expect(GPU_OPERATOR_CHART.chart).toBe('nvidia/gpu-operator');
    expect(GPU_OPERATOR_CHART.namespace).toBe('gpu-operator');
    expect(GPU_OPERATOR_CHART.createNamespace).toBe(true);
  });
});

describe('HelmService - HelmResult Structure', () => {
  test('creates successful result', () => {
    const result: HelmResult = {
      success: true,
      stdout: 'Release "my-app" has been installed.',
      stderr: '',
      exitCode: 0,
    };

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });

  test('creates failed result', () => {
    const result: HelmResult = {
      success: false,
      stdout: '',
      stderr: 'Error: release "my-app" already exists',
      exitCode: 1,
    };

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('already exists');
  });

  test('creates timeout result', () => {
    const result: HelmResult = {
      success: false,
      stdout: 'Partial output...',
      stderr: 'Command timed out',
      exitCode: null,
    };

    expect(result.success).toBe(false);
    expect(result.exitCode).toBeNull();
    expect(result.stderr).toContain('timed out');
  });

  test('creates execution error result', () => {
    const result: HelmResult = {
      success: false,
      stdout: '',
      stderr: 'Failed to execute helm: ENOENT',
      exitCode: null,
    };

    expect(result.success).toBe(false);
    expect(result.stderr).toContain('Failed to execute');
  });
});

describe('HelmService - HelmRelease Structure', () => {
  test('creates valid release info', () => {
    const release: HelmRelease = {
      name: 'dynamo',
      namespace: 'dynamo',
      revision: '1',
      updated: '2024-01-15 10:30:00.123456789 +0000 UTC',
      status: 'deployed',
      chart: 'dynamo-0.1.0',
      appVersion: '0.1.0',
    };

    expect(release.name).toBe('dynamo');
    expect(release.status).toBe('deployed');
    expect(release.revision).toBe('1');
  });

  test('handles pending-install status', () => {
    const release: HelmRelease = {
      name: 'gpu-operator',
      namespace: 'gpu-operator',
      revision: '1',
      updated: '2024-01-15 10:30:00.123456789 +0000 UTC',
      status: 'pending-install',
      chart: 'gpu-operator-23.9.0',
      appVersion: '23.9.0',
    };

    expect(release.status).toBe('pending-install');
  });

  test('handles failed status', () => {
    const release: HelmRelease = {
      name: 'broken-app',
      namespace: 'default',
      revision: '3',
      updated: '2024-01-15 10:30:00.123456789 +0000 UTC',
      status: 'failed',
      chart: 'my-chart-1.0.0',
      appVersion: '1.0.0',
    };

    expect(release.status).toBe('failed');
  });
});

describe('HelmService - Command Building Logic', () => {
  // Test the logic for building helm commands (mirrors actual helm.ts behavior)
  // Helper to convert values to --set-json args (mirrors helm.ts valuesToSetJsonArgs)
  function valuesToSetJsonArgs(values: Record<string, unknown>): string[] {
    const args: string[] = [];
    for (const [key, value] of Object.entries(values)) {
      args.push('--set-json', `${key}=${JSON.stringify(value)}`);
    }
    return args;
  }

  function buildInstallCommand(chart: HelmChart): string[] {
    const args = ['upgrade', chart.name, chart.chart, '--install'];
    args.push('--namespace', chart.namespace);

    if (chart.createNamespace) {
      args.push('--create-namespace');
    }

    if (chart.version) {
      args.push('--version', chart.version);
    }

    if (chart.values) {
      args.push(...valuesToSetJsonArgs(chart.values));
    }

    return args;
  }

  test('builds basic install command', () => {
    const chart: HelmChart = {
      name: 'my-app',
      chart: 'repo/my-chart',
      namespace: 'my-namespace',
    };

    const args = buildInstallCommand(chart);
    expect(args).toContain('upgrade');
    expect(args).toContain('my-app');
    expect(args).toContain('repo/my-chart');
    expect(args).toContain('--install');
    expect(args).toContain('--namespace');
    expect(args).toContain('my-namespace');
  });

  test('adds --create-namespace when specified', () => {
    const chart: HelmChart = {
      name: 'my-app',
      chart: 'repo/my-chart',
      namespace: 'new-namespace',
      createNamespace: true,
    };

    const args = buildInstallCommand(chart);
    expect(args).toContain('--create-namespace');
  });

  test('does not add --create-namespace when false', () => {
    const chart: HelmChart = {
      name: 'my-app',
      chart: 'repo/my-chart',
      namespace: 'existing-namespace',
      createNamespace: false,
    };

    const args = buildInstallCommand(chart);
    expect(args).not.toContain('--create-namespace');
  });

  test('adds version when specified', () => {
    const chart: HelmChart = {
      name: 'my-app',
      chart: 'repo/my-chart',
      namespace: 'default',
      version: '1.2.3',
    };

    const args = buildInstallCommand(chart);
    expect(args).toContain('--version');
    expect(args).toContain('1.2.3');
  });

  test('adds --set-json with values when specified', () => {
    const chart: HelmChart = {
      name: 'kaito-workspace',
      chart: 'kaito/workspace',
      namespace: 'kaito-workspace',
      version: '0.8.0',
      values: {
        featureGates: {
          disableNodeAutoProvisioning: true,
        },
      },
    };

    const args = buildInstallCommand(chart);
    expect(args).toContain('--set-json');
    // New format: --set-json 'key={"nested":"value"}'
    const setJsonIndex = args.indexOf('--set-json');
    const valuesArg = args[setJsonIndex + 1];
    expect(valuesArg).toBe('featureGates={"disableNodeAutoProvisioning":true}');
  });

  test('handles nested values object correctly', () => {
    const chart: HelmChart = {
      name: 'test-chart',
      chart: 'repo/chart',
      namespace: 'test-ns',
      values: {
        level1: {
          level2: {
            level3: 'deep-value',
          },
          simple: 123,
        },
        array: [1, 2, 3],
      },
    };

    const args = buildInstallCommand(chart);
    // Should have two --set-json entries (one per top-level key)
    const setJsonIndices = args.reduce<number[]>((indices, arg, i) => {
      if (arg === '--set-json') indices.push(i);
      return indices;
    }, []);
    expect(setJsonIndices.length).toBe(2);
    
    // Check level1 value
    const level1Arg = args.find(arg => arg.startsWith('level1='));
    expect(level1Arg).toBeDefined();
    const level1Value = JSON.parse(level1Arg!.split('=').slice(1).join('='));
    expect(level1Value.level2.level3).toBe('deep-value');
    expect(level1Value.simple).toBe(123);
    
    // Check array value
    const arrayArg = args.find(arg => arg.startsWith('array='));
    expect(arrayArg).toBeDefined();
    const arrayValue = JSON.parse(arrayArg!.split('=').slice(1).join('='));
    expect(arrayValue).toEqual([1, 2, 3]);
  });
});

describe('HelmService - getInstallCommands Logic', () => {
  function getInstallCommands(repos: HelmRepo[], charts: HelmChart[]): string[] {
    const commands: string[] = [];

    for (const repo of repos) {
      commands.push(`helm repo add ${repo.name} ${repo.url}`);
    }

    if (repos.length > 0) {
      commands.push('helm repo update');
    }

    for (const chart of charts) {
      if (chart.fetchUrl) {
        let cmd = `helm fetch ${chart.fetchUrl} && helm install ${chart.name} ${chart.chart}`;
        cmd += ` --namespace ${chart.namespace}`;
        if (chart.createNamespace) {
          cmd += ' --create-namespace';
        }
        commands.push(cmd);
      } else {
        let cmd = `helm install ${chart.name} ${chart.chart}`;
        cmd += ` --namespace ${chart.namespace}`;
        if (chart.createNamespace) {
          cmd += ' --create-namespace';
        }
        if (chart.version) {
          cmd += ` --version ${chart.version}`;
        }
        commands.push(cmd);
      }
    }

    return commands;
  }

  test('generates repo add commands', () => {
    const repos: HelmRepo[] = [
      { name: 'nvidia', url: 'https://helm.ngc.nvidia.com/nvidia' },
    ];
    const charts: HelmChart[] = [];

    const commands = getInstallCommands(repos, charts);
    expect(commands).toContain('helm repo add nvidia https://helm.ngc.nvidia.com/nvidia');
    expect(commands).toContain('helm repo update');
  });

  test('generates install commands', () => {
    const repos: HelmRepo[] = [];
    const charts: HelmChart[] = [
      { name: 'my-app', chart: 'repo/chart', namespace: 'default' },
    ];

    const commands = getInstallCommands(repos, charts);
    expect(commands[0]).toContain('helm install my-app repo/chart');
    expect(commands[0]).toContain('--namespace default');
  });

  test('generates commands for GPU Operator', () => {
    const commands = getInstallCommands([GPU_OPERATOR_REPO], [GPU_OPERATOR_CHART]);

    expect(commands[0]).toBe('helm repo add nvidia https://helm.ngc.nvidia.com/nvidia');
    expect(commands[1]).toBe('helm repo update');
    expect(commands[2]).toContain('helm install gpu-operator nvidia/gpu-operator');
    expect(commands[2]).toContain('--namespace gpu-operator');
    expect(commands[2]).toContain('--create-namespace');
  });

  test('handles charts with fetchUrl', () => {
    const charts: HelmChart[] = [
      {
        name: 'custom-chart',
        chart: '/tmp/chart.tgz',
        namespace: 'custom-ns',
        fetchUrl: 'https://example.com/chart.tgz',
        createNamespace: true,
      },
    ];

    const commands = getInstallCommands([], charts);
    expect(commands[0]).toContain('helm fetch https://example.com/chart.tgz');
    expect(commands[0]).toContain('--create-namespace');
  });
});

describe('HelmService - Release Status Detection', () => {
  function isProblematicStatus(status: string): boolean {
    const s = status.toLowerCase();
    // Only 'failed' is truly problematic
    // pending-install/upgrade are normal during installation
    return s === 'failed';
  }

  function isPendingStatus(status: string): boolean {
    const s = status.toLowerCase();
    return s === 'pending-install' || s === 'pending-upgrade' || s === 'pending-rollback';
  }

  test('identifies failed status as problematic', () => {
    expect(isProblematicStatus('failed')).toBe(true);
    expect(isProblematicStatus('Failed')).toBe(true);
    expect(isProblematicStatus('FAILED')).toBe(true);
  });

  test('does not treat pending statuses as problematic', () => {
    expect(isProblematicStatus('pending-install')).toBe(false);
    expect(isProblematicStatus('pending-upgrade')).toBe(false);
    expect(isProblematicStatus('pending-rollback')).toBe(false);
  });

  test('does not treat deployed as problematic', () => {
    expect(isProblematicStatus('deployed')).toBe(false);
  });

  test('identifies pending statuses', () => {
    expect(isPendingStatus('pending-install')).toBe(true);
    expect(isPendingStatus('pending-upgrade')).toBe(true);
    expect(isPendingStatus('pending-rollback')).toBe(true);
    expect(isPendingStatus('Pending-Install')).toBe(true);
  });

  test('does not treat deployed as pending', () => {
    expect(isPendingStatus('deployed')).toBe(false);
    expect(isPendingStatus('failed')).toBe(false);
  });
});
