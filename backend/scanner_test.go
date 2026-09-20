package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDiscoverPrototypePaths(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "proto_scan_test_*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	// Create test directory tree:
	// - level 1: ProjectA (with index.html)
	// - level 2: 2026年10月/ProjectB (with start.html)
	// - level 3: shopkeeper/2026年11月/ProjectC (with data/document.js and some.html)
	// - level 3: shopkeeper/2026年11月/ProjectD (with app.html)

	projA := filepath.Join(tempDir, "ProjectA")
	os.MkdirAll(projA, 0755)
	os.WriteFile(filepath.Join(projA, "index.html"), []byte("<html></html>"), 0644)

	projB := filepath.Join(tempDir, "2026年10月", "ProjectB")
	os.MkdirAll(projB, 0755)
	os.WriteFile(filepath.Join(projB, "start.html"), []byte("<html></html>"), 0644)

	projC := filepath.Join(tempDir, "shopkeeper", "2026年11月", "ProjectC", "data")
	os.MkdirAll(projC, 0755)
	os.WriteFile(filepath.Join(projC, "document.js"), []byte("// axure doc"), 0644)
	os.WriteFile(filepath.Join(filepath.Dir(projC), "main.html"), []byte("<html></html>"), 0644)

	projD := filepath.Join(tempDir, "shopkeeper", "2026年11月", "ProjectD")
	os.MkdirAll(projD, 0755)
	os.WriteFile(filepath.Join(projD, "app.html"), []byte("<html></html>"), 0644)

	paths, skipped, err := discoverPrototypePaths(tempDir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(skipped) > 0 {
		t.Errorf("expected 0 skipped, got: %v", skipped)
	}

	if len(paths) != 4 {
		t.Fatalf("expected 4 paths, got %d: %v", len(paths), paths)
	}

	expected := map[string]bool{
		"ProjectA":                                 true,
		"2026年10月/ProjectB":                        true,
		"shopkeeper/2026年11月/ProjectC":            true,
		"shopkeeper/2026年11月/ProjectD":            true,
	}

	for _, p := range paths {
		if !expected[p] {
			t.Errorf("unexpected path found: %s", p)
		}
	}

	// Test entry resolution
	if entry := resolvePrototypeEntryHTML(projB); entry != "start.html" {
		t.Errorf("expected start.html for projB, got %s", entry)
	}
	if entry := resolvePrototypeEntryHTML(projD); entry != "app.html" {
		t.Errorf("expected app.html for projD, got %s", entry)
	}
	if entry := resolvePrototypeEntryHTML(filepath.Dir(projC)); entry != "main.html" {
		t.Errorf("expected main.html for projC, got %s", entry)
	}
}

