//go:build e2e
// +build e2e

/*
Copyright 2026.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package e2e

import (
	"context"
	"fmt"
	"net"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// waitFor polls fn every interval until it returns nil or the timeout expires.
// On timeout, it calls t.Fatalf with the description and last error.
func waitFor(t *testing.T, timeout, interval time.Duration, desc string, fn func() error) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	var lastErr error
	for {
		select {
		case <-ctx.Done():
			t.Fatalf("timed out waiting for %s (timeout %v): %v", desc, timeout, lastErr)
			return
		case <-ticker.C:
			if err := fn(); err != nil {
				lastErr = err
				t.Logf("waiting for %s: %v", desc, err)
			} else {
				return
			}
		}
	}
}

// kubectl runs a kubectl command and returns its combined output.
// On error, it calls t.Fatalf.
func kubectl(t *testing.T, args ...string) string {
	t.Helper()
	out, err := kubectlMayFail(t, args...)
	if err != nil {
		t.Fatalf("kubectl %s failed: %v\nOutput: %s", strings.Join(args, " "), err, out)
	}
	return out
}

// kubectlMayFail runs a kubectl command and returns its combined output and error.
// It does not fail the test on error.
func kubectlMayFail(t *testing.T, args ...string) (string, error) {
	t.Helper()
	cmd := exec.Command("kubectl", args...)
	t.Logf("running: kubectl %s", strings.Join(args, " "))
	output, err := cmd.CombinedOutput()
	out := strings.TrimSpace(string(output))
	if out != "" {
		t.Logf("output: %s", out)
	}
	return out, err
}

// portForwardSession holds a running kubectl port-forward process.
type portForwardSession struct {
	cmd       *exec.Cmd
	localPort string
}

// Stop kills the port-forward process.
func (p *portForwardSession) Stop() {
	if p.cmd != nil && p.cmd.Process != nil {
		_ = p.cmd.Process.Kill()
		_, _ = p.cmd.Process.Wait()
	}
}

// startPortForward starts a kubectl port-forward to the given service and returns
// a session with the local port. It registers t.Cleanup to stop the process.
func startPortForward(t *testing.T, svcName, remotePort, namespace string) *portForwardSession {
	t.Helper()

	// Find a free local port
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to find free port: %v", err)
	}
	localPort := fmt.Sprintf("%d", listener.Addr().(*net.TCPAddr).Port)
	listener.Close()

	cmd := exec.Command("kubectl", "port-forward",
		fmt.Sprintf("svc/%s", svcName),
		fmt.Sprintf("%s:%s", localPort, remotePort),
		"-n", namespace,
	)
	t.Logf("starting port-forward: kubectl port-forward svc/%s %s:%s -n %s", svcName, localPort, remotePort, namespace)

	if err := cmd.Start(); err != nil {
		t.Fatalf("failed to start port-forward: %v", err)
	}

	session := &portForwardSession{cmd: cmd, localPort: localPort}
	t.Cleanup(func() { session.Stop() })

	// Give port-forward time to establish (same pattern as controller/test/e2e/e2e_test.go:444)
	time.Sleep(3 * time.Second)

	return session
}

// getCondition retrieves a condition's status and reason from a ModelDeployment via jsonpath.
func getCondition(t *testing.T, mdName, namespace, condType string) (status string, reason string) {
	t.Helper()

	statusOut, err := kubectlMayFail(t, "get", "modeldeployment", mdName,
		"-n", namespace, "-o",
		fmt.Sprintf("jsonpath={.status.conditions[?(@.type=='%s')].status}", condType))
	if err != nil {
		return "", ""
	}

	reasonOut, _ := kubectlMayFail(t, "get", "modeldeployment", mdName,
		"-n", namespace, "-o",
		fmt.Sprintf("jsonpath={.status.conditions[?(@.type=='%s')].reason}", condType))

	return statusOut, reasonOut
}

// getPhase retrieves the phase from a ModelDeployment.
func getPhase(t *testing.T, mdName, namespace string) string {
	t.Helper()

	out, err := kubectlMayFail(t, "get", "modeldeployment", mdName,
		"-n", namespace, "-o", "jsonpath={.status.phase}")
	if err != nil {
		return ""
	}
	return out
}

// collectDebugInfo dumps diagnostic information for the ModelDeployment and related resources.
func collectDebugInfo(t *testing.T, mdName, namespace string) {
	t.Helper()

	t.Log("=== DEBUG INFO START ===")

	// ModelDeployment YAML
	if out, err := kubectlMayFail(t, "get", "modeldeployment", mdName, "-n", namespace, "-o", "yaml"); err == nil {
		t.Logf("ModelDeployment:\n%s", out)
	}

	// PVC
	pvcName := mdName + "-model-cache"
	if out, err := kubectlMayFail(t, "get", "pvc", pvcName, "-n", namespace, "-o", "yaml"); err == nil {
		t.Logf("PVC %s:\n%s", pvcName, out)
	}

	// Job
	jobName := mdName + "-model-download"
	if out, err := kubectlMayFail(t, "get", "job", jobName, "-n", namespace, "-o", "yaml"); err == nil {
		t.Logf("Job %s:\n%s", jobName, out)
	}

	// Job logs
	if out, err := kubectlMayFail(t, "logs", fmt.Sprintf("job/%s", jobName), "-n", namespace, "--tail=50"); err == nil {
		t.Logf("Job %s logs:\n%s", jobName, out)
	}

	// DynamoGraphDeployment
	if out, err := kubectlMayFail(t, "get", "dynamographdeployments.nvidia.com", mdName, "-n", namespace, "-o", "yaml"); err == nil {
		t.Logf("DynamoGraphDeployment %s:\n%s", mdName, out)
	}

	// Events
	if out, err := kubectlMayFail(t, "get", "events", "-n", namespace, "--sort-by=.lastTimestamp"); err == nil {
		t.Logf("Events:\n%s", out)
	}

	// Dynamo provider logs
	if out, err := kubectlMayFail(t, "logs", "-l", "control-plane=dynamo-provider",
		"-n", "kubeairunway-system", "--tail=100"); err == nil {
		t.Logf("Dynamo provider logs:\n%s", out)
	}

	t.Log("=== DEBUG INFO END ===")
}

// testdataPath resolves a filename relative to the testdata/ directory
// adjacent to the test file.
func testdataPath(t *testing.T, filename string) string {
	t.Helper()
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("failed to get caller information")
	}
	return filepath.Join(filepath.Dir(currentFile), "testdata", filename)
}

// kubectlApplyLiteral applies a YAML string via stdin and returns the output and error.
// It does not fail the test on error (callers check for expected rejection).
func kubectlApplyLiteral(t *testing.T, yaml string) (string, error) {
	t.Helper()
	cmd := exec.Command("kubectl", "apply", "-f", "-")
	cmd.Stdin = strings.NewReader(yaml)
	t.Log("running: kubectl apply -f - (inline YAML)")
	output, err := cmd.CombinedOutput()
	out := strings.TrimSpace(string(output))
	if out != "" {
		t.Logf("output: %s", out)
	}
	return out, err
}

// deleteModelDeployment deletes a ModelDeployment by name, ignoring not-found errors.
func deleteModelDeployment(t *testing.T, name string) {
	t.Helper()
	kubectlMayFail(t, "delete", "modeldeployment", name, "-n", mdNamespace,
		"--ignore-not-found", "--timeout=2m")
}
