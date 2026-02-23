package engine

import (
	"context"
	"time"
)

const maxRetries = 3

// retryWithBackoff retries fn up to maxRetries times with exponential backoff (2s/4s/8s).
// onRetry is called before each retry attempt (attempt is 1-based).
func retryWithBackoff(ctx context.Context, fn func() error, onRetry func(attempt int, err error)) error {
	var lastErr error
	for attempt := 0; attempt < maxRetries; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		lastErr = fn()
		if lastErr == nil {
			return nil
		}
		if attempt < maxRetries-1 {
			delay := time.Duration(2<<uint(attempt)) * time.Second // 2s, 4s, 8s
			if onRetry != nil {
				onRetry(attempt+1, lastErr)
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(delay):
			}
		}
	}
	return lastErr
}
