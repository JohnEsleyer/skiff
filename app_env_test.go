package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestValidateAppEnvDir(t *testing.T) {
	ok, err := validateAppEnvDir("/opt/skiff/apps/esper")
	if err != nil || ok != "/opt/skiff/apps/esper" {
		t.Fatalf("expected clean dir, got %q err=%v", ok, err)
	}

	bad := []string{
		"",
		"/",
		"/opt",
		"/opt/skiff",
		"/opt/skiff/apps",
		"/opt/skiff/apps/",
		"/opt/skiff/apps/../caddy",
		"/opt/skiff/apps/esper/../../etc",
		"/etc/passwd",
		"relative/path",
		"/opt/skiff/apps/esper/nested",
		"/opt/skiff/apps/evil;reboot",
	}
	for _, b := range bad {
		if _, err := validateAppEnvDir(b); err == nil {
			t.Fatalf("expected rejection for %q", b)
		}
	}
}

func TestAppServiceSlug(t *testing.T) {
	if got := appServiceSlug("/opt/skiff/apps/esper", "ignored"); got != "esper" {
		t.Fatalf("got %q", got)
	}
	if got := appServiceSlug("", "My App"); got != "My-App" {
		t.Fatalf("got %q", got)
	}
	if got := appServiceSlug("", ""); got != "app" {
		t.Fatalf("got %q", got)
	}
}

func TestDetectProjectEnvFiles(t *testing.T) {
	dir := t.TempDir()

	envContent := "# Comment\nPORT=8080\nAPI_KEY=\"secret-123\"\nexport DB_HOST=localhost\n"
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte(envContent), 0644); err != nil {
		t.Fatal(err)
	}
	prodContent := "PORT=9000\nNODE_ENV=production\n"
	if err := os.WriteFile(filepath.Join(dir, ".env.production"), []byte(prodContent), 0644); err != nil {
		t.Fatal(err)
	}

	app := &App{}
	detected, err := app.DetectProjectEnvFiles(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(detected) != 2 {
		t.Fatalf("expected 2 detected env files, got %d", len(detected))
	}

	var dotEnv *DetectedEnvFile
	for i := range detected {
		if detected[i].Name == ".env" {
			dotEnv = &detected[i]
		}
	}
	if dotEnv == nil {
		t.Fatalf(".env not found in detected files")
	}

	if len(dotEnv.Vars) != 3 {
		t.Fatalf("expected 3 parsed vars in .env, got %d: %+v", len(dotEnv.Vars), dotEnv.Vars)
	}

	expectedMap := map[string]string{
		"PORT":    "8080",
		"API_KEY": "secret-123",
		"DB_HOST": "localhost",
	}
	for _, v := range dotEnv.Vars {
		if expectedMap[v.Key] != v.Value {
			t.Errorf("expected %s=%s, got %s=%s", v.Key, expectedMap[v.Key], v.Key, v.Value)
		}
	}
}
