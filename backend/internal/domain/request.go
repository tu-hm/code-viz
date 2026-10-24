package domain

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"slices"

	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
)

// §11 defaults, the same for every language until manifests carry limits
const (
	MaxSource       = 64 << 10
	MaxStdin        = 64 << 10
	DefaultMaxSteps = 1000
	MaxStepsCeiling = 5000
)

// CheckRequest checks a create request for the language of manifest m against §8.2 and §11.
// Errors wrap ErrPayloadTooLarge or ErrInvalidRequest, and their text is fit to show the caller.
func CheckRequest(m Manifest, source, stdin string, opts trace.Options) error {
	if len(source) > MaxSource {
		return fmt.Errorf("source is %d bytes, over the %d KB limit: %w", len(source), MaxSource>>10, ErrPayloadTooLarge)
	}
	if len(stdin) > MaxStdin {
		return fmt.Errorf("stdin is %d bytes, over the %d KB limit: %w", len(stdin), MaxStdin>>10, ErrPayloadTooLarge)
	}
	if opts.MaxSteps < 1 || opts.MaxSteps > MaxStepsCeiling {
		return fmt.Errorf("maxSteps must be between 1 and %d: %w", MaxStepsCeiling, ErrInvalidRequest)
	}
	if len(opts.StartAtLines) > 0 && !m.Capabilities.StartAtLines {
		return fmt.Errorf("%s doesn't support startAtLines: %w", m.ID, ErrInvalidRequest)
	}
	for _, line := range opts.StartAtLines {
		if line < 1 {
			return fmt.Errorf("startAtLines has line %d, but lines start at 1: %w", line, ErrInvalidRequest)
		}
	}
	if len(opts.CaptureRanges) > 0 && !m.Capabilities.CaptureRanges {
		return fmt.Errorf("%s doesn't support captureRanges: %w", m.ID, ErrInvalidRequest)
	}
	for name, ranges := range opts.CaptureRanges {
		for _, r := range ranges {
			if len(r) != 2 || r[0] < 0 || r[1] < 0 {
				return fmt.Errorf("captureRanges of %q must be pairs of indexes from 0: %w", name, ErrInvalidRequest)
			}
		}
	}
	if !SafetyChecks(opts) && (m.Build == nil || len(m.Build.SafetyFlags) == 0) {
		return fmt.Errorf("%s has no safety checks to switch off: %w", m.ID, ErrInvalidRequest)
	}
	return nil
}

// SafetyChecks reports whether opts build with the language's safety checks: on unless switched off (D21).
func SafetyChecks(opts trace.Options) bool {
	return opts.SafetyChecks == nil || *opts.SafetyChecks
}

// NormalizeOptions returns opts in one form for all options that trace the same (§7.12): start lines and each
// variable's ranges sorted without repeats, and no variable without ranges, showInternals that is false or
// safetyChecks that is true.
func NormalizeOptions(opts trace.Options) trace.Options {
	lines := append([]int{}, opts.StartAtLines...)
	slices.Sort(lines)
	n := trace.Options{MaxSteps: opts.MaxSteps, StartAtLines: slices.Compact(lines)}
	for name, ranges := range opts.CaptureRanges {
		if len(ranges) == 0 {
			continue
		}
		ranges = slices.Clone(ranges)
		slices.SortFunc(ranges, slices.Compare[[]int])
		if n.CaptureRanges == nil {
			n.CaptureRanges = map[string][][]int{}
		}
		n.CaptureRanges[name] = slices.CompactFunc(ranges, slices.Equal[[]int])
	}
	if opts.ShowInternals != nil && *opts.ShowInternals {
		n.ShowInternals = opts.ShowInternals
	}
	if !SafetyChecks(opts) {
		n.SafetyChecks = opts.SafetyChecks
	}
	return n
}

// CacheKey is the sha256 of everything that decides a trace: language, runtime and adapter versions, source, stdin
// and normalized options (§7.12). Manifests carry no versions, so m.Image stands for both: its tag pins the runtime and the tracer.
func CacheKey(m Manifest, source, stdin string, opts trace.Options) ([32]byte, error) {
	o, err := json.Marshal(NormalizeOptions(opts))
	if err != nil {
		return [32]byte{}, fmt.Errorf("encode options: %w", err)
	}
	var b []byte
	for _, field := range [][]byte{[]byte(m.ID), []byte(m.Image), []byte(source), []byte(stdin), o} {
		// length prefix => fields can't run together
		b = binary.BigEndian.AppendUint64(b, uint64(len(field)))
		b = append(b, field...)
	}
	return sha256.Sum256(b), nil
}
