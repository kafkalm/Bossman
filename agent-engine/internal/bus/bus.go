package bus

import (
	"sync"
)

// Bus is an in-memory pub/sub message bus
// Subscribers receive a copy of each message via a channel
type Bus struct {
	mu          sync.RWMutex
	subscribers map[string][]chan BusMessage // projectID → subscriber channels
}

// New creates a new Bus
func New() *Bus {
	return &Bus{
		subscribers: make(map[string][]chan BusMessage),
	}
}

// Publish sends a message to all subscribers of its project
func (b *Bus) Publish(msg BusMessage) {
	b.mu.RLock()
	chans := b.subscribers[msg.ProjectID]
	b.mu.RUnlock()

	for _, ch := range chans {
		// Non-blocking send; slow consumers are dropped
		select {
		case ch <- msg:
		default:
		}
	}
}

// Subscribe creates a buffered channel that receives messages for projectID.
// Call the returned unsubscribe function to clean up.
func (b *Bus) Subscribe(projectID string) (<-chan BusMessage, func()) {
	ch := make(chan BusMessage, 64)

	b.mu.Lock()
	b.subscribers[projectID] = append(b.subscribers[projectID], ch)
	b.mu.Unlock()

	unsub := func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		subs := b.subscribers[projectID]
		for i, c := range subs {
			if c == ch {
				b.subscribers[projectID] = append(subs[:i], subs[i+1:]...)
				break
			}
		}
		close(ch)
	}
	return ch, unsub
}
