---
description: >
  Auto-generates an OpenVEX statement for a dismissed Dependabot alert when
  explicit maintainer-provided VEX metadata is available. Provide the alert
  details as inputs — the agent generates a standards-compliant OpenVEX
  document and opens a PR.

on:
  workflow_dispatch:
    inputs:
      alert_number:
        description: "Dependabot alert number"
        required: true
        type: string
      ghsa_id:
        description: "GHSA ID (e.g., GHSA-xvch-5gv4-984h)"
        required: true
        type: string
      cve_id:
        description: "CVE ID (e.g., CVE-2021-44906)"
        required: false
        type: string
      vulnerable_package_name:
        description: "Vulnerable package name from the Dependabot alert (e.g., minimist)"
        required: true
        type: string
      vulnerable_package_ecosystem:
        description: "Vulnerable package ecosystem from the Dependabot alert (e.g., npm, pip, maven)"
        required: true
        type: string
      severity:
        description: "Vulnerability severity (low, medium, high, critical)"
        required: true
        type: string
      summary:
        description: "Brief vulnerability summary"
        required: true
        type: string
      manifest_path:
        description: "Optional manifest path for the affected product"
        required: false
        type: string
      product_version:
        description: "Optional product version override"
        required: false
        type: string
      dismissed_reason:
        description: "Dismissal reason"
        required: true
        type: choice
        options:
          - not_used
          - inaccurate
          - tolerable_risk
          - no_bandwidth
      dismissed_comment:
        description: "Optional maintainer comment captured when the alert was dismissed"
        required: false
        type: string
      alert_url:
        description: "Dependabot alert URL for traceability"
        required: false
        type: string
      dismissed_at:
        description: "ISO 8601 dismissal timestamp"
        required: false
        type: string
      vex_status:
        description: "Explicit OpenVEX status parsed from structured dismissal metadata"
        required: false
        type: string
      vex_justification:
        description: "Explicit OpenVEX justification parsed from structured dismissal metadata"
        required: false
        type: string
      vex_impact_statement:
        description: "Explicit OpenVEX impact statement parsed from structured dismissal metadata"
        required: false
        type: string

permissions:
  contents: read
  issues: read
  pull-requests: read

env:
  ALERT_NUMBER: ${{ github.event.inputs.alert_number }}
  ALERT_GHSA_ID: ${{ github.event.inputs.ghsa_id }}
  ALERT_CVE_ID: ${{ github.event.inputs.cve_id }}
  ALERT_VULNERABLE_PACKAGE: ${{ github.event.inputs.vulnerable_package_name }}
  ALERT_VULNERABLE_ECOSYSTEM: ${{ github.event.inputs.vulnerable_package_ecosystem }}
  ALERT_SEVERITY: ${{ github.event.inputs.severity }}
  ALERT_SUMMARY: ${{ github.event.inputs.summary }}
  ALERT_MANIFEST_PATH: ${{ github.event.inputs.manifest_path }}
  ALERT_PRODUCT_VERSION: ${{ github.event.inputs.product_version }}
  ALERT_DISMISSED_REASON: ${{ github.event.inputs.dismissed_reason }}
  ALERT_DISMISSED_COMMENT: ${{ github.event.inputs.dismissed_comment }}
  ALERT_URL: ${{ github.event.inputs.alert_url }}
  ALERT_DISMISSED_AT: ${{ github.event.inputs.dismissed_at }}
  ALERT_VEX_STATUS: ${{ github.event.inputs.vex_status }}
  ALERT_VEX_JUSTIFICATION: ${{ github.event.inputs.vex_justification }}
  ALERT_VEX_IMPACT_STATEMENT: ${{ github.event.inputs.vex_impact_statement }}

tools:
  bash: true
  edit:

safe-outputs:
  create-pull-request:
    title-prefix: "[VEX] "
    labels: [vex, automated]
    draft: false

engine:
  id: copilot
  model: claude-opus-4.6
source: githubnext/agentics/workflows/vex-generator.md@1f672aef974f4246124860fc532f82fe8a93a57e
---

# Auto-Generate OpenVEX Statement on Dependabot Alert Dismissal

You are a security automation agent. When a Dependabot alert is dismissed and maintainers provide explicit VEX metadata, you generate a standards-compliant OpenVEX statement documenting why the vulnerability does not affect this project.

## Context

VEX (Vulnerability Exploitability eXchange) is a standard for communicating that a software product is NOT affected by a known vulnerability. Some Dependabot dismissals include that kind of assessment, but a dismissal reason alone is not enough to assert an OpenVEX status or justification. This workflow captures explicit maintainer-provided VEX metadata in a machine-readable format.

The OpenVEX specification: https://openvex.dev/

## Your Task

### Step 1: Get the Dismissed Alert Details

All alert details are available as environment variables. Read them with bash:

```bash
echo "Alert #: $ALERT_NUMBER"
echo "GHSA ID: $ALERT_GHSA_ID"
echo "CVE ID: ${ALERT_CVE_ID:-<none>}"
echo "Vulnerable package: $ALERT_VULNERABLE_PACKAGE"
echo "Vulnerable ecosystem: $ALERT_VULNERABLE_ECOSYSTEM"
echo "Severity: $ALERT_SEVERITY"
echo "Summary: $ALERT_SUMMARY"
echo "Manifest path override: ${ALERT_MANIFEST_PATH:-<auto>}"
echo "Product version override: ${ALERT_PRODUCT_VERSION:-<auto>}"
echo "Dismissed reason: $ALERT_DISMISSED_REASON"
echo "Dismissed comment: ${ALERT_DISMISSED_COMMENT:-<none>}"
echo "Alert URL: ${ALERT_URL:-<none>}"
echo "Dismissed at: ${ALERT_DISMISSED_AT:-<none>}"
echo "Explicit VEX status: ${ALERT_VEX_STATUS:-<none>}"
echo "Explicit VEX justification: ${ALERT_VEX_JUSTIFICATION:-<none>}"
echo "Explicit VEX impact statement: ${ALERT_VEX_IMPACT_STATEMENT:-<none>}"
```

The repository is `${{ github.repository }}`.

Verify all required fields are present before proceeding. `ALERT_VULNERABLE_PACKAGE` and `ALERT_VULNERABLE_ECOSYSTEM` describe the dependency flagged by Dependabot; they provide vulnerability context, but they are not the OpenVEX product identity. If `ALERT_MANIFEST_PATH` is set, use that manifest as the source of truth for product metadata. Otherwise, inspect the repository and identify the manifest that corresponds to the affected product instead of assuming the root manifest is correct. Use `ALERT_PRODUCT_VERSION` as the product version whenever it is provided; otherwise derive the version from that manifest or the repository's release metadata. If you cannot map the alert to a single product manifest deterministically, stop and skip instead of guessing.

### Step 2: Evaluate Dismissal Context and Explicit VEX Metadata

Treat `ALERT_DISMISSED_REASON` as advisory workflow context only. A Dependabot dismissal reason is not, by itself, proof of an OpenVEX status or justification.

For this workflow:

- If the dismissal reason is `no_bandwidth`, do NOT generate a VEX statement. Skip and clearly explain in the workflow logs that `no_bandwidth` dismissals do not represent a security assessment.
- For every other dismissal reason, only proceed when all of these explicit inputs are present: `ALERT_VEX_STATUS`, `ALERT_VEX_JUSTIFICATION`, and `ALERT_VEX_IMPACT_STATEMENT`.
- If any explicit VEX input is missing, skip and explain that the workflow requires structured maintainer-provided VEX metadata instead of inferring VEX truth from the dismissal reason.
- For this repository workflow, only generate a statement when `ALERT_VEX_STATUS` is `not_affected`. If another explicit status is supplied, skip instead of guessing how to represent it.
- Only accept these `ALERT_VEX_JUSTIFICATION` values for `not_affected`: `component_not_present`, `vulnerable_code_not_present`, `vulnerable_code_not_in_execute_path`, `vulnerable_code_cannot_be_controlled_by_adversary`, or `inline_mitigations_already_exist`. If any other value is supplied, skip and explain that the justification is unsupported.
- Use `ALERT_VEX_JUSTIFICATION` exactly as supplied after confirming it is plausible for `not_affected`. Do not substitute a different justification based only on the dismissal reason.
- Use `ALERT_VEX_IMPACT_STATEMENT` as the source of truth for `impact_statement`. Preserve the maintainer's meaning and make only minimal formatting cleanup if needed.

The dispatcher typically populates the explicit VEX inputs from a dismissal comment block like this:

```text
VEX:
status: not_affected
justification: vulnerable_code_not_present
impact: vulnerable package is not shipped in the released product
```

### Step 3: Determine Product Package URL (purl)

Construct a valid Package URL (purl) for the affected product this repository ships, not for the vulnerable dependency reported by Dependabot. Determine the product ecosystem from the selected manifest or release metadata, then build the purl using that product metadata. The purl format depends on the product ecosystem:

- npm: `pkg:npm/<package>@<version>`
- PyPI: `pkg:pypi/<package>@<version>`
- Maven: `pkg:maven/<group>/<artifact>@<version>`
- RubyGems: `pkg:gem/<package>@<version>`
- Go: `pkg:golang/<module>@<version>`
- NuGet: `pkg:nuget/<package>@<version>`

If `ALERT_MANIFEST_PATH` is provided, use it to identify the affected product. In repositories with multiple manifests, do not assume the root `package.json` is the correct product.

If `ALERT_PRODUCT_VERSION` is provided, use it as the product version. Otherwise, read the version from the selected manifest when possible. For manifests without an embedded version (for example `go.mod`), fall back to repository release metadata only if no explicit override was supplied.

Keep the dependency and product identities separate:
- `vulnerability.@id` comes from `ALERT_GHSA_ID` or `ALERT_CVE_ID`
- `products[].@id` must be the purl of the product shipped by this repository
- `ALERT_VULNERABLE_PACKAGE` and `ALERT_VULNERABLE_ECOSYSTEM` refer to the vulnerable dependency from the alert and should be used only as supporting context
### Step 4: Generate the OpenVEX Document

Create a valid OpenVEX JSON document following the v0.2.0 specification:

```json
{
  "@context": "https://openvex.dev/ns/v0.2.0",
  "@id": "https://github.com/<owner>/<repo>/vex/<ghsa-id>",
  "author": "GitHub Agentic Workflow <vex-generator@github.com>",
  "role": "automated-tool",
  "timestamp": "<current ISO 8601 timestamp>",
  "version": 1,
  "tooling": "GitHub Agentic Workflows (gh-aw) VEX Generator",
  "statements": [
    {
      "vulnerability": {
        "@id": "<GHSA or CVE ID>",
        "name": "<CVE ID if available>",
        "description": "<brief vulnerability description>"
      },
      "products": [
        {
          "@id": "<purl of the product shipped by this repository>"
        }
      ],
      "status": "<explicit VEX status from ALERT_VEX_STATUS>",
      "justification": "<explicit VEX justification from ALERT_VEX_JUSTIFICATION>",
      "impact_statement": "<explicit VEX impact statement from ALERT_VEX_IMPACT_STATEMENT>"
    }
  ]
}
```
Do not synthesize or upgrade `status` or `justification` from `ALERT_DISMISSED_REASON` alone. If `ALERT_DISMISSED_COMMENT`, `ALERT_DISMISSED_AT`, or `ALERT_URL` are present, use them as provenance in the PR body and workflow logs, not as a substitute for missing explicit VEX metadata.

### Step 5: Write the VEX File

Save the OpenVEX document to `.vex/<ghsa-id>.json` in the repository.
Before writing anything, check whether `.vex/<ghsa-id>.json` already exists. If it does, skip without modifying the repository so duplicate VEX statements are not created.

If the `.vex/` directory doesn't exist yet, create it. Also create or update a `.vex/README.md` explaining the VEX directory:

```markdown
# VEX Statements

This directory contains [OpenVEX](https://openvex.dev/) statements documenting
vulnerabilities that have been assessed and determined to not affect this project.

These statements are auto-generated when Dependabot alerts are dismissed and
maintainers provide explicit VEX metadata, capturing that security assessment
in a machine-readable format.

## Format

Each file is a valid OpenVEX v0.2.0 JSON document that can be consumed by
vulnerability scanners and SBOM tools to reduce false positive alerts for
downstream consumers of this package.
```

### Step 6: Create a Pull Request

Create a pull request with:
- Title: `Add VEX statement for <CVE-ID or GHSA-ID> (<vulnerable package name>)`
- Body explaining:
  - Which vulnerability was assessed
  - The maintainer's dismissal reason
  - The maintainer's explicit VEX status, justification, and impact statement
  - The maintainer's dismissal comment block, if one was provided
  - When the alert was dismissed, if that timestamp is available
  - Why the explicit VEX metadata was considered sufficient to generate a statement
  - A note that this is auto-generated and should be reviewed
  - Link to the original Dependabot alert

Use the `create-pull-request` safe output to create the PR.

Before opening a PR, check whether an open pull request already exists for the same GHSA or the same `.vex/<ghsa-id>.json` file. If a duplicate is already open, skip instead of creating another PR.
## Important Notes

- Always validate that the generated JSON is valid before creating the PR
- Use clear, descriptive impact statements — these will be consumed by downstream users
- If multiple alerts are dismissed at once, handle each one individually
- The VEX document should be self-contained and not require external context to understand
- Use `ALERT_URL` in the PR body whenever it is available so reviewers can trace the VEX back to the originating Dependabot alert
- If the repository layout or manifest metadata makes the product mapping ambiguous, skip and explain why rather than guessing
- If explicit VEX metadata is missing or inconsistent, skip instead of inferring `not_affected`
