import { spawn } from 'child_process';
import logger from '../lib/logger';

/**
 * BuildKit builder configuration
 */
export const BUILDKIT_CONFIG = {
  builderName: 'kubeairunway-builder',
  namespace: 'kubeairunway-system',
  resources: {
    cpu: '2',
    memory: '4Gi',
  },
} as const;

/**
 * BuildKit builder status
 */
export interface BuilderStatus {
  exists: boolean;
  ready: boolean;
  name: string;
  driver: string;
  message: string;
}

/**
 * Result of a command execution
 */
interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Stream callback for real-time output
 */
export type StreamCallback = (data: string, stream: 'stdout' | 'stderr') => void;

/**
 * BuildKit Service
 * Manages BuildKit builders using the Kubernetes driver for in-cluster image building
 */
class BuildKitService {
  private dockerPath: string;

  constructor() {
    // Use DOCKER_PATH env var or default to 'docker' in PATH
    this.dockerPath = process.env.DOCKER_PATH || 'docker';
  }

  /**
   * Execute a command
   */
  private async execute(
    command: string,
    args: string[],
    onStream?: StreamCallback,
    timeoutMs: number = 300000 // 5 minutes default timeout
  ): Promise<CommandResult> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      logger.debug({ command, args }, `Executing: ${command} ${args.join(' ')}`);

      const proc = spawn(command, args, {
        env: { ...process.env },
        shell: false,
      });

      // Set timeout
      const timeout = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
      }, timeoutMs);

      proc.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        if (onStream) {
          onStream(text, 'stdout');
        }
      });

      proc.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        if (onStream) {
          onStream(text, 'stderr');
        }
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);

        if (timedOut) {
          resolve({
            success: false,
            stdout,
            stderr: stderr + '\nCommand timed out',
            exitCode: null,
          });
        } else {
          resolve({
            success: code === 0,
            stdout,
            stderr,
            exitCode: code,
          });
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        resolve({
          success: false,
          stdout,
          stderr: `Failed to execute command: ${err.message}`,
          exitCode: null,
        });
      });
    });
  }

  /**
   * Check if Docker CLI is available
   */
  async checkDockerAvailable(): Promise<{ available: boolean; version?: string; error?: string }> {
    const result = await this.execute(this.dockerPath, ['version', '--format', '{{.Client.Version}}']);

    if (result.success) {
      return {
        available: true,
        version: result.stdout.trim(),
      };
    }

    return {
      available: false,
      error: result.stderr || 'Docker not found. Please install Docker CLI.',
    };
  }

  /**
   * Check if buildx is available
   */
  async checkBuildxAvailable(): Promise<{ available: boolean; version?: string; error?: string }> {
    const result = await this.execute(this.dockerPath, ['buildx', 'version']);

    if (result.success) {
      // Parse version from output like "github.com/docker/buildx v0.12.0 abc123"
      const versionMatch = result.stdout.match(/v[\d.]+/);
      return {
        available: true,
        version: versionMatch ? versionMatch[0] : result.stdout.trim(),
      };
    }

    return {
      available: false,
      error: result.stderr || 'Docker buildx not available. Please ensure Docker buildx plugin is installed.',
    };
  }

  /**
   * Get the status of the KubeAIRunway builder
   */
  async getBuilderStatus(): Promise<BuilderStatus> {
    // List all builders
    const result = await this.execute(this.dockerPath, ['buildx', 'ls']);

    if (!result.success) {
      return {
        exists: false,
        ready: false,
        name: BUILDKIT_CONFIG.builderName,
        driver: 'kubernetes',
        message: `Failed to list builders: ${result.stderr}`,
      };
    }

    // Parse builder list output
    // Format: "NAME/NODE       DRIVER/ENDPOINT  STATUS   BUILDKIT PLATFORMS"
    const lines = result.stdout.split('\n');
    let builderFound = false;
    let isRunning = false;

    for (const line of lines) {
      // Check for our builder name at the start of the line
      if (line.startsWith(BUILDKIT_CONFIG.builderName) || line.includes(`${BUILDKIT_CONFIG.builderName}*`)) {
        builderFound = true;
        // Check for running status
        if (line.toLowerCase().includes('running')) {
          isRunning = true;
        }
      }
      // Also check for builder node lines (indented with spaces)
      if (builderFound && line.includes('running')) {
        isRunning = true;
      }
    }

    if (!builderFound) {
      return {
        exists: false,
        ready: false,
        name: BUILDKIT_CONFIG.builderName,
        driver: 'kubernetes',
        message: 'Builder not found',
      };
    }

    return {
      exists: true,
      ready: isRunning,
      name: BUILDKIT_CONFIG.builderName,
      driver: 'kubernetes',
      message: isRunning ? 'Builder is ready' : 'Builder exists but is not running (needs bootstrap)',
    };
  }

  /**
   * Check if the builder is ready for builds
   */
  async isBuilderReady(): Promise<boolean> {
    const status = await this.getBuilderStatus();
    return status.exists && status.ready;
  }

  /**
   * Create the BuildKit builder with Kubernetes driver
   */
  async createBuilder(onStream?: StreamCallback): Promise<CommandResult> {
    logger.info({ builder: BUILDKIT_CONFIG.builderName }, 'Creating BuildKit builder with Kubernetes driver');

    const args = [
      'buildx', 'create',
      '--name', BUILDKIT_CONFIG.builderName,
      '--driver', 'kubernetes',
      '--driver-opt', `namespace=${BUILDKIT_CONFIG.namespace}`,
      '--driver-opt', `requests.cpu=${BUILDKIT_CONFIG.resources.cpu}`,
      '--driver-opt', `requests.memory=${BUILDKIT_CONFIG.resources.memory}`,
    ];

    const result = await this.execute(this.dockerPath, args, onStream);

    if (result.success) {
      logger.info({ builder: BUILDKIT_CONFIG.builderName }, 'BuildKit builder created successfully');
    } else {
      logger.error({ builder: BUILDKIT_CONFIG.builderName, error: result.stderr }, 'Failed to create BuildKit builder');
    }

    return result;
  }

  /**
   * Bootstrap the builder to ensure it's running
   */
  async bootstrapBuilder(onStream?: StreamCallback): Promise<CommandResult> {
    logger.info({ builder: BUILDKIT_CONFIG.builderName }, 'Bootstrapping BuildKit builder');

    const result = await this.execute(
      this.dockerPath,
      ['buildx', 'inspect', BUILDKIT_CONFIG.builderName, '--bootstrap'],
      onStream,
      120000 // 2 minute timeout for bootstrap
    );

    if (result.success) {
      logger.info({ builder: BUILDKIT_CONFIG.builderName }, 'BuildKit builder bootstrapped successfully');
    } else {
      logger.error({ builder: BUILDKIT_CONFIG.builderName, error: result.stderr }, 'Failed to bootstrap BuildKit builder');
    }

    return result;
  }

  /**
   * Remove the builder
   */
  async removeBuilder(onStream?: StreamCallback): Promise<CommandResult> {
    logger.info({ builder: BUILDKIT_CONFIG.builderName }, 'Removing BuildKit builder');

    const result = await this.execute(
      this.dockerPath,
      ['buildx', 'rm', BUILDKIT_CONFIG.builderName],
      onStream
    );

    if (result.success) {
      logger.info({ builder: BUILDKIT_CONFIG.builderName }, 'BuildKit builder removed successfully');
    } else {
      // Ignore errors if builder doesn't exist
      if (!result.stderr.includes('no builder') && !result.stderr.includes('not found')) {
        logger.error({ builder: BUILDKIT_CONFIG.builderName, error: result.stderr }, 'Failed to remove BuildKit builder');
      }
    }

    return result;
  }

  /**
   * Ensure the BuildKit builder exists and is ready
   * Creates and bootstraps the builder if it doesn't exist
   */
  async ensureBuilder(onStream?: StreamCallback): Promise<BuilderStatus> {
    logger.info('Ensuring BuildKit builder is ready');

    // Check Docker/buildx availability
    const dockerCheck = await this.checkDockerAvailable();
    if (!dockerCheck.available) {
      return {
        exists: false,
        ready: false,
        name: BUILDKIT_CONFIG.builderName,
        driver: 'kubernetes',
        message: dockerCheck.error || 'Docker not available',
      };
    }

    const buildxCheck = await this.checkBuildxAvailable();
    if (!buildxCheck.available) {
      return {
        exists: false,
        ready: false,
        name: BUILDKIT_CONFIG.builderName,
        driver: 'kubernetes',
        message: buildxCheck.error || 'Docker buildx not available',
      };
    }

    // Check current builder status
    let status = await this.getBuilderStatus();

    // Create builder if it doesn't exist
    if (!status.exists) {
      const createResult = await this.createBuilder(onStream);
      if (!createResult.success) {
        return {
          exists: false,
          ready: false,
          name: BUILDKIT_CONFIG.builderName,
          driver: 'kubernetes',
          message: `Failed to create builder: ${createResult.stderr}`,
        };
      }
    }

    // Bootstrap if not running
    status = await this.getBuilderStatus();
    if (!status.ready) {
      const bootstrapResult = await this.bootstrapBuilder(onStream);
      if (!bootstrapResult.success) {
        return {
          exists: true,
          ready: false,
          name: BUILDKIT_CONFIG.builderName,
          driver: 'kubernetes',
          message: `Failed to bootstrap builder: ${bootstrapResult.stderr}`,
        };
      }
    }

    // Final status check
    status = await this.getBuilderStatus();

    return status;
  }

  /**
   * Get the builder name for use in build commands
   */
  getBuilderName(): string {
    return BUILDKIT_CONFIG.builderName;
  }

  /**
   * Execute a buildx build command
   * This is the core build functionality for AIKit images
   */
  async build(options: {
    buildArg?: string;
    tags: string[];
    context: string;
    push?: boolean;
  }, onStream?: StreamCallback): Promise<CommandResult> {
    const args = [
      'buildx', 'build',
      '--builder', BUILDKIT_CONFIG.builderName,
    ];

    // Add build args
    if (options.buildArg) {
      args.push('--build-arg', options.buildArg);
    }

    // Add tags
    for (const tag of options.tags) {
      args.push('-t', tag);
    }

    // Add push flag with insecure registry support for local HTTP registry
    if (options.push) {
      // Use --output with registry.insecure=true to allow pushing to HTTP registries
      args.push('--output', `type=image,push=true,registry.insecure=true`);
    }

    // Add context (URL or path)
    args.push(options.context);

    logger.info({ tags: options.tags, context: options.context }, 'Starting buildx build');

    const result = await this.execute(
      this.dockerPath,
      args,
      onStream,
      600000 // 10 minute timeout for builds
    );

    if (result.success) {
      logger.info({ tags: options.tags }, 'Build completed successfully');
    } else {
      logger.error({ tags: options.tags, error: result.stderr }, 'Build failed');
    }

    return result;
  }
}

// Export singleton instance
export const buildKitService = new BuildKitService();
