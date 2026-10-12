package sshclient

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/rand"
	"io"
	"os"
	"path/filepath"
	"testing"

	"skiff/pkg/store"
)

// Reproduces the Esper failure: a large executable binary + dir tree must
// survive the exact writer chain and close order used by StreamTarOverSSH.
func TestArchiveRoundTripLargeBinary(t *testing.T) {
	src := t.TempDir()

	// dist/ tree with nested subdir
	if err := os.MkdirAll(filepath.Join(src, "dist", "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	smallFiles := map[string]string{
		"dist/index.html":        "<html>esper</html>",
		"dist/assets/app.css":    "body{color:red}",
		"dist/assets/nested.txt": "nested",
	}
	for rel, content := range smallFiles {
		if err := os.WriteFile(filepath.Join(src, rel), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}

	// 64MB pseudo-binary with executable bit, like the musl esper-server
	bigPath := filepath.Join(src, "esper-server")
	big, err := os.Create(bigPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.CopyN(big, rand.Reader, 64<<20); err != nil {
		t.Fatal(err)
	}
	big.Close()
	if err := os.Chmod(bigPath, 0755); err != nil {
		t.Fatal(err)
	}

	rules := []store.ArtifactRule{
		{Local: "dist", Remote: "public"},
		{Local: "esper-server", Remote: "esper-server"},
	}

	// Same chain + close order as StreamTarOverSSH's writer goroutine
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gw)
	if err := writeArtifactsToTar(tw, src, rules, nil); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := tw.Close(); err != nil {
		t.Fatalf("tar close: %v", err)
	}
	if err := gw.Close(); err != nil {
		t.Fatalf("gzip close (footer): %v", err)
	}

	// Unpack like `tar -xzf -` would; unexpected EOF here was the VPS symptom
	gr, err := gzip.NewReader(&buf)
	if err != nil {
		t.Fatalf("gzip header (truncated stream): %v", err)
	}
	defer gr.Close()
	dst := t.TempDir()
	tr := tar.NewReader(gr)
	count := 0
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("tar read (truncated stream): %v", err)
		}
		target := filepath.Join(dst, hdr.Name)
		if hdr.Typeflag == tar.TypeDir {
			if err := os.MkdirAll(target, 0755); err != nil {
				t.Fatal(err)
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			t.Fatal(err)
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY, os.FileMode(hdr.Mode))
		if err != nil {
			t.Fatal(err)
		}
		n, err := io.Copy(out, tr)
		out.Close()
		if err != nil {
			t.Fatalf("file body truncated: %v", err)
		}
		if n != hdr.Size {
			t.Fatalf("%s: short body %d != %d", hdr.Name, n, hdr.Size)
		}
		count++
	}

	// Byte-compare every shipped file against the source
	for rel, content := range smallFiles {
		got, err := os.ReadFile(filepath.Join(dst, "public", rel[len("dist/"):]))
		if err != nil {
			t.Fatal(err)
		}
		if string(got) != content {
			t.Fatalf("%s content mismatch", rel)
		}
	}
	wantBig, _ := os.ReadFile(bigPath)
	gotBig, err := os.ReadFile(filepath.Join(dst, "esper-server"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(wantBig, gotBig) {
		t.Fatalf("binary mismatch: got %d bytes, want %d", len(gotBig), len(wantBig))
	}
	st, _ := os.Stat(filepath.Join(dst, "esper-server"))
	if st.Mode().Perm() != 0755 {
		t.Fatalf("binary mode = %o, want 755", st.Mode().Perm())
	}
	if _, err := os.Stat(filepath.Join(dst, "public", "assets")); err != nil {
		t.Fatalf("nested dir missing: %v", err)
	}
	t.Logf("round-tripped %d files + 64MB binary, all byte-identical", count)
}
