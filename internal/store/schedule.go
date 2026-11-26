package store

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Schedule bounds: the shortest interval we will run an automation is 15
// minutes (protects the scheduler and the AI provider quota); the longest is
// one week (168 hours).
const (
	minScheduleInterval = 15 * time.Minute
	maxScheduleInterval = 168 * time.Hour
)

// Schedule is a parsed automation schedule spec, either a fixed interval
// ("every:<N>m" | "every:<N>h") or a daily time-of-day ("daily:HH:MM").
type Schedule struct {
	// Interval is set for "every:" specs.
	Interval time.Duration
	// DailyHour / DailyMinute are set for "daily:" specs (24h clock).
	DailyHour   int
	DailyMinute int

	daily bool
}

// ParseSchedule accepts "every:<N>m" | "every:<N>h" (N >= 1, total interval
// between 15m and 168h) and "daily:HH:MM" (24h clock). Returns ErrInvalid
// otherwise.
func ParseSchedule(spec string) (*Schedule, error) {
	spec = strings.TrimSpace(spec)
	switch {
	case strings.HasPrefix(spec, "every:"):
		body := spec[len("every:"):]
		if len(body) < 2 {
			return nil, fmt.Errorf("%w: bad interval spec", ErrInvalid)
		}
		nStr, unit := body[:len(body)-1], body[len(body)-1:]
		if !allDigits(nStr) {
			return nil, fmt.Errorf("%w: interval count must be a positive integer", ErrInvalid)
		}
		n, _ := strconv.Atoi(nStr)
		var d time.Duration
		switch unit {
		case "m":
			d = time.Duration(n) * time.Minute
		case "h":
			d = time.Duration(n) * time.Hour
		default:
			return nil, fmt.Errorf("%w: interval unit must be m or h", ErrInvalid)
		}
		if d < minScheduleInterval || d > maxScheduleInterval {
			return nil, fmt.Errorf("%w: interval out of range (15m..168h)", ErrInvalid)
		}
		return &Schedule{Interval: d}, nil
	case strings.HasPrefix(spec, "daily:"):
		body := spec[len("daily:"):]
		parts := strings.Split(body, ":")
		if len(parts) != 2 || len(parts[0]) != 2 || len(parts[1]) != 2 ||
			!allDigits(parts[0]) || !allDigits(parts[1]) {
			return nil, fmt.Errorf("%w: daily spec must be daily:HH:MM", ErrInvalid)
		}
		hh, _ := strconv.Atoi(parts[0])
		mm, _ := strconv.Atoi(parts[1])
		if hh > 23 || mm > 59 {
			return nil, fmt.Errorf("%w: daily time out of range", ErrInvalid)
		}
		return &Schedule{DailyHour: hh, DailyMinute: mm, daily: true}, nil
	default:
		return nil, fmt.Errorf("%w: unknown schedule spec", ErrInvalid)
	}
}

func allDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// Next returns the next run strictly after `after`. Intervals advance by the
// duration; daily specs resolve to the next occurrence of HH:MM in the same
// location as `after` (today if still ahead, else tomorrow).
func (sc *Schedule) Next(after time.Time) time.Time {
	if sc.daily {
		target := time.Date(after.Year(), after.Month(), after.Day(),
			sc.DailyHour, sc.DailyMinute, 0, 0, after.Location())
		if !target.After(after) {
			target = time.Date(after.Year(), after.Month(), after.Day()+1,
				sc.DailyHour, sc.DailyMinute, 0, 0, after.Location())
		}
		return target
	}
	return after.Add(sc.Interval)
}

// String returns the canonical spec.
func (sc *Schedule) String() string {
	if sc.daily {
		return fmt.Sprintf("daily:%02d:%02d", sc.DailyHour, sc.DailyMinute)
	}
	if sc.Interval%time.Hour == 0 {
		return fmt.Sprintf("every:%dh", int(sc.Interval/time.Hour))
	}
	return fmt.Sprintf("every:%dm", int(sc.Interval/time.Minute))
}
