# Observability

## Metrics

The controller exposes Prometheus metrics:

```
# Controller metrics
kubeairunway_modeldeployment_total{namespace, phase}
kubeairunway_reconciliation_duration_seconds{provider}
kubeairunway_reconciliation_errors_total{provider, error_type}
kubeairunway_provider_selection{provider, reason}

# Deployment metrics
kubeairunway_deployment_replicas{name, namespace, state}
kubeairunway_deployment_phase{name, namespace, phase}
```

## Kubernetes Events

```yaml
Events:
  Type    Reason              Message
  ----    ------              -------
  Normal  ProviderSelected    Selected provider 'dynamo': matched capabilities: engine=vllm, gpu=true, mode=aggregated
  Normal  ResourceCreated     Created DynamoGraphDeployment 'my-llm'
  Warning SecretNotFound      Secret 'hf-token-secret' not found in namespace 'default'
  Warning ProviderError       Provider resource in error state: insufficient GPUs
  Warning DriftDetected       Provider resource was modified directly, reconciling
  Warning FinalizerTimeout    Finalizer removed after timeout, provider resource may be orphaned
```

## See also

- [Architecture Overview](architecture.md)
- [Controller Architecture](controller-architecture.md)
