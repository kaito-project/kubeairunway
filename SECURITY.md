# Security Policy

AI Runway takes the security of its software seriously. This document outlines
the security policy for the AI Runway project, including how to report
vulnerabilities, the disclosure timeline, and which versions receive security
updates.

This policy follows the [CNCF TAG Security](https://github.com/cncf/tag-security)
guidelines and the
[coordinated vulnerability disclosure](https://github.com/cncf/tag-security/blob/main/community/resources/co-ordinated-vulnerability-disclosure.md)
model.

---

## Supported Versions

Security fixes are applied to the following versions:

| Version | Supported          | Notes                          |
| ------- | ------------------ | ------------------------------ |
| 1.0.x   | :white_check_mark: | Current stable release         |
| < 1.0   | :x:                | Pre-release — no longer supported |

As a general rule, only the **latest minor release** receives security patches.
Critical vulnerabilities may be back-ported on a case-by-case basis at the
maintainers' discretion.

When a new minor version is released, the previous minor version will continue
to receive security updates for **30 days** after the new release date to allow
time for upgrades.

---

## Reporting a Vulnerability

> **Please do NOT report security vulnerabilities through public GitHub issues,
> discussions, or pull requests.**

If you believe you have found a security vulnerability in AI Runway, we
encourage you to report it responsibly using one of the following methods:

### Preferred: GitHub Private Vulnerability Reporting

Use GitHub's built-in
[private vulnerability reporting](https://github.com/AI-Runway/airunway/security/advisories/new)
feature. This creates a private advisory that only maintainers can see.

### Alternative: Email

Send an email to **security@airunway.dev** with the following information:

- **Subject line**: `[SECURITY] <brief description>`
- **Description** of the vulnerability
- **Steps to reproduce** (proof of concept if possible)
- **Affected component(s)** (frontend, backend, controller, Helm chart, CRD, etc.)
- **Affected version(s)**
- **Impact assessment** — what an attacker could achieve
- **Any suggested fix** (optional but appreciated)

### What to Include

To help us triage quickly, please provide as much of the following as possible:

1. **Type of issue** (e.g., RBAC bypass, container escape, injection, privilege
   escalation, information disclosure, denial of service)
2. **Full paths of source file(s)** related to the issue
3. **Location of the affected source code** (tag, branch, commit, or URL)
4. **Special configuration** required to reproduce
5. **Step-by-step instructions** to reproduce
6. **Proof-of-concept or exploit code** (if available)
7. **Impact** — what an attacker can do with this vulnerability
8. **CVSS score** (if you have calculated one)

### PGP Encryption (Optional)

If you need to encrypt your report, contact the security team at
security@airunway.dev to request the current PGP public key.

---

## Response & Disclosure Timeline

We follow a **coordinated disclosure** process aligned with the
[CNCF responsible disclosure guidelines](https://github.com/cncf/tag-security/blob/main/community/resources/co-ordinated-vulnerability-disclosure.md):

| Step | Action                                | Target SLA        |
| ---- | ------------------------------------- | ------------------ |
| 1    | **Acknowledgement** — confirm receipt of your report | ≤ 3 business days |
| 2    | **Triage** — assess severity, confirm validity, assign CVE (if applicable) | ≤ 10 business days |
| 3    | **Remediation** — develop, review, and test a fix | ≤ 30 calendar days (may vary with severity) |
| 4    | **Pre-disclosure notification** — notify known affected parties | ≤ 7 days before public disclosure |
| 5    | **Public disclosure** — publish advisory, release patched version | ≤ 90 calendar days from initial report |

### Severity-Based Targets

| Severity | CVSS Score | Fix Target       | Disclosure Target |
| -------- | ---------- | ---------------- | ----------------- |
| Critical | 9.0 – 10.0 | ≤ 7 days         | ≤ 14 days         |
| High     | 7.0 – 8.9  | ≤ 14 days        | ≤ 30 days         |
| Medium   | 4.0 – 6.9  | ≤ 30 days        | ≤ 60 days         |
| Low      | 0.1 – 3.9  | ≤ 60 days        | ≤ 90 days         |

> These are targets, not guarantees. Complex issues may require additional time.
> We will keep reporters informed of progress throughout the process.

### What to Expect

1. You will receive an acknowledgement with a tracking identifier.
2. We will work with you to understand and validate the issue.
3. We will request a CVE identifier (via GitHub or MITRE) when applicable.
4. We will develop a fix in a **private fork** to prevent premature disclosure.
5. We will coordinate with you on the public disclosure date.
6. Upon release, we will publish a
   [GitHub Security Advisory](https://docs.github.com/en/code-security/security-advisories)
   with full details, affected versions, and remediation steps.

---

## Security Advisories

Published security advisories are available at:
**[github.com/AI-Runway/airunway/security/advisories](https://github.com/AI-Runway/airunway/security/advisories)**

We recommend all users **watch the repository** for security advisory
notifications, or subscribe to the advisory RSS feed.

---

## Security-Related Configuration

AI Runway operates within Kubernetes clusters and handles model deployment
infrastructure. Operators should be aware of the following security
considerations:

### Kubernetes RBAC

The AI Runway controller requires specific RBAC permissions to manage
`ModelDeployment` CRDs. Follow the
[principle of least privilege](https://kubernetes.io/docs/concepts/security/rbac-good-practices/)
and restrict the controller's ServiceAccount to only the namespaces and
resources it needs.

### Network Policies

- Restrict ingress to the frontend/backend to trusted networks.
- Apply network policies to limit communication between inference engine pods
  and the control plane.
- If using the Gateway API Inference Extension, ensure HTTPRoute and gateway
  resources are properly secured.

### Container Security

- All official images are built from minimal base images.
- Run containers as non-root where possible.
- Use read-only root filesystems in production deployments.
- Scan images regularly with tools like
  [Trivy](https://github.com/aquasecurity/trivy) or
  [Grype](https://github.com/anchore/grype).

### Secrets Management

- Never store credentials or API keys in `ModelDeployment` manifests directly.
- Use Kubernetes Secrets (or an external secrets operator) for HuggingFace
  tokens, registry credentials, and other sensitive values.

---

## Security Best Practices for Contributors

If you are contributing code to AI Runway, please follow these practices:

- **No secrets in code** — never commit credentials, tokens, or private keys.
- **Input validation** — validate and sanitize all user inputs, especially
  model names, namespace references, and CRD field values.
- **Dependency management** — keep dependencies up to date; review new
  dependencies for known vulnerabilities before adding them.
- **Least privilege** — request only the Kubernetes permissions your feature
  requires.
- **Logging** — never log sensitive information (tokens, secrets, credentials).

---

## Scope

This security policy covers the following components:

| Component            | Repository Path | Description                                 |
| -------------------- | --------------- | ------------------------------------------- |
| Frontend             | `frontend/`     | Web UI (Vite + React)                       |
| Backend              | `backend/`      | API server (Bun)                            |
| Controller           | `controller/`   | Kubernetes CRD controller                   |
| Helm Charts          | `deploy/`       | Deployment manifests and Helm charts        |
| Headlamp Plugin      | `plugins/`      | Headlamp dashboard plugin                   |
| Provider Shims       | `providers/`    | Inference engine provider integrations       |
| Shared Libraries     | `shared/`       | Shared TypeScript packages                  |

### Out of Scope

The following are **not** covered by this policy:

- Vulnerabilities in upstream inference engines (vLLM, SGLang, TensorRT-LLM,
  llama.cpp) — report those to the respective projects.
- Vulnerabilities in Kubernetes itself — report to the
  [Kubernetes Security Team](https://kubernetes.io/docs/reference/issues-security/security/).
- Issues arising from misconfiguration of the user's Kubernetes cluster.
- Denial-of-service attacks against models at the inference layer.

If you are unsure whether an issue falls within scope, please report it anyway
and we will help determine the right course of action.

---

## Recognition

We value the security research community and are grateful to those who report
vulnerabilities responsibly. With your permission, we will acknowledge your
contribution in the security advisory and in a `SECURITY_ACKNOWLEDGEMENTS.md`
file.

---

## Policy Updates

This policy may be updated from time to time. Material changes will be
communicated via the repository's changelog or release notes. The latest version
is always available in this file on the default branch.

---

## Contact

- **Security reports**: security@airunway.dev or
  [GitHub Private Vulnerability Reporting](https://github.com/AI-Runway/airunway/security/advisories/new)
- **General questions about this policy**: Open a
  [GitHub Discussion](https://github.com/AI-Runway/airunway/discussions)

---

*This security policy is based on the
[CNCF TAG Security project template](https://github.com/cncf/tag-security/blob/main/community/resources/project-resources/templates/SECURITY.md)
and follows the principles of
[coordinated vulnerability disclosure](https://github.com/cncf/tag-security/blob/main/community/resources/co-ordinated-vulnerability-disclosure.md).*
