# KubeAIRunway Bug Bash - Scenario Testing Guide

Welcome to the KubeAIRunway bug bash! This guide walks you through real-world scenarios to test the platform. Work through each scenario as if you're a new user deploying ML models to Kubernetes.

## Before You Start

**What you'll need:**
- A Kubernetes cluster (any cloud or local like minikube/kind)
- Access to a web browser
- (Optional) A HuggingFace account for testing gated models like Llama
- (Optional) GPU nodes for GPU-accelerated inference

**Getting KubeAIRunway running:**
- Download from releases and run `./kubeairunway`, OR
- Deploy to your cluster with `kubectl apply -f deploy/kubernetes/kubeairunway.yaml`
- Open http://localhost:3001 in your browser

---

## Scenario 1: First-Time Setup 🚀

**Goal:** Set up KubeAIRunway from scratch and install your first runtime.

### Steps:

1. **Open KubeAIRunway**
   - Navigate to http://localhost:3001
   - ✅ The app loads without errors
   - ✅ You see the main dashboard or models page

2. **Check cluster connection**
   - Look at the header or sidebar for cluster status
   - ✅ Shows "Connected" with a green indicator
   - ✅ If disconnected, shows a clear warning message

3. **Go to the Installation page**
   - Click "Installation" in the sidebar
   - ✅ You see a list of available runtimes: NVIDIA Dynamo, KubeRay, KAITO
   - ✅ Each shows whether it's installed or not

4. **Install a runtime**
   - Pick one runtime (start with KAITO if you don't have GPUs, or Dynamo if you do)
   - Click the "Install" button
   - ✅ You see installation progress
   - ✅ After a minute or two, status changes to "Installed"
   - ✅ If installation fails, you see a clear error message

5. **Verify GPU setup (if applicable)**
   - If you have GPU nodes, check the GPU Operator section
   - ✅ Shows how many GPUs are available
   - ✅ Shows GPU memory if detectable

**🐛 Report any issues with:**
- App not loading
- Cluster connection errors
- Installation failures
- Confusing UI or missing information

---

## Scenario 2: Browsing and Finding Models 🔍

**Goal:** Explore the model catalog and find a model to deploy.

### Steps:

1. **Go to the Models page**
   - Click "Models" in the sidebar
   - ✅ You see a list of curated models
   - ✅ Each model shows name, size, and GPU requirements

2. **Browse curated models**
   - Scroll through the available models
   - ✅ Models are organized and easy to scan
   - ✅ Gated models (like Llama) are clearly marked with a lock icon

3. **Use the search filter**
   - Type "qwen" in the search box
   - ✅ Results filter as you type
   - ✅ Only matching models appear

4. **Search HuggingFace Hub**
   - Switch to the "Search HuggingFace" tab
   - Search for "mistral 7b"
   - ✅ Results load from HuggingFace
   - ✅ Each result shows downloads, likes, and estimated GPU memory
   - ✅ GPU fit indicators show if the model fits your cluster (✓, ⚠, ✗)

5. **Try different searches**
   - Search for: "llama", "phi", "gemma"
   - ✅ Results are relevant to your search
   - ✅ Pagination works if there are many results

**🐛 Report any issues with:**
- Models not loading
- Search not working
- GPU indicators incorrect
- Missing or wrong model information
- Slow performance

---

## Scenario 3: Connecting HuggingFace Account 🔐

**Goal:** Sign in with HuggingFace to access gated models like Llama.

### Steps:

1. **Go to Settings**
   - Click "Settings" in the sidebar
   - ✅ Settings page loads

2. **Find HuggingFace section**
   - Look for HuggingFace or authentication settings
   - ✅ You see a "Sign in with Hugging Face" button

3. **Start OAuth flow**
   - Click "Sign in with Hugging Face"
   - ✅ You're redirected to HuggingFace login page
   - ✅ You can authorize KubeAIRunway

4. **Complete sign-in**
   - After authorizing, you return to KubeAIRunway
   - ✅ Your HuggingFace username/avatar appears
   - ✅ Status shows "Connected"

5. **Verify token works**
   - Go back to Models and search for "meta-llama"
   - ✅ You can see and deploy gated Llama models

6. **Sign out (optional)**
   - Find and click the sign out option
   - ✅ HuggingFace connection is removed
   - ✅ Status updates to show not connected

**🐛 Report any issues with:**
- OAuth redirect not working
- Sign-in getting stuck
- Token not being saved
- Gated models still inaccessible after sign-in

---

## Scenario 4: Deploying Your First Model 🎯

**Goal:** Deploy a small model and see it running.

### Steps:

1. **Choose a small model**
   - Go to Models page
   - Find a small model like "Qwen3-0.6B" or "Phi-3-mini"
   - Click the "Deploy" button

2. **Configure deployment**
   - ✅ You see a deployment configuration form
   - ✅ Runtime selector shows installed runtimes only
   - Select your installed runtime
   - Keep default settings (1 replica, etc.)
   - Give it a name like "my-first-model"

3. **Create the deployment**
   - Click "Create Deployment" or "Deploy"
   - ✅ You see a success message
   - ✅ You're taken to the Deployments page

4. **Watch the deployment start**
   - Find your deployment in the list
   - ✅ Status shows "Pending" or "Deploying" initially
   - ✅ Status updates automatically (no manual refresh needed)
   - ✅ After a few minutes, status changes to "Running"

5. **Check deployment details**
   - Click on your deployment to see details
   - ✅ You see pod status information
   - ✅ Shows the model being served
   - ✅ Shows which runtime is being used

**🐛 Report any issues with:**
- Deploy button not working
- Form validation errors
- Deployment getting stuck
- Status not updating
- Missing information in deployment details

---

## Scenario 5: Deploying with Different Runtimes ⚡

**Goal:** Try deploying the same model with different runtimes.

*Skip this if you only have one runtime installed.*

### Steps:

1. **Deploy with NVIDIA Dynamo**
   - Select a model and choose Dynamo as runtime
   - Select vLLM engine
   - Deploy and verify it works

2. **Deploy with KubeRay**
   - Deploy the same or similar model
   - Choose KubeRay as runtime
   - Deploy and verify it works

3. **Deploy with KAITO (CPU)**
   - Choose a KAITO-compatible model
   - Select KAITO runtime with CPU compute type
   - ✅ Works even without GPU nodes!

4. **Compare in Deployments list**
   - Go to Deployments page
   - ✅ Each deployment shows which runtime it's using
   - ✅ Can easily identify Dynamo vs KubeRay vs KAITO deployments

**🐛 Report any issues with:**
- Runtime selection confusing
- Deployments failing for specific runtimes
- Runtime labels missing from deployment list

---

## Scenario 6: Managing Deployments 📋

**Goal:** View, monitor, and delete deployments.

### Steps:

1. **View all deployments**
   - Go to the Deployments page
   - ✅ All your deployments are listed
   - ✅ Shows status, runtime, replica count, and age

2. **Check a running deployment**
   - Click on a running deployment
   - ✅ See pod-level status (Running, Ready, etc.)
   - ✅ See restart counts if any

3. **Watch auto-refresh**
   - Keep the page open for a minute
   - ✅ Status updates automatically without refreshing

4. **Delete a deployment**
   - Click Delete on a deployment
   - ✅ You're asked to confirm
   - Confirm the deletion
   - ✅ Deployment is removed from the list
   - ✅ Kubernetes resources are cleaned up

**🐛 Report any issues with:**
- Deployment list not loading
- Details page missing info
- Delete not working
- Auto-refresh not happening or too aggressive

---

## Scenario 7: Handling Resource Constraints 🔧

**Goal:** See how the system handles deployments that can't be scheduled.

### Steps:

1. **Try to deploy a large model**
   - Find a model that requires more GPUs than you have
   - Try to deploy it

2. **Watch for pending status**
   - Deployment should be created but pods stay "Pending"
   - ✅ UI shows pending status clearly

3. **Check pending reasons**
   - View deployment details
   - ✅ Shows why pods can't be scheduled (e.g., "Insufficient GPU")
   - ✅ If autoscaler is configured, shows whether it can help

4. **Clean up**
   - Delete the pending deployment

**🐛 Report any issues with:**
- Unclear error messages
- Missing pending reasons
- Autoscaler information not showing

---

## Scenario 8: Error Scenarios 💥

**Goal:** Test how the app handles errors gracefully.

### Steps:

1. **Invalid deployment name**
   - Try creating a deployment with spaces or special characters
   - ✅ Form shows validation error before submitting
   - ✅ Error message explains what's wrong

2. **Deploy gated model without token**
   - Sign out of HuggingFace (if signed in)
   - Try to deploy a Llama model
   - ✅ Clear message about needing HuggingFace authentication

3. **Use uninstalled runtime**
   - On the deploy page, check if uninstalled runtimes are shown
   - ✅ Uninstalled runtimes are disabled or show guidance to install

4. **Network issues**
   - Open browser dev tools, go to Network tab
   - Throttle to "Slow 3G" or "Offline"
   - Try using the app
   - ✅ Loading states are shown
   - ✅ Error messages appear for failed requests
   - ✅ App doesn't crash

**🐛 Report any issues with:**
- Unhelpful error messages
- App crashing on errors
- Infinite loading states
- Errors not being caught

---

## Scenario 9: Navigation and UX 🎨

**Goal:** Test the overall user experience and navigation.

### Steps:

1. **Navigate through all pages**
   - Click: Models → Deployments → Installation → Settings
   - ✅ All pages load correctly
   - ✅ Active page is highlighted in sidebar
   - ✅ Browser back/forward buttons work

2. **Check empty states**
   - Go to Deployments with no deployments
   - ✅ Shows helpful empty state message
   - ✅ Suggests what to do next

3. **Test search with no results**
   - Search for "xyznonexistent123"
   - ✅ Shows "No results" message, not an error

4. **Check visual design**
   - ✅ Dark theme looks consistent
   - ✅ Text is readable (good contrast)
   - ✅ Icons and buttons are clear

5. **Try browser resize**
   - Resize browser window to different sizes
   - ✅ Layout adapts appropriately
   - ✅ No overlapping elements or broken layouts

**🐛 Report any issues with:**
- Broken navigation
- Poor visual design
- Accessibility issues
- Confusing UI elements

---

## Scenario 10: End-to-End Happy Path 🏆

**Goal:** Complete the full journey from setup to running model.

### Steps:

1. Start fresh (or with a new namespace)
2. Install a runtime from the Installation page
3. (Optional) Connect your HuggingFace account
4. Browse models and pick one to deploy
5. Configure and create the deployment
6. Wait for it to reach "Running" status
7. Access your model's API:
   ```bash
   # Port-forward to the service
   kubectl port-forward svc/<deployment-name> 8000:8000 -n <namespace>

   # Test the API
   curl http://localhost:8000/v1/models
   ```
8. Clean up: delete the deployment

**✅ Success criteria:**
- Entire flow completes without errors
- Model API responds to requests
- All UI feedback was clear and helpful

---

## What to Report

When you find a bug, please include:

**📝 Bug Report Template:**

```
**Summary:** [One-line description]

**Scenario:** [Which scenario were you testing?]

**Steps to reproduce:**
1.
2.
3.

**What happened:** [Describe the bug]

**What should happen:** [Expected behavior]

**Environment:**
- Browser:
- Kubernetes: (cloud/local, version)
- GPU: (yes/no, what type)

**Screenshot/Video:** [Attach if helpful]

**Severity:**
🔴 Critical - App crashes or data loss
🟠 High - Feature completely broken
🟡 Medium - Feature broken but has workaround
🟢 Low - Minor issue or cosmetic
```

---

## Quick Checklist

Use this for a quick pass through the main features:

- [ ] App loads and connects to cluster
- [ ] Can view Installation page and see runtimes
- [ ] Can install at least one runtime
- [ ] Can browse curated models
- [ ] Can search HuggingFace models
- [ ] GPU capacity indicators are shown (if applicable)
- [ ] Can configure and create a deployment
- [ ] Deployment status updates automatically
- [ ] Can view deployment details
- [ ] Can delete a deployment
- [ ] Error messages are clear and helpful
- [ ] Navigation works throughout the app
- [ ] Dark theme looks good
- [ ] No console errors in browser dev tools

