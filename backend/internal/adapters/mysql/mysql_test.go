package mysql_test

import (
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"
)

func TestOpenSessionsUseReadCommittedAndUTCWhateverTheDSNSays(t *testing.T) {
	t.Parallel()
	cfg := newDatabase(t)
	cfg.ParseTime = false
	cfg.Loc = time.Local
	cfg.Params = map[string]string{"transaction_isolation": "'REPEATABLE-READ'", "time_zone": "'+07:00'"}
	db := open(t, cfg)

	type session struct {
		Isolation string
		TimeZone  string
		Time      time.Time
		Location  string
	}
	var got session
	err := db.QueryRowContext(t.Context(),
		"SELECT @@transaction_isolation, @@session.time_zone, CAST('2026-10-24 08:12:03.000001' AS DATETIME(6))",
	).Scan(&got.Isolation, &got.TimeZone, &got.Time)
	if err != nil {
		t.Fatal(err)
	}
	got.Location = got.Time.Location().String()

	want := session{
		Isolation: "READ-COMMITTED",
		TimeZone:  "+00:00",
		Time:      time.Date(2026, 10, 24, 8, 12, 3, 1000, time.UTC),
		Location:  "UTC",
	}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Errorf("session (-want +got):\n%s", diff)
	}
}
