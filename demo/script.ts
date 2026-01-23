/**
 * Narration script for KubeFoundry demo
 * All text content organized by phase
 */

export const NARRATION = {
  // ============================================
  // Phase 1: The Problem (CLI Phase)
  // ============================================

  intro: `Let me show you what deploying an LLM on Kubernetes typically looks like today.
This is the reality that platform engineers and ML operators face.`,

  dynamo: `This is a real NVIDIA Dynamo DynamoGraphDeployment from their official v0.8.1 recipes.
Nearly 280 lines of YAML for disaggregated serving with KV-cache routing.
You need 6 prefill workers, 2 decode workers, and a frontend router - that's 9 pods to coordinate.
It requires RDMA/InfiniBand networking, pre-provisioned PVCs, and deep knowledge of RoPE scaling.
Plus you need to manually create Secrets and configure Prometheus annotations.
Look at all those pain points highlighted in red.`,

  apply_attempt: `Let's try to apply this Dynamo deployment and see what happens...`,

  pending_pods: `And there it is. The pods are pending. GPU resource constraints.
Now we need to dig into kubectl describe, check events, verify node labels,
understand the kube-scheduler's decisions, and debug resource quotas.
This requires deep expertise in both Kubernetes AND ML infrastructure.`,

  transition: `There has to be a better way. What if we could abstract away all this complexity
while still leveraging these powerful open-source inference runtimes?`,

  // ============================================
  // Phase 2: The Solution (UI Phase)
  // ============================================

  kubefoundry_intro: `This is KubeFoundry. A single binary that provides a modern web UI
for deploying and managing LLMs on any Kubernetes cluster.
No installation required - just download, run, and open your browser.`,

  dashboard: `The interface is clean and intuitive.
You can see your cluster connection status, navigate between models, deployments, and settings.
Let's start by setting up the infrastructure.`,

  huggingface_login: `First, let's configure HuggingFace authentication.
Many popular models like Llama, Gemma, and Mistral are gated -
they require accepting a license agreement and authenticating with a token.
KubeFoundry stores this as a Kubernetes secret and uses it automatically during model pulls.
No manual secret creation or mounting required.`,

  installation: `First, we need to install an inference runtime. KubeFoundry supports three major open-source projects:
NVIDIA Dynamo for maximum throughput, KubeRay for distributed Ray-based serving,
and KAITO for flexible CPU and GPU inference.
Installing is one-click. KubeFoundry runs Helm under the hood and shows real-time progress.`,

  installation_progress: `Watch as the runtime installs.
We're deploying the operator, CRDs, and all necessary components automatically.`,

  installation_complete: `And we're done. The runtime is now installed and ready to serve models.
That was several Helm commands and configuration steps, reduced to a single click.`,

  models: `Now let's find a model. This is where KubeFoundry really shines.
We have a curated list of popular models ready to deploy.
Notice the GPU fit indicators next to each model. Green means it fits your cluster.
Yellow means it's tight. Red means it exceeds your available GPU memory.
KubeFoundry queries your cluster's actual GPU resources and estimates requirements based on model parameters.`,

  large_model_warning: `Look at the larger models like Llama 405B.
See that red indicator? That tells us immediately that this model won't fit on our cluster.
No more trial and error with kubectl apply - we know upfront what will work.
This saves hours of debugging failed deployments.`,

  deploy_start: `Let's deploy Qwen3. Click Deploy and watch how simple this is.`,

  deploy_config: `Configuring is straightforward. Select your runtime - we'll use Dynamo for maximum GPU throughput.
Keep the default settings for replicas and resources. KubeFoundry automatically applies sensible defaults
based on the model requirements and your cluster capacity.`,

  ai_configurator: `This is NVIDIA's AI Configurator - an intelligent optimization engine powered by
their expertise in GPU inference. Let's explore the different optimization modes.`,

  ai_optimizer_latency: `First, let's optimize for latency. This is where Dynamo's architecture really shines.
For real-time applications like chat or interactive UIs, minimizing time-to-first-token is critical.`,

  ai_optimizer_latency_result: `Look at this - the AI Configurator recommends disaggregated serving for low latency.
Disaggregated serving separates prefill and decode phases across different GPU workers.
Prefill processes your input prompt in parallel. Decode handles token generation sequentially.
By splitting these phases, we reduce queuing delays and improve responsiveness.
This is advanced ML infrastructure - and KubeFoundry exposes it with a simple toggle.`,

  ai_optimizer_settings_applied: `Look at the form fields - they now show the AI-optimized settings.
See the "Optimized" badges? These indicate values tuned by NVIDIA's AI Configurator.
The tensor parallelism, batch size, and memory allocation are all production-ready settings
derived from deep GPU inference expertise. No manual tuning required.`,

  ai_optimizer_throughput: `Now let's switch to throughput optimization. This mode maximizes tokens per second,
ideal for batch processing, offline jobs, and high-volume workloads.`,

  ai_optimizer_throughput_result: `The AI Configurator found an optimal throughput configuration.
Notice the different tensor parallelism and batch size settings compared to latency mode.
These production-ready settings are derived from NVIDIA's deep expertise in GPU inference.
For this demo, we'll deploy with vLLM using the default settings.`,

  pricing_estimator: `Now look at the cost estimate panel. This is real-time pricing pulled directly from
Azure's Retail Prices API. You can see the hourly and monthly costs for your deployment
based on the actual VM and GPU types in your cluster. No more guessing or spreadsheet calculations.
This helps platform teams make informed decisions about resource allocation and budgeting.`,

  deploy_submit: `Click Create Deployment. That's it.
No YAML, no kubectl, no manual secret creation, no resource calculations.`,

  monitoring: `Now let's watch the deployment.
The status updates in real-time. We can see the pods being created, the model being downloaded,
and the inference server starting up.`,

  monitoring_progress: `If something can't be scheduled - say, due to GPU constraints -
we show exactly why and provide actionable guidance. No more digging through kubectl describe output.`,

  deployment_ready: `And there it is. The model is running and ready to serve requests.
The entire process took a few clicks instead of hours of YAML wrangling.`,

  port_forward_intro: `Now let's prove it actually works. We'll port-forward to the service
and send a real chat completion request. This is the same OpenAI-compatible API
that any application can integrate with immediately.`,

  chat_response: `There's our response. The model is live, serving real inference requests.
From zero to running LLM in just a few clicks.`,

  // ============================================
  // KAITO CPU Inference
  // ============================================

  kaito_cpu_intro: `Now let me show you something really powerful - CPU-only inference with KAITO.
Not every workload needs expensive GPUs. For development, testing, or cost-sensitive deployments,
KAITO can run models entirely on CPU.`,

  kaito_cpu_deploy: `We're deploying the same model, but this time with KAITO using CPU inference.
No GPU required. This is perfect for clusters without GPU nodes or for reducing cloud costs.`,

  kaito_cpu_ready: `The KAITO CPU deployment is running. Same model, same API, but on standard compute.
This flexibility lets you optimize for cost or performance depending on your use case.`,

  kaito_port_forward_intro: `Let's prove the CPU inference works too. We'll port-forward to the KAITO service
and send a chat completion request - the exact same API as the GPU deployment.`,

  kaito_chat_response: `There it is - inference running entirely on CPU.
Same OpenAI-compatible API, but without requiring expensive GPU nodes.
Perfect for development, testing, or cost-sensitive workloads.`,

  api_access: `Every deployment exposes an OpenAI-compatible API.
Your applications can integrate immediately using the same SDK they use for OpenAI or Azure OpenAI.`,

  // ============================================
  // Closing
  // ============================================

  summary: `Let's recap what we've demonstrated today:
A unified interface for multiple open-source inference runtimes.
One-click installation via Helm.
Smart model discovery with GPU capacity awareness.
No-code deployment from model selection to running inference.
CPU-capable inference for cost optimization.
And standard OpenAI-compatible APIs for immediate integration.`,

  closing: `KubeFoundry bridges the gap between powerful open-source ML infrastructure
and the operators who need to use it.
It's vendor-neutral, works on any Kubernetes cluster including AKS,
and lets you leverage the best of NVIDIA Dynamo, KubeRay, and KAITO
without becoming an expert in each one.`,

  call_to_action: `We're looking to collect feedback, understand pain points,
and align on how this OSS approach can accelerate Microsoft Foundry
while letting customers bring their own compute.
Thank you for watching.`,
} as const;

export type NarrationKey = keyof typeof NARRATION;
