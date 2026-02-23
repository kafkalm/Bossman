BINARY=agent-engine

.PHONY: run build clean tidy

run:
	go run ./main.go

build:
	CGO_ENABLED=1 go build -o $(BINARY) ./main.go

tidy:
	go mod tidy

clean:
	rm -f $(BINARY)
