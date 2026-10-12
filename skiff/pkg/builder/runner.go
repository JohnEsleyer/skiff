package builder

import (
	"bufio"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"sync"
)

type Runner struct{}

func NewRunner() *Runner {
	return &Runner{}
}

func (r *Runner) RunCommand(dir, commandStr string, onLine func(string)) error {
	var cmd *exec.Cmd

	if runtime.GOOS == "windows" {
		cmd = exec.Command("cmd", "/C", commandStr)
	} else {
		cmd = exec.Command("sh", "-c", commandStr)
	}

	cmd.Dir = dir

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed starting '%s': %w", commandStr, err)
	}

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		scannerOut := bufio.NewScanner(stdout)
		for scannerOut.Scan() {
			onLine(scannerOut.Text())
		}
	}()

	go func() {
		defer wg.Done()
		scannerErr := bufio.NewScanner(stderr)
		for scannerErr.Scan() {
			onLine(fmt.Sprintf("[stderr] %s", scannerErr.Text()))
		}
	}()

	// Wait for output forwarding to drain before Wait() returns.
	// cmd.Wait() closes the pipes; wg ensures scanners finish.
	waitErr := cmd.Wait()
	wg.Wait()

	if waitErr != nil {
		return fmt.Errorf("command '%s' exited with error: %w", strings.TrimSpace(commandStr), waitErr)
	}

	return nil
}
