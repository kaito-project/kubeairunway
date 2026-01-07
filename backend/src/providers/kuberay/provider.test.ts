import { describe, test, expect } from 'bun:test';
import { KubeRayProvider } from './index';
import type { DeploymentConfig } from '@kubefoundry/shared';

const provider = new KubeRayProvider();

describe('KubeRayProvider', () => {
  describe('provider info', () => {
    test('has correct id and name', () => {
      expect(provider.id).toBe('kuberay');
      expect(provider.name).toBe('KubeRay');
    });

    test('has default namespace', () => {
      expect(provider.defaultNamespace).toBe('kuberay');
    });
  });

  describe('getCRDConfig', () => {
    test('returns correct CRD configuration', () => {
      const config = provider.getCRDConfig();
      expect(config.apiGroup).toBe('ray.io');
      expect(config.apiVersion).toBe('v1');
      expect(config.plural).toBe('rayservices');
      expect(config.kind).toBe('RayService');
    });
  });

  describe('GAIE (Gateway API Inference Extension) support', () => {
    test('supportsGAIE returns true', () => {
      expect(provider.supportsGAIE()).toBe(true);
    });

    test('generateHTTPRoute creates valid HTTPRoute manifest', () => {
      const config: DeploymentConfig = {
        name: 'test-deployment',
        namespace: 'test-ns',
        modelId: 'meta-llama/Llama-3.2-1B',
        engine: 'vllm',
        mode: 'aggregated',
        routerMode: 'none',
        replicas: 1,
        hfTokenSecret: 'hf-token',
        enforceEager: true,
        enablePrefixCaching: false,
        trustRemoteCode: false,
        enableGatewayRouting: true,
      };

      const httpRoute = provider.generateHTTPRoute!(config);

      expect(httpRoute.apiVersion).toBe('gateway.networking.k8s.io/v1');
      expect(httpRoute.kind).toBe('HTTPRoute');
      expect((httpRoute.metadata as any).name).toBe('test-deployment-route');
      expect((httpRoute.metadata as any).namespace).toBe('test-ns');
    });

    test('HTTPRoute uses model name from config', () => {
      const config: DeploymentConfig = {
        name: 'test-deployment',
        namespace: 'test-ns',
        modelId: 'meta-llama/Llama-3.2-1B',
        engine: 'vllm',
        mode: 'aggregated',
        routerMode: 'none',
        replicas: 1,
        hfTokenSecret: 'hf-token',
        enforceEager: true,
        enablePrefixCaching: false,
        trustRemoteCode: false,
        enableGatewayRouting: true,
      };

      const httpRoute = provider.generateHTTPRoute!(config);
      const rules = (httpRoute.spec as any).rules;
      const headerMatch = rules[0].matches[0].headers[0];

      expect(headerMatch.name).toBe('X-Gateway-Model-Name');
      expect(headerMatch.value).toBe('meta-llama/Llama-3.2-1B');
      expect(headerMatch.type).toBe('Exact');
    });

    test('HTTPRoute uses servedModelName when provided', () => {
      const config: DeploymentConfig = {
        name: 'test-deployment',
        namespace: 'test-ns',
        modelId: 'meta-llama/Llama-3.2-1B',
        servedModelName: 'llama-1b',
        engine: 'vllm',
        mode: 'aggregated',
        routerMode: 'none',
        replicas: 1,
        hfTokenSecret: 'hf-token',
        enforceEager: true,
        enablePrefixCaching: false,
        trustRemoteCode: false,
        enableGatewayRouting: true,
      };

      const httpRoute = provider.generateHTTPRoute!(config);
      const rules = (httpRoute.spec as any).rules;
      const headerMatch = rules[0].matches[0].headers[0];

      expect(headerMatch.value).toBe('llama-1b');
    });

    test('HTTPRoute has correct backend reference with -serve-svc suffix', () => {
      const config: DeploymentConfig = {
        name: 'my-model',
        namespace: 'test-ns',
        modelId: 'meta-llama/Llama-3.2-1B',
        engine: 'vllm',
        mode: 'aggregated',
        routerMode: 'none',
        replicas: 1,
        hfTokenSecret: 'hf-token',
        enforceEager: true,
        enablePrefixCaching: false,
        trustRemoteCode: false,
        enableGatewayRouting: true,
      };

      const httpRoute = provider.generateHTTPRoute!(config);
      const backendRefs = (httpRoute.spec as any).rules[0].backendRefs;

      expect(backendRefs).toHaveLength(1);
      expect(backendRefs[0].name).toBe('my-model-serve-svc');
      expect(backendRefs[0].port).toBe(8000);
    });

    test('HTTPRoute has kubefoundry labels with kuberay provider', () => {
      const config: DeploymentConfig = {
        name: 'test-deployment',
        namespace: 'test-ns',
        modelId: 'meta-llama/Llama-3.2-1B',
        engine: 'vllm',
        mode: 'aggregated',
        routerMode: 'none',
        replicas: 1,
        hfTokenSecret: 'hf-token',
        enforceEager: true,
        enablePrefixCaching: false,
        trustRemoteCode: false,
        enableGatewayRouting: true,
      };

      const httpRoute = provider.generateHTTPRoute!(config);
      const labels = (httpRoute.metadata as any).labels;

      expect(labels['app.kubernetes.io/name']).toBe('kubefoundry');
      expect(labels['app.kubernetes.io/instance']).toBe('test-deployment');
      expect(labels['app.kubernetes.io/managed-by']).toBe('kubefoundry');
      expect(labels['kubefoundry.io/provider']).toBe('kuberay');
    });
  });
});
