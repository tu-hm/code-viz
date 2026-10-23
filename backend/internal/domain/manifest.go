package domain

import "time"

// Manifest is one language adapter's manifest (§10.2), validated when it is loaded.
type Manifest struct {
	ID             string
	DisplayName    string
	EditorMode     string
	Enabled        bool
	Image          string
	SourceFile     string
	Build          *Build // nil: the language has no build step
	TraceCmd       []string
	TraceEnv       []string // KEY=value, sorted by key
	AllowedModules []string
	Capabilities   Capabilities
}

type Build struct {
	Cmd                   []string
	Timeout               time.Duration
	UnsupportedModuleExit int
}

type Capabilities struct {
	ReturnValues  bool
	Pointers      bool
	Exceptions    bool
	StartAtLines  bool
	CaptureRanges bool
}
