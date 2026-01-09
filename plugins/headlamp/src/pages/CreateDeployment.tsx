/**
 * Create Deployment Page
 *
 * Deploys a selected model with runtime and configuration options.
 * Matches the native UI flow - model is pre-selected from catalog.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import {
  SectionBox,
  Loader,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { useApiClient } from '../lib/api-client';
import { ROUTES } from '../routes';
import type { DeploymentConfig, Engine, Model, RuntimeStatus, ModelTask } from '@kubefoundry/shared';
import { getBadgeColors } from '../lib/theme';

type RuntimeId = 'kaito' | 'kuberay' | 'dynamo';

// Runtime metadata matching native UI
const RUNTIME_INFO: Record<RuntimeId, { name: string; description: string; defaultNamespace: string }> = {
  dynamo: {
    name: 'NVIDIA Dynamo',
    description: 'High-performance inference with KV-cache routing',
    defaultNamespace: 'dynamo-system',
  },
  kuberay: {
    name: 'KubeRay',
    description: 'Ray-based serving with autoscaling',
    defaultNamespace: 'kuberay-system',
  },
  kaito: {
    name: 'KAITO',
    description: 'Flexible inference with GGUF and vLLM support',
    defaultNamespace: 'kaito-workspace',
  },
};

// Engines supported by each runtime
const RUNTIME_ENGINES: Record<RuntimeId, Engine[]> = {
  dynamo: ['vllm', 'sglang', 'trtllm'],
  kuberay: ['vllm'],
  kaito: ['vllm', 'llamacpp'],
};

// Check runtime compatibility with model
function isRuntimeCompatible(runtimeId: RuntimeId, modelEngines: Engine[]): boolean {
  if (runtimeId === 'kaito') {
    return modelEngines.includes('llamacpp') || modelEngines.includes('vllm');
  }
  const runtimeEngines = RUNTIME_ENGINES[runtimeId];
  return modelEngines.some((e) => runtimeEngines.includes(e));
}

// Generate deployment name from model ID
function generateDeploymentName(modelId: string): string {
  return modelId
    .replace(/[/:.]/g, '-')
    .toLowerCase()
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 53);
}

export function CreateDeployment() {
  const api = useApiClient();
  const history = useHistory();
  const location = useLocation();

  // Parse URL params
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const modelIdFromUrl = searchParams.get('modelId');
  const sourceFromUrl = searchParams.get('source');
  const isHfSource = sourceFromUrl === 'huggingface' || sourceFromUrl === 'hf';

  // State
  const [model, setModel] = useState<Model | null>(null);
  const [runtimes, setRuntimes] = useState<RuntimeStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [selectedRuntime, setSelectedRuntime] = useState<RuntimeId>('kaito');
  const [engine, setEngine] = useState<Engine>('vllm');
  const [name, setName] = useState('');
  const [namespace, setNamespace] = useState('kaito-workspace');
  const [replicas, setReplicas] = useState(1);
  const [gpuCount, setGpuCount] = useState(1);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [contextLength, setContextLength] = useState<number | undefined>(undefined);
  const [enforceEager, setEnforceEager] = useState(true);
  const [trustRemoteCode, setTrustRemoteCode] = useState(false);

  // Load model and runtime data
  useEffect(() => {
    async function loadData() {
      if (!modelIdFromUrl) {
        setLoading(false);
        return;
      }

      try {
        const [runtimesResult] = await Promise.all([
          api.runtimes.getStatus(),
        ]);
        setRuntimes(runtimesResult.runtimes);

        // Fetch model details
        if (isHfSource) {
          // For HuggingFace models, search to get full details
          const searchResult = await api.huggingFace.searchModels(modelIdFromUrl, { limit: 1 });
          if (searchResult.models.length > 0) {
            const hfModel = searchResult.models[0];
            // Convert HfModelSearchResult to Model format
            setModel({
              id: hfModel.id,
              name: hfModel.name || hfModel.id.split('/').pop() || hfModel.id,
              description: '',
              size: hfModel.estimatedGpuMemory || 'Unknown',
              minGpuMemory: hfModel.estimatedGpuMemory || 'N/A',
              estimatedGpuMemory: hfModel.estimatedGpuMemory,
              estimatedGpuMemoryGb: hfModel.estimatedGpuMemoryGb,
              task: (hfModel.pipelineTag || 'text-generation') as ModelTask,
              supportedEngines: hfModel.supportedEngines,
              gated: hfModel.gated,
              fromHfSearch: true,
            });
          }
        } else {
          // For curated models
          const modelsResult = await api.models.list();
          const foundModel = modelsResult.models.find((m) => m.id === modelIdFromUrl);
          if (foundModel) {
            setModel(foundModel);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [api, modelIdFromUrl, isHfSource]);

  // Set defaults when model loads
  useEffect(() => {
    if (model) {
      // Generate deployment name
      if (!name) {
        setName(generateDeploymentName(model.id));
      }

      // Select best runtime
      const compatibleRuntimes: RuntimeId[] = ['dynamo', 'kuberay', 'kaito'];
      for (const rtId of compatibleRuntimes) {
        const rt = runtimes.find((r) => r.id === rtId);
        if (rt?.installed && isRuntimeCompatible(rtId, model.supportedEngines)) {
          setSelectedRuntime(rtId);
          setNamespace(RUNTIME_INFO[rtId].defaultNamespace);
          break;
        }
      }

      // Select best engine
      const availableEngines = model.supportedEngines.filter(
        (e) => RUNTIME_ENGINES[selectedRuntime]?.includes(e)
      );
      if (availableEngines.length > 0 && !availableEngines.includes(engine)) {
        setEngine(availableEngines[0]);
      }

      // Set GPU recommendation based on model
      if (model.estimatedGpuMemoryGb) {
        const recommendedGpus = Math.ceil(model.estimatedGpuMemoryGb / 80); // A100 80GB
        setGpuCount(Math.max(1, recommendedGpus));
      }
    }
  }, [model, runtimes, name, selectedRuntime, engine]);

  // Update namespace when runtime changes
  useEffect(() => {
    setNamespace(RUNTIME_INFO[selectedRuntime].defaultNamespace);
  }, [selectedRuntime]);

  // Handle runtime change
  const handleRuntimeChange = useCallback((runtime: RuntimeId) => {
    setSelectedRuntime(runtime);
    // Reset engine if not compatible
    if (model) {
      const availableEngines = model.supportedEngines.filter(
        (e) => RUNTIME_ENGINES[runtime]?.includes(e)
      );
      if (availableEngines.length > 0 && !availableEngines.includes(engine)) {
        setEngine(availableEngines[0]);
      }
    }
  }, [model, engine]);

  // Submit deployment
  const handleSubmit = useCallback(async () => {
    if (!model) return;

    setSubmitting(true);
    setError(null);

    try {
      const config: DeploymentConfig = {
        name,
        namespace,
        modelId: model.id,
        engine,
        mode: 'aggregated',
        provider: selectedRuntime,
        routerMode: 'none',
        replicas,
        hfTokenSecret: model.gated ? 'hf-token-secret' : '',
        enforceEager,
        enablePrefixCaching: false,
        trustRemoteCode,
        contextLength,
        resources: {
          gpu: gpuCount,
        },
      };

      await api.deployments.create(config);
      history.push(ROUTES.DEPLOYMENTS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create deployment');
    } finally {
      setSubmitting(false);
    }
  }, [api, model, name, namespace, engine, selectedRuntime, replicas, gpuCount, contextLength, enforceEager, trustRemoteCode, history]);

  // Get available engines for selected runtime
  const availableEngines = useMemo(() => {
    if (!model) return [];
    return model.supportedEngines.filter((e) => RUNTIME_ENGINES[selectedRuntime]?.includes(e));
  }, [model, selectedRuntime]);

  if (loading) {
    return <Loader title="Loading model..." />;
  }

  // No model selected - show message to go to catalog
  if (!model) {
    return (
      <SectionBox title="Create Deployment">
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🤖</div>
          <h2 style={{ marginBottom: '8px' }}>No Model Selected</h2>
          <p style={{ opacity: 0.7, marginBottom: '24px' }}>
            Please select a model from the catalog to deploy.
          </p>
          <button
            onClick={() => history.push(ROUTES.MODELS)}
            style={{
              padding: '12px 24px',
              backgroundColor: '#1976d2',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Go to Model Catalog
          </button>
        </div>
      </SectionBox>
    );
  }

  const selectedRuntimeInfo = runtimes.find((r) => r.id === selectedRuntime);
  const isRuntimeInstalled = selectedRuntimeInfo?.installed ?? false;

  return (
    <SectionBox title="Deploy Model">
      {/* Back button */}
      <div style={{ marginBottom: '24px' }}>
        <button
          onClick={() => history.push(ROUTES.MODELS)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 0',
            background: 'none',
            border: 'none',
            color: 'inherit',
            cursor: 'pointer',
            opacity: 0.7,
          }}
        >
          ← Back to Catalog
        </button>
      </div>

      {error && (
        <div style={{ padding: '12px', backgroundColor: 'rgba(198, 40, 40, 0.15)', color: '#f44336', borderRadius: '4px', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      {/* Model Summary Card */}
      <div style={{
        border: '1px solid rgba(128, 128, 128, 0.3)',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '24px',
        backgroundColor: 'rgba(128, 128, 128, 0.05)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
          <div>
            <h2 style={{ margin: 0, marginBottom: '4px' }}>{model.name}</h2>
            <div style={{ fontSize: '13px', opacity: 0.7, fontFamily: 'monospace' }}>{model.id}</div>
            {model.gated && (
              <span style={{
                display: 'inline-block',
                marginTop: '8px',
                padding: '2px 8px',
                backgroundColor: getBadgeColors('warning').bg,
                color: getBadgeColors('warning').color,
                borderRadius: '4px',
                fontSize: '12px',
              }}>
                🔒 Gated Model
              </span>
            )}
          </div>
          <span style={{
            padding: '4px 12px',
            border: '1px solid rgba(128, 128, 128, 0.3)',
            borderRadius: '4px',
            fontSize: '14px',
            fontWeight: 500,
          }}>
            {model.size}
          </span>
        </div>

        {model.description && (
          <p style={{ margin: '12px 0', opacity: 0.8, fontSize: '14px' }}>{model.description}</p>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '14px', opacity: 0.7 }}>
          {model.estimatedGpuMemory && (
            <div>GPU: ~{model.estimatedGpuMemory}</div>
          )}
          {model.contextLength && (
            <div>Context: {model.contextLength.toLocaleString()}</div>
          )}
          <div style={{ textTransform: 'capitalize' }}>{model.task?.replace('-', ' ') || 'Text Generation'}</div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '12px' }}>
          {model.supportedEngines.map((eng) => (
            <span
              key={eng}
              style={{
                padding: '2px 8px',
                backgroundColor: getBadgeColors('info').bg,
                color: getBadgeColors('info').color,
                borderRadius: '4px',
                fontSize: '12px',
              }}
            >
              {eng.toUpperCase()}
            </span>
          ))}
        </div>
      </div>

      {/* Runtime Selection */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          🖥️ Runtime
        </h3>
        <div style={{ display: 'grid', gap: '12px', maxWidth: '600px' }}>
          {(['kaito', 'kuberay', 'dynamo'] as const).map((rtId) => {
            const info = RUNTIME_INFO[rtId];
            const rtStatus = runtimes.find((r) => r.id === rtId);
            const isInstalled = rtStatus?.installed ?? false;
            const isCompatible = isRuntimeCompatible(rtId, model.supportedEngines);
            const isSelected = selectedRuntime === rtId;
            const isDisabled = !isInstalled || !isCompatible;

            return (
              <div
                key={rtId}
                onClick={() => !isDisabled && handleRuntimeChange(rtId)}
                style={{
                  padding: '16px',
                  border: isSelected ? '2px solid #1976d2' : '1px solid rgba(128, 128, 128, 0.3)',
                  borderRadius: '8px',
                  backgroundColor: isSelected ? 'rgba(25, 118, 210, 0.1)' : 'transparent',
                  cursor: isDisabled ? 'not-allowed' : 'pointer',
                  opacity: isDisabled ? 0.5 : 1,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      border: isSelected ? '2px solid #1976d2' : '2px solid rgba(128, 128, 128, 0.5)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      {isSelected && <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#1976d2' }} />}
                    </div>
                    <span style={{ fontWeight: 500 }}>{info.name}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {!isCompatible && (
                      <span style={{ padding: '2px 8px', backgroundColor: getBadgeColors('neutral').bg, borderRadius: '4px', fontSize: '12px' }}>
                        Not Compatible
                      </span>
                    )}
                    <span style={{
                      padding: '2px 8px',
                      backgroundColor: isInstalled ? getBadgeColors('success').bg : getBadgeColors('error').bg,
                      color: isInstalled ? getBadgeColors('success').color : getBadgeColors('error').color,
                      borderRadius: '4px',
                      fontSize: '12px',
                    }}>
                      {isInstalled ? '✓ Installed' : 'Not Installed'}
                    </span>
                  </div>
                </div>
                <p style={{ margin: 0, marginLeft: '32px', fontSize: '13px', opacity: 0.7 }}>{info.description}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Engine Selection */}
      {availableEngines.length > 0 && selectedRuntime !== 'kaito' && (
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ marginBottom: '12px' }}>⚙️ Inference Engine</h3>
          <div style={{ display: 'flex', gap: '12px' }}>
            {availableEngines.map((eng) => (
              <button
                key={eng}
                onClick={() => setEngine(eng)}
                style={{
                  padding: '10px 20px',
                  border: engine === eng ? '2px solid #1976d2' : '1px solid rgba(128, 128, 128, 0.3)',
                  borderRadius: '8px',
                  backgroundColor: engine === eng ? 'rgba(25, 118, 210, 0.1)' : 'transparent',
                  color: 'inherit',
                  cursor: 'pointer',
                  fontWeight: engine === eng ? 500 : 400,
                }}
              >
                {eng === 'vllm' && 'vLLM'}
                {eng === 'sglang' && 'SGLang'}
                {eng === 'trtllm' && 'TensorRT-LLM'}
                {eng === 'llamacpp' && 'llama.cpp'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Basic Configuration */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ marginBottom: '12px' }}>📝 Basic Configuration</h3>
        <div style={{ display: 'grid', gap: '16px', maxWidth: '500px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Deployment Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid rgba(128, 128, 128, 0.3)',
                  borderRadius: '4px',
                  backgroundColor: 'transparent',
                  color: 'inherit',
                }}
              />
              <div style={{ fontSize: '12px', opacity: 0.6, marginTop: '4px' }}>
                Lowercase letters, numbers, and hyphens only
              </div>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Namespace</label>
              <input
                type="text"
                value={namespace}
                onChange={(e) => setNamespace(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid rgba(128, 128, 128, 0.3)',
                  borderRadius: '4px',
                  backgroundColor: 'transparent',
                  color: 'inherit',
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Deployment Options */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ marginBottom: '12px' }}>🚀 Deployment Options</h3>
        <div style={{ display: 'grid', gap: '16px', maxWidth: '500px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>
                Replicas
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={replicas}
                onChange={(e) => setReplicas(parseInt(e.target.value) || 1)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid rgba(128, 128, 128, 0.3)',
                  borderRadius: '4px',
                  backgroundColor: 'transparent',
                  color: 'inherit',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>
                GPUs per Replica
                {model.estimatedGpuMemoryGb && gpuCount === Math.ceil(model.estimatedGpuMemoryGb / 80) && (
                  <span style={{
                    marginLeft: '8px',
                    padding: '2px 6px',
                    backgroundColor: getBadgeColors('info').bg,
                    color: getBadgeColors('info').color,
                    borderRadius: '4px',
                    fontSize: '11px',
                  }}>
                    ✨ Recommended
                  </span>
                )}
              </label>
              <input
                type="number"
                min={0}
                max={8}
                value={gpuCount}
                onChange={(e) => setGpuCount(parseInt(e.target.value) || 0)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid rgba(128, 128, 128, 0.3)',
                  borderRadius: '4px',
                  backgroundColor: 'transparent',
                  color: 'inherit',
                }}
              />
              {model.estimatedGpuMemory && (
                <div style={{ fontSize: '12px', opacity: 0.6, marginTop: '4px' }}>
                  Model needs ~{model.estimatedGpuMemory}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Advanced Options */}
      <div style={{ marginBottom: '24px' }}>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 0',
            background: 'none',
            border: 'none',
            color: 'inherit',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          <span style={{ transform: showAdvanced ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▶</span>
          Advanced Options
        </button>

        {showAdvanced && (
          <div style={{ marginTop: '16px', paddingLeft: '16px', borderLeft: '2px solid rgba(128, 128, 128, 0.3)' }}>
            <div style={{ display: 'grid', gap: '16px', maxWidth: '500px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Context Length (optional)</label>
                <input
                  type="number"
                  placeholder={model.contextLength?.toString() || 'Default'}
                  value={contextLength || ''}
                  onChange={(e) => setContextLength(e.target.value ? parseInt(e.target.value) : undefined)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid rgba(128, 128, 128, 0.3)',
                    borderRadius: '4px',
                    backgroundColor: 'transparent',
                    color: 'inherit',
                  }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input
                  type="checkbox"
                  id="enforceEager"
                  checked={enforceEager}
                  onChange={(e) => setEnforceEager(e.target.checked)}
                  style={{ width: '18px', height: '18px' }}
                />
                <label htmlFor="enforceEager">
                  <div style={{ fontWeight: 500 }}>Enforce Eager Mode</div>
                  <div style={{ fontSize: '13px', opacity: 0.7 }}>Use eager mode for faster startup</div>
                </label>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input
                  type="checkbox"
                  id="trustRemoteCode"
                  checked={trustRemoteCode}
                  onChange={(e) => setTrustRemoteCode(e.target.checked)}
                  style={{ width: '18px', height: '18px' }}
                />
                <label htmlFor="trustRemoteCode">
                  <div style={{ fontWeight: 500 }}>Trust Remote Code</div>
                  <div style={{ fontSize: '13px', opacity: 0.7 }}>Required for some models with custom code</div>
                </label>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Submit Section */}
      <div style={{
        display: 'flex',
        gap: '12px',
        paddingTop: '24px',
        borderTop: '1px solid rgba(128, 128, 128, 0.3)',
      }}>
        <button
          onClick={() => history.push(ROUTES.MODELS)}
          style={{
            padding: '12px 24px',
            backgroundColor: 'transparent',
            border: '1px solid rgba(128, 128, 128, 0.3)',
            borderRadius: '4px',
            cursor: 'pointer',
            color: 'inherit',
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting || !isRuntimeInstalled || !name}
          style={{
            flex: 1,
            padding: '12px 24px',
            backgroundColor: submitting || !isRuntimeInstalled ? '#999' : '#2e7d32',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: submitting || !isRuntimeInstalled ? 'not-allowed' : 'pointer',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}
        >
          {submitting ? (
            <>⏳ Creating...</>
          ) : !isRuntimeInstalled ? (
            <>⚠️ Runtime Not Installed</>
          ) : (
            <>🚀 Deploy Model</>
          )}
        </button>
      </div>
    </SectionBox>
  );
}
