package engine

import (
	"bytes"
	"context"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// executeCommand runs a shell command with timeout and path safety.
func executeCommand(ctx context.Context, command, workdir, projectWorkspaceRoot string, timeout time.Duration) (string, int, error) {
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, "/bin/sh", "-c", command)
	if projectWorkspaceRoot != "" {
		safeDir := projectWorkspaceRoot
		if workdir != "" {
			candidate := filepath.Join(projectWorkspaceRoot, workdir)
			abs, err := filepath.Abs(candidate)
			if err == nil && strings.HasPrefix(abs, projectWorkspaceRoot) {
				safeDir = abs
			}
		}
		cmd.Dir = safeDir
	}

	var outBuf bytes.Buffer
	cmd.Stdout = &outBuf
	cmd.Stderr = &outBuf

	exitCode := 0
	if err := cmd.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			output := outBuf.String()
			if len(output) > maxCommandOutputBytes {
				output = output[:maxCommandOutputBytes] + "\n... (output truncated)"
			}
			return output, -1, err
		}
	}

	output := outBuf.String()
	if len(output) > maxCommandOutputBytes {
		output = output[:maxCommandOutputBytes] + "\n... (output truncated)"
	}
	return output, exitCode, nil
}

func summarizeCommand(cmd string) string {
	if len(cmd) > 60 {
		return cmd[:60] + "..."
	}
	return cmd
}
