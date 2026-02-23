package cuid

import "github.com/nrednav/cuid2"

// Generate returns a new cuid2-compatible ID, matching Prisma's @default(cuid())
func Generate() string {
	return cuid2.Generate()
}
