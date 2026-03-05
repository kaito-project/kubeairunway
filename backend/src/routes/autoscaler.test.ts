import { describe, test, expect, afterEach } from 'bun:test';
import app from '../hono-app';
import { autoscalerService } from '../services/autoscaler';
import { mockServiceMethod } from '../test/helpers';
import {
  autoscalerDetectionAKS,
  autoscalerDetectionCA,
  autoscalerDetectionNone,
  autoscalerStatus,
} from '../test/fixtures';

describe('Autoscaler Routes', () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  describe('GET /api/autoscaler/detection', () => {
    test('returns AKS managed autoscaler detection', async () => {
      restore = mockServiceMethod(autoscalerService, 'detectAutoscaler', (() =>
        Promise.resolve(autoscalerDetectionAKS)) as typeof autoscalerService.detectAutoscaler);

      const res = await app.request('/api/autoscaler/detection');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.type).toBe('aks-managed');
      expect(data.detected).toBe(true);
      expect(data.healthy).toBe(true);
      expect(data.nodeGroupCount).toBe(2);
    });

    test('returns cluster-autoscaler detection', async () => {
      restore = mockServiceMethod(autoscalerService, 'detectAutoscaler', (() =>
        Promise.resolve(autoscalerDetectionCA)) as typeof autoscalerService.detectAutoscaler);

      const res = await app.request('/api/autoscaler/detection');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.type).toBe('cluster-autoscaler');
      expect(data.detected).toBe(true);
      expect(data.healthy).toBe(true);
      expect(data.nodeGroupCount).toBe(3);
    });

    test('returns no autoscaler detection', async () => {
      restore = mockServiceMethod(autoscalerService, 'detectAutoscaler', (() =>
        Promise.resolve(autoscalerDetectionNone)) as typeof autoscalerService.detectAutoscaler);

      const res = await app.request('/api/autoscaler/detection');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.type).toBe('none');
      expect(data.detected).toBe(false);
      expect(data.healthy).toBe(false);
    });

    test('returns 500 on service error', async () => {
      restore = mockServiceMethod(autoscalerService, 'detectAutoscaler', (() =>
        Promise.reject(new Error('detection failed'))) as typeof autoscalerService.detectAutoscaler);

      const res = await app.request('/api/autoscaler/detection');
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBeDefined();
      expect(data.error.message).toBe('detection failed');
      expect(data.error.statusCode).toBe(500);
    });
  });

  describe('GET /api/autoscaler/status', () => {
    test('returns autoscaler status', async () => {
      restore = mockServiceMethod(autoscalerService, 'getAutoscalerStatus', (() =>
        Promise.resolve(autoscalerStatus)) as typeof autoscalerService.getAutoscalerStatus);

      const res = await app.request('/api/autoscaler/status');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.health).toBe('Healthy');
      expect(data.nodeGroups).toBeDefined();
      expect(data.nodeGroups.length).toBe(2);
    });

    test('returns 404 when status is null', async () => {
      restore = mockServiceMethod(autoscalerService, 'getAutoscalerStatus', (() =>
        Promise.resolve(null)) as typeof autoscalerService.getAutoscalerStatus);

      const res = await app.request('/api/autoscaler/status');
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBeDefined();
      expect(data.error.message).toBe('Autoscaler status not available');
      expect(data.error.statusCode).toBe(404);
    });

    test('returns 500 on service error', async () => {
      restore = mockServiceMethod(autoscalerService, 'getAutoscalerStatus', (() =>
        Promise.reject(new Error('status failed'))) as typeof autoscalerService.getAutoscalerStatus);

      const res = await app.request('/api/autoscaler/status');
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBeDefined();
      expect(data.error.message).toBe('status failed');
      expect(data.error.statusCode).toBe(500);
    });
  });
});
