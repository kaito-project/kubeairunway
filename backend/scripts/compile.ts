#!/usr/bin/env bun
/**
 * Compile script with build-time constants injection
 * 
 * Usage:
 *   bun run scripts/compile.ts [--target=<target>] [--outfile=<name>] [--version=<version>]
 * 
 * Environment variables:
 *   VERSION - Version string (defaults to git tag, package.json version, or 'dev')
 *   GIT_COMMIT - Git commit hash (auto-detected if not set)
 */

import { $ } from 'bun';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';

const backendDir = dirname(import.meta.dir);
const rootDir = resolve(backendDir, '..');

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg?.split('=')[1];
};

const target = getArg('target');
const outfileName = getArg('outfile') || 'kubeairunway';
const versionArg = getArg('version');

// Build output path
const outfile = resolve(rootDir, 'dist', outfileName);

// Get version - priority: CLI arg > env var > git tag > package.json > 'dev'
async function getVersion(): Promise<string> {
  if (versionArg) return versionArg;
  if (process.env.VERSION) return process.env.VERSION;
  
  // Try git describe for tag
  try {
    const result = await $`git describe --tags --exact-match 2>/dev/null`.text();
    if (result.trim()) return result.trim();
  } catch {
    // Not on a tag, try closest tag
    try {
      const result = await $`git describe --tags --abbrev=0 2>/dev/null`.text();
      if (result.trim()) return result.trim();
    } catch {
      // No tags
    }
  }
  
  // Fall back to package.json version
  const pkgPath = resolve(backendDir, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = await Bun.file(pkgPath).json();
    if (pkg.version && pkg.version !== '0.0.0') {
      return `v${pkg.version}`;
    }
  }
  
  return 'dev';
}

// Get git commit hash
async function getGitCommit(): Promise<string> {
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT;
  
  try {
    const result = await $`git rev-parse --short HEAD 2>/dev/null`.text();
    return result.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

async function main() {
  const version = await getVersion();
  const gitCommit = await getGitCommit();
  const buildTime = new Date().toISOString();

  console.log('📦 Build info:');
  console.log(`   Version:    ${version}`);
  console.log(`   Git commit: ${gitCommit}`);
  console.log(`   Build time: ${buildTime}`);
  console.log(`   Target:     ${target || 'native'}`);
  console.log(`   Output:     ${outfile}`);
  console.log('');

  // Build the define flags for compile-time constant injection
  const defines = {
    '__VERSION__': JSON.stringify(version),
    '__BUILD_TIME__': JSON.stringify(buildTime),
    '__GIT_COMMIT__': JSON.stringify(gitCommit),
  };

  // Construct build command
  // Note: --bytecode is not used due to incompatibility with top-level await
  const buildArgs = [
    'build',
    '--compile',
    '--minify',
    '--sourcemap',
    `--outfile=${outfile}`,
  ];

  // Add target - use specified target for cross-compilation, otherwise default to bun
  if (target) {
    buildArgs.push(`--target=${target}`);
  } else {
    buildArgs.push('--target=bun');
  }

  // Add define flags - values need proper escaping for command line
  for (const [key, value] of Object.entries(defines)) {
    // The value is already JSON.stringify'd, so it has quotes
    buildArgs.push(`--define`, `${key}=${value}`);
  }

  // Add entry point
  buildArgs.push('src/index.ts');

  console.log(`🔨 Running: bun ${buildArgs.join(' ')}`);
  console.log('');

  // Run bun build
  const proc = Bun.spawn(['bun', ...buildArgs], {
    cwd: backendDir,
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const exitCode = await proc.exited;

  if (exitCode === 0) {
    console.log('');
    console.log(`✅ Build complete: ${outfile}`);
  } else {
    console.error('');
    console.error(`❌ Build failed with exit code ${exitCode}`);
    process.exit(exitCode);
  }
}

main().catch((err) => {
  console.error('Build script error:', err);
  process.exit(1);
});
