package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSemverDesc(t *testing.T) {
	in := []string{"v2.2.1", "v3.3.0", "v3.2.5", "v2.7.0", "v3.1.6"}
	sortSemverDesc(in)
	want := []string{"v3.3.0", "v3.2.5", "v3.1.6", "v2.7.0", "v2.2.1"}
	for i := range want {
		if in[i] != want[i] {
			t.Fatalf("got %v want %v", in, want)
		}
	}
	if semverParts("v3.3.0-beta.1") != nil {
		t.Fatalf("prerelease tag should not parse as stable semver")
	}
	if !stableSemverRegexp.MatchString("v3.3.0") || stableSemverRegexp.MatchString("v3.3.0-beta.1") {
		t.Fatalf("stable semver regexp misbehaves")
	}
}

func TestGetDatabaseVersionsLive(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/repos/surrealdb/surrealdb/releases", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `[{"tag_name":"v3.3.0","prerelease":false,"draft":false},`+
			`{"tag_name":"v3.3.0-beta.4","prerelease":true,"draft":false},`+
			`{"tag_name":"v3.2.5","prerelease":false,"draft":false},`+
			`{"tag_name":"v2.7.0","prerelease":false,"draft":false}]`)
	})
	mux.HandleFunc("/repos/MariaDB/server/releases", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `[{"tag_name":"mariadb-11.8.2","prerelease":false,"draft":false},`+
			`{"tag_name":"mariadb-11.4.5","prerelease":false,"draft":false}]`)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	oldBase := githubAPIBase
	oldTTL := versionCacheTTL
	githubAPIBase = srv.URL
	versionCacheTTL = time.Millisecond
	defer func() {
		githubAPIBase = oldBase
		versionCacheTTL = oldTTL
		versionCache.Lock()
		versionCache.entries = make(map[string]versionCacheEntry)
		versionCache.Unlock()
	}()

	app := &App{}
	opts, err := app.GetDatabaseVersions("surrealdb")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(opts) != 3 || opts[0].Value != "v3.3.0" || !opts[0].Recommended {
		t.Fatalf("unexpected surrealdb options: %+v", opts)
	}
	for _, o := range opts {
		if strings.Contains(o.Value, "beta") {
			t.Fatalf("prerelease leaked into options: %+v", opts)
		}
	}

	maria, err := app.GetDatabaseVersions("mysql")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(maria) != 2 || maria[0].Value != "11.8" || !maria[0].Recommended {
		t.Fatalf("unexpected mariadb options: %+v", maria)
	}
}

func TestGetDatabaseVersionsFallback(t *testing.T) {
	oldBase := githubAPIBase
	oldTTL := versionCacheTTL
	githubAPIBase = "http://127.0.0.1:1" // unroutable: forces fallback
	versionCacheTTL = time.Millisecond
	defer func() {
		githubAPIBase = oldBase
		versionCacheTTL = oldTTL
		versionCache.Lock()
		versionCache.entries = make(map[string]versionCacheEntry)
		versionCache.Unlock()
	}()

	app := &App{}
	opts, err := app.GetDatabaseVersions("surrealdb")
	if err != nil {
		t.Fatalf("fallback must not error: %v", err)
	}
	if len(opts) == 0 || !opts[0].Recommended || !strings.HasPrefix(opts[0].Value, "v3.") {
		t.Fatalf("fallback should lead with a 3.x: %+v", opts)
	}
}
