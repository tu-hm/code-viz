//go:build !linux

package main

import (
	"context"
	"errors"

	"github.com/tu-hm/code-viz/backend/internal/ports"
)

func openNsjail(context.Context) (ports.Sandbox, error) {
	return nil, errors.New("nsjail runs on linux only; use VIZ_SANDBOX=docker")
}
