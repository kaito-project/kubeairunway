/**
 * Models Catalog Page
 *
 * Browse curated models and search HuggingFace models.
 */

import { useState, useEffect, useCallback } from 'react';
import { useHistory } from 'react-router-dom';
import {
  SectionBox,
  Loader,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { useApiClient } from '../lib/api-client';
import type { Model, HfModelSearchResult } from '@kubefoundry/shared';
import { ConnectionError } from '../components/ConnectionBanner';
import { getBadgeColors } from '../lib/theme';
import { ROUTES } from '../routes';

type TabType = 'curated' | 'huggingface';

/**
 * Helper to determine compute type from model data
 * CPU models have minGpus === 0 or undefined with GGUF-style IDs
 */
function getComputeType(model: Model): 'cpu' | 'gpu' {
  if (model.minGpus !== undefined && model.minGpus > 0) {
    return 'gpu';
  }
  // KAITO GGUF models are CPU-only (they use llama.cpp)
  if (model.id.startsWith('kaito/') && model.id.includes('-gguf')) {
    return 'cpu';
  }
  // Default to GPU for models that require hardware acceleration
  return model.minGpus === 0 ? 'cpu' : 'gpu';
}

export function ModelsCatalog() {
  const api = useApiClient();
  const history = useHistory();

  const [activeTab, setActiveTab] = useState<TabType>('curated');
  const [curatedModels, setCuratedModels] = useState<Model[]>([]);
  const [searchResults, setSearchResults] = useState<HfModelSearchResult[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch curated models from the models API (same as main frontend)
  const fetchCuratedModels = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await api.models.list();
      setCuratedModels(result.models);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch models');
    } finally {
      setLoading(false);
    }
  }, [api]);

  // Search HuggingFace
  const searchHuggingFace = useCallback(async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    setError(null);

    try {
      const result = await api.huggingFace.searchModels(searchQuery, { limit: 20 });
      setSearchResults(result.models);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [api, searchQuery]);

  // Initial fetch
  useEffect(() => {
    fetchCuratedModels();
  }, [fetchCuratedModels]);

  // Search on query change (debounced)
  useEffect(() => {
    if (activeTab !== 'huggingface') return;

    const timeout = setTimeout(() => {
      searchHuggingFace();
    }, 500);

    return () => clearTimeout(timeout);
  }, [searchQuery, activeTab, searchHuggingFace]);

  const tabs = [
    { id: 'curated' as const, label: 'Curated Models' },
    { id: 'huggingface' as const, label: 'HuggingFace Search' },
  ];

  return (
    <SectionBox title="Model Catalog">
      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '24px', borderBottom: '1px solid rgba(128, 128, 128, 0.3)' }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 16px',
              border: 'none',
              background: 'transparent',
              borderBottom: activeTab === tab.id ? '2px solid #1976d2' : '2px solid transparent',
              color: activeTab === tab.id ? '#1976d2' : 'inherit',
              opacity: activeTab === tab.id ? 1 : 0.7,
              cursor: 'pointer',
              fontWeight: activeTab === tab.id ? 500 : 400,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Curated Models Tab */}
      {activeTab === 'curated' && (
        <>
          {loading ? (
            <Loader title="Loading models..." />
          ) : error ? (
            <ConnectionError error={error} onRetry={fetchCuratedModels} />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
              {curatedModels.map((model) => {
                const computeType = getComputeType(model);
                return (
                  <div
                    key={model.id}
                    style={{
                      border: '1px solid rgba(128, 128, 128, 0.3)',
                      borderRadius: '8px',
                      padding: '16px',
                      backgroundColor: 'transparent',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <h3 style={{ margin: 0, fontSize: '16px' }}>{model.name}</h3>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          backgroundColor: getBadgeColors(computeType).bg,
                          color: getBadgeColors(computeType).color,
                          fontSize: '12px',
                        }}
                      >
                        {computeType.toUpperCase()}
                      </span>
                    </div>

                    <div style={{ fontSize: '14px', opacity: 0.7, marginBottom: '12px' }}>
                      <div>Size: {model.size}</div>
                      {model.license && <div>License: {model.license}</div>}
                    </div>

                    {model.description && (
                      <p style={{ fontSize: '13px', opacity: 0.6, marginBottom: '12px' }}>
                        {model.description}
                      </p>
                    )}

                    <button
                      onClick={() => history.push(`${ROUTES.CREATE_DEPLOYMENT}?modelId=${encodeURIComponent(model.id)}`)}
                      style={{
                        display: 'inline-block',
                        padding: '6px 12px',
                        backgroundColor: '#1976d2',
                        color: 'white',
                        borderRadius: '4px',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '14px',
                      }}
                    >
                      Deploy
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* HuggingFace Search Tab */}
      {activeTab === 'huggingface' && (
        <>
          <div style={{ marginBottom: '24px' }}>
            <input
              type="text"
              placeholder="Search HuggingFace models..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                maxWidth: '400px',
                padding: '10px 16px',
                border: '1px solid rgba(128, 128, 128, 0.3)',
                borderRadius: '4px',
                fontSize: '14px',
                backgroundColor: 'transparent',
                color: 'inherit',
              }}
            />
          </div>

          {searching ? (
            <Loader title="Searching..." />
          ) : error ? (
            <ConnectionError error={error} onRetry={searchHuggingFace} />
          ) : searchResults.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', opacity: 0.7 }}>
              {searchQuery ? 'No models found.' : 'Enter a search query to find models.'}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
              {searchResults.map((model) => (
                <div
                  key={model.id}
                  style={{
                    border: '1px solid rgba(128, 128, 128, 0.3)',
                    borderRadius: '8px',
                    padding: '16px',
                    backgroundColor: 'transparent',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <h3 style={{ margin: 0, fontSize: '14px', wordBreak: 'break-word', flex: 1 }}>
                      {model.id}
                    </h3>
                    {!model.compatible && (
                      <span style={{ padding: '2px 6px', backgroundColor: getBadgeColors('error').bg, color: getBadgeColors('error').color, fontSize: '11px', borderRadius: '4px', marginLeft: '8px' }}>
                        Incompatible
                      </span>
                    )}
                  </div>

                  <div style={{ fontSize: '13px', opacity: 0.7, marginBottom: '8px' }}>
                    <div>Downloads: {model.downloads?.toLocaleString() || 'N/A'}</div>
                    <div>Likes: {model.likes?.toLocaleString() || 'N/A'}</div>
                    {model.pipelineTag && <div>Task: {model.pipelineTag}</div>}
                    {model.estimatedGpuMemory && <div>GPU Memory: {model.estimatedGpuMemory}</div>}
                  </div>

                  {model.supportedEngines && model.supportedEngines.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px' }}>
                      {model.supportedEngines.map((engine) => (
                        <span
                          key={engine}
                          style={{
                            padding: '2px 6px',
                            backgroundColor: getBadgeColors('info').bg,
                            borderRadius: '4px',
                            fontSize: '11px',
                            color: getBadgeColors('info').color,
                          }}
                        >
                          {engine}
                        </span>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={() => history.push(`${ROUTES.CREATE_DEPLOYMENT}?modelId=${encodeURIComponent(model.id)}&source=huggingface`)}
                    style={{
                      display: 'inline-block',
                      padding: '6px 12px',
                      backgroundColor: model.compatible ? '#1976d2' : '#999',
                      color: 'white',
                      borderRadius: '4px',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '14px',
                    }}
                  >
                    Deploy
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </SectionBox>
  );
}
