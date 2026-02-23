package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"github.com/joho/godotenv"
)

// Config holds all runtime configuration loaded from .env
type Config struct {
	Port              string
	DatabaseURL       string
	AnthropicAPIKey   string
	OpenAIAPIKey      string
	GoogleAPIKey      string
	OpenRouterAPIKey  string
	DeepSeekAPIKey    string
	WorkspaceDir      string
}

// Load reads from ../.env relative to the agent-engine directory
func Load() (*Config, error) {
	// Try to load .env from parent directory (project root)
	envPath := filepath.Join("..", ".env")
	if err := godotenv.Overload(envPath); err != nil {
		// Not fatal — env vars may be set directly
		_ = err
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "file:../prisma/dev.db"
	}

	// Convert Prisma-style "file:..." to path for go-sqlite3
	dbPath := dbURL
	if len(dbPath) > 5 && dbPath[:5] == "file:" {
		dbPath = dbPath[5:]
	}
	// Append WAL + foreign_keys + busy_timeout
	dbDSN := fmt.Sprintf("%s?_journal_mode=WAL&_foreign_keys=on&_busy_timeout=5000", dbPath)

	port := os.Getenv("GO_ENGINE_PORT")
	if port == "" {
		port = "8080"
	}
	// Validate port is numeric
	if _, err := strconv.Atoi(port); err != nil {
		port = "8080"
	}

	workspaceDir := os.Getenv("WORKSPACE_DIR")
	if workspaceDir == "" {
		workspaceDir = "../.bossman_workspace"
	}

	return &Config{
		Port:             port,
		DatabaseURL:      dbDSN,
		AnthropicAPIKey:  os.Getenv("ANTHROPIC_API_KEY"),
		OpenAIAPIKey:     os.Getenv("OPENAI_API_KEY"),
		GoogleAPIKey:     os.Getenv("GOOGLE_GENERATIVE_AI_API_KEY"),
		OpenRouterAPIKey: os.Getenv("OPENROUTER_API_KEY"),
		DeepSeekAPIKey:   os.Getenv("DEEPSEEK_API_KEY"),
		WorkspaceDir:     workspaceDir,
	}, nil
}
