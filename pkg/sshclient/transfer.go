package sshclient

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"os"
	"path/filepath"

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

	cmd := fmt.Sprintf("mkdir -p '%s' && tar -xzf - -C '%s'", destDir, destDir)
	if err := session.Start(cmd); err != nil {
		return fmt.Errorf("failed to start remote unpacker: %w", err)
	}

	// Stream in a goroutine so Wait() can collect the remote exit status
	// while we write; propagate the first write error back.
	writeErr := make(chan error, 1)
	go func() {
		gw := gzip.NewWriter(stdin)
		tw := tar.NewWriter(gw)

		var werr error
		func() {
			defer tw.Close()
			defer gw.Close()
			defer stdin.Close()

			for _, rule := range rules {
				absPath := filepath.Join(baseDir, rule.Local)
				info, err := os.Stat(absPath)
				if err != nil {
					werr = fmt.Errorf("local artifact not found '%s': %w", absPath, err)
					return
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
						werr = err
						return
					}
				} else {
					tarHeaderPath := filepath.ToSlash(rule.Remote)
					if err := addFileToTar(tw, absPath, tarHeaderPath, info, onProgress); err != nil {
						werr = err
						return
					}
				}
			}
		}()
		writeErr <- werr
	}()

	waitErr := session.Wait()
	if werr := <-writeErr; werr != nil {
		return werr
	}
	return waitErr
}

func addFileToTar(tw *tar.Writer, localPath, tarPath string, info os.FileInfo, onProgress func(string)) error {
	header, err := tar.FileInfoHeader(info, info.Name())
	if err != nil {
		return err
	}
	header.Name = tarPath

	if info.IsDir() {
		header.Typeflag = tar.TypeDir
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
