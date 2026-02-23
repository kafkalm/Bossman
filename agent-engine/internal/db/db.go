package db

import (
	"github.com/jmoiron/sqlx"
	_ "github.com/mattn/go-sqlite3"
)

// DB wraps sqlx.DB for the agent engine
type DB struct {
	*sqlx.DB
}

// Open creates and configures a SQLite connection
func Open(dsn string) (*DB, error) {
	database, err := sqlx.Open("sqlite3", dsn)
	if err != nil {
		return nil, err
	}

	// SQLite: allow only 1 writer at a time to avoid SQLITE_BUSY
	database.SetMaxOpenConns(1)
	database.SetMaxIdleConns(1)

	if err := database.Ping(); err != nil {
		return nil, err
	}

	return &DB{database}, nil
}
