package workspace

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Workspace manages the .bossman_workspace directory
type Workspace struct {
	root string
}

// New creates a Workspace rooted at the given directory path
func New(root string) *Workspace {
	abs, err := filepath.Abs(root)
	if err != nil {
		abs = root
	}
	return &Workspace{root: abs}
}

// ProjectRoot returns the absolute path for a project's workspace directory
func (w *Workspace) ProjectRoot(projectID string) (string, error) {
	if err := validateSegment(projectID); err != nil {
		return "", fmt.Errorf("invalid projectID: %w", err)
	}
	p := filepath.Join(w.root, projectID)
	return filepath.Abs(p)
}

// WriteFile writes content to .bossman_workspace/{projectID}/{employeeID}/{pathDir}/{title}
// Returns the relative path (forward slashes).
func (w *Workspace) WriteFile(projectID, employeeID string, pathDir *string, title, content string) (string, error) {
	if err := validateSegment(projectID); err != nil {
		return "", fmt.Errorf("invalid projectID: %w", err)
	}
	if err := validateSegment(employeeID); err != nil {
		return "", fmt.Errorf("invalid employeeID: %w", err)
	}
	if err := validateTitle(title); err != nil {
		return "", fmt.Errorf("invalid title: %w", err)
	}

	parts := []string{w.root, projectID, employeeID}
	if pathDir != nil && strings.TrimSpace(*pathDir) != "" {
		parts = append(parts, strings.TrimSpace(*pathDir))
	}
	parts = append(parts, title)

	absPath, err := filepath.Abs(filepath.Join(parts...))
	if err != nil {
		return "", err
	}

	// Path escape check
	root := filepath.Join(w.root, projectID) + string(filepath.Separator)
	if !strings.HasPrefix(absPath, root) {
		return "", fmt.Errorf("path escapes workspace root")
	}

	if err := os.MkdirAll(filepath.Dir(absPath), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(absPath, []byte(content), 0o644); err != nil {
		return "", err
	}

	// Return relative path from project root
	projectRoot := filepath.Join(w.root, projectID)
	rel, err := filepath.Rel(projectRoot, absPath)
	if err != nil {
		rel = filepath.Join(employeeID, title)
	}
	return filepath.ToSlash(rel), nil
}

// ReadFile reads a file from .bossman_workspace/{projectID}/{relativePath}
func (w *Workspace) ReadFile(projectID, relativePath string) (string, error) {
	if err := validateSegment(projectID); err != nil {
		return "", fmt.Errorf("invalid projectID: %w", err)
	}

	projectRoot := filepath.Join(w.root, projectID)
	absPath, err := filepath.Abs(filepath.Join(projectRoot, relativePath))
	if err != nil {
		return "", err
	}

	root := projectRoot + string(filepath.Separator)
	if !strings.HasPrefix(absPath, root) && absPath != projectRoot {
		return "", fmt.Errorf("path escapes workspace root")
	}

	data, err := os.ReadFile(absPath)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// ListFiles lists all files in .bossman_workspace/{projectID}/ recursively
func (w *Workspace) ListFiles(projectID string) ([]FileEntry, error) {
	if err := validateSegment(projectID); err != nil {
		return nil, fmt.Errorf("invalid projectID: %w", err)
	}

	projectRoot := filepath.Join(w.root, projectID)
	var results []FileEntry
	err := filepath.WalkDir(projectRoot, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		rel, _ := filepath.Rel(projectRoot, path)
		rel = filepath.ToSlash(rel)
		results = append(results, FileEntry{RelativePath: rel})
		return nil
	})
	if os.IsNotExist(err) {
		return nil, nil
	}
	return results, err
}

// FileEntry represents a file in the workspace
type FileEntry struct {
	RelativePath string
}

func validateSegment(s string) error {
	if s == "" || strings.Contains(s, "..") || strings.ContainsAny(s, `/\`) {
		return fmt.Errorf("invalid path segment: %q", s)
	}
	return nil
}

func validateTitle(s string) error {
	if s == "" || strings.Contains(s, "..") || strings.ContainsAny(s, `\/`) {
		return fmt.Errorf("invalid title: %q", s)
	}
	return nil
}
