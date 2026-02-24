package engine

import "github.com/kafkalm/bossman/agent-engine/internal/db"

const maxCeoIterations = 200

// CEO is the rich model for a CEO agent. It owns its loop and is triggered by project IDs.
type CEO struct {
	id                 string
	companyID          string
	name               string
	iterations         map[string]int // projectID -> iteration count
	reviewNoActionRuns map[string]int // projectID -> consecutive review cycles with no tool actions
	svc                *Service
	trigger            chan string
}

// NewCEO creates a new CEO employee.
func NewCEO(emp db.EmployeeWithRole, svc *Service) *CEO {
	return &CEO{
		id:         emp.ID,
		companyID:  emp.CompanyID,
		name:       emp.Name,
		iterations: make(map[string]int),
		reviewNoActionRuns: make(map[string]int),
		svc:        svc,
		trigger:    make(chan string, 100),
	}
}
