package sshclient

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"skiff/pkg/store"
)

// StreamTarOverSSH creates a gzip-compressed tar in-memory on the local machine
// and writes it directly to SSH stdin, executing `tar -xzf - -C <dest>` on the VPS.
func (c *Client) StreamTarOverSSH(baseDir string, rules []store.ArtifactRule, destDir string, onProgress func(string)) error {
	session, err := c.client.NewSession()
	if err != nil {
		return err
	}
	defer session.Close()

	stdin, err := session.StdinPipe()
	if err != nil {
		return err
	}

	// Capture remote stderr so tar/gzip errors are diagnosable.
	var remoteStderr bytes.Buffer
	session.Stderr = &remoteStderr

	cmd := fmt.Sprintf("mkdir -p '%s' && tar -xzf - -C '%s'", destDir, destDir)
	if err := session.Start(cmd); err != nil {
		return fmt.Errorf("failed to start remote unpacker: %w", err)
	}

	// Stream in a goroutine so a large archive never blocks the session
	// while the remote end drains the pipe.
	writeErr := make(chan error, 1)
	go func() {
		gw := gzip.NewWriter(stdin)
		tw := tar.NewWriter(gw)

		werr := writeArtifactsToTar(tw, baseDir, rules, onProgress)

		// Strict sequential close order — NEVER deferred (LIFO would close
		// stdin first and truncate the stream before the gzip footer):
		//  1. tar writer emits end-of-archive blocks,
		//  2. gzip writer flushes and writes the CRC footer,
		//  3. stdin delivers a clean EOF to the remote tar process.
		if closeErr := tw.Close(); closeErr != nil && werr == nil {
			werr = fmt.Errorf("failed closing tar writer: %w", closeErr)
		}
		if closeErr := gw.Close(); closeErr != nil && werr == nil {
			werr = fmt.Errorf("failed flushing gzip stream: %w", closeErr)
		}
		if closeErr := stdin.Close(); closeErr != nil && werr == nil {
			werr = fmt.Errorf("failed closing SSH stdin: %w", closeErr)
		}

		writeErr <- werr
	}()

	// Local stream must be fully flushed before judging the remote result,
	// and a local error always takes precedence.
	werr := <-writeErr
	waitErr := session.Wait()

	if werr != nil {
		return fmt.Errorf("local archive stream error: %w", werr)
	}
	if waitErr != nil {
		if msg := strings.TrimSpace(remoteStderr.String()); msg != "" {
			return fmt.Errorf("remote unpack failed: %s (%w)", msg, waitErr)
		}
		return fmt.Errorf("remote unpack failed: %w", waitErr)
	}

	return nil
}

// writeArtifactsToTar walks every artifact rule into the tar writer.
func writeArtifactsToTar(tw *tar.Writer, baseDir string, rules []store.ArtifactRule, onProgress func(string)) error {
	for _, rule := range rules {
		absPath := filepath.Join(baseDir, rule.Local)
		info, err := os.Stat(absPath)
		if err != nil {
			return fmt.Errorf("local artifact not found '%s': %w", absPath, err)
		}

		if info.IsDir() {
			err = filepath.Walk(absPath, func(path string, f os.FileInfo, err error) error {
				if err != nil {
					return err
				}
				relPath, _ := filepath.Rel(absPath, path)
				if relPath == "." {
					return nil
				}
				tarHeaderPath := filepath.ToSlash(filepath.Join(rule.Remote, relPath))
				return addFileToTar(tw, path, tarHeaderPath, f, onProgress)
			})
			if err != nil {
				return err
			}
		} else {
			tarHeaderPath := filepath.ToSlash(rule.Remote)
			if err := addFileToTar(tw, absPath, tarHeaderPath, info, onProgress); err != nil {
				return err
			}
		}
	}
	return nil
}

func addFileToTar(tw *tar.Writer, localPath, tarPath string, info os.FileInfo, onProgress func(string)) error {
	header, err := tar.FileInfoHeader(info, info.Name())
	if err != nil {
		return err
	}
	header.Name = tarPath

	if info.IsDir() {
		header.Typeflag = tar.TypeDir
		if !strings.HasSuffix(header.Name, "/") {
			header.Name += "/"
		}
		header.Size = 0
		return tw.WriteHeader(header)
	}

	// Preserve Linux executable permissions for compiled binaries
	if info.Mode()&0111 != 0 {
		header.Mode = 0755
	} else {
		header.Mode = 0644
	}

	if err := tw.WriteHeader(header); err != nil {
		return err
	}

	f, err := os.Open(localPath)
	if err != nil {
		return err
	}
	defer f.Close()

	if onProgress != nil {
		onProgress(fmt.Sprintf("Piping: %s -> %s", info.Name(), tarPath))
	}

	_, err = io.Copy(tw, f)
	return err
}
