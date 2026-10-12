package sshclient

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
	"strings"
	"time"

	"skiff/pkg/store"

	"golang.org/x/crypto/ssh"
)

type Telemetry struct {
	TotalRAMMB int     `json:"totalRamMb"`
	UsedRAMMB  int     `json:"usedRamMb"`
	RAMPercent float64 `json:"ramPercent"`
	DiskUsed   string  `json:"diskUsed"`
	DiskAvail  string  `json:"diskAvail"`
	Uptime     string  `json:"uptime"`
	LoadAvg    string  `json:"loadAvg"`
}

type Client struct {
	config store.ServerConfig
	client *ssh.Client
}

func NewClient(cfg store.ServerConfig) (*Client, error) {
	var authMethod ssh.AuthMethod

	if cfg.AuthType == "password" {
		authMethod = ssh.Password(cfg.Password)
	} else {
		var keyBytes []byte
		var err error
		if cfg.KeyContent != "" {
			keyBytes = []byte(cfg.KeyContent)
		} else if cfg.KeyPath != "" {
			keyBytes, err = os.ReadFile(cfg.KeyPath)
			if err != nil {
				return nil, fmt.Errorf("failed reading private key: %w", err)
			}
		} else {
			return nil, fmt.Errorf("no key path or content provided")
		}

		signer, err := ssh.ParsePrivateKey(keyBytes)
		if err != nil {
			return nil, fmt.Errorf("failed parsing private key: %w", err)
		}
		authMethod = ssh.PublicKeys(signer)
	}

	sshConfig := &ssh.ClientConfig{
		User:            cfg.User,
		Auth:            []ssh.AuthMethod{authMethod},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	}

	addr := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))
	client, err := ssh.Dial("tcp", addr, sshConfig)
	if err != nil {
		return nil, fmt.Errorf("ssh dial error to %s: %w", addr, err)
	}

	return &Client{config: cfg, client: client}, nil
}

func (c *Client) Close() error {
	if c.client != nil {
		return c.client.Close()
	}
	return nil
}

func (c *Client) RunCommand(cmd string) (string, error) {
	session, err := c.client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	var stdout, stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr

	err = session.Run(cmd)
	if err != nil {
		return stdout.String(), fmt.Errorf("%s: %s", err, stderr.String())
	}
	return stdout.String(), nil
}

func (c *Client) StreamLogs(cmd string, onLine func(string), stopChan <-chan struct{}) error {
	session, err := c.client.NewSession()
	if err != nil {
		return err
	}
	defer session.Close()

	stdout, err := session.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := session.StderrPipe()
	if err != nil {
		return err
	}

	if err := session.Start(cmd); err != nil {
		return err
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		scannerOut := bufio.NewScanner(io.MultiReader(stdout, stderr))
		for scannerOut.Scan() {
			onLine(scannerOut.Text())
		}
	}()

	select {
	case <-stopChan:
		_ = session.Signal(ssh.SIGINT)
		_ = session.Close()
		<-done
	case <-done:
	}

	return nil
}

func (c *Client) GetTelemetry() (*Telemetry, error) {
	// Query /proc/meminfo, df, and uptime in a single round-trip
	cmd := `sh -c 'cat /proc/meminfo | grep -E "MemTotal|MemAvailable"; echo "---"; df -h / | tail -n 1; echo "---"; uptime'`
	out, err := c.RunCommand(cmd)
	if err != nil {
		return nil, err
	}

	parts := strings.Split(out, "---")
	if len(parts) < 3 {
		return nil, fmt.Errorf("unexpected telemetry output format")
	}

	tele := &Telemetry{}

	// Parse RAM
	var memTotal, memAvail int
	scanner := bufio.NewScanner(strings.NewReader(parts[0]))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "MemTotal:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				memTotal, _ = strconv.Atoi(fields[1])
			}
		} else if strings.HasPrefix(line, "MemAvailable:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				memAvail, _ = strconv.Atoi(fields[1])
			}
		}
	}

	if memTotal > 0 {
		tele.TotalRAMMB = memTotal / 1024
		usedKB := memTotal - memAvail
		tele.UsedRAMMB = usedKB / 1024
		tele.RAMPercent = (float64(usedKB) / float64(memTotal)) * 100.0
	}

	// Parse Disk
	diskFields := strings.Fields(strings.TrimSpace(parts[1]))
	if len(diskFields) >= 4 {
		tele.DiskUsed = diskFields[2]
		tele.DiskAvail = diskFields[3]
	}

	// Parse Uptime
	tele.Uptime = strings.TrimSpace(parts[2])

	return tele, nil
}
