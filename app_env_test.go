package main

import "testing"

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
