package mysql

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/prometheus/client_golang/prometheus"

	"github.com/tu-hm/code-viz/backend/internal/gen/sqlc"
)

const countTimeout = 5 * time.Second

var queuedDesc = prometheus.NewDesc("vizd_jobs_queued", "Jobs waiting for a worker, counted at each scrape.", nil, nil)

// QueueDepth is a Prometheus collector that counts the queued jobs when scraped.
type QueueDepth struct {
	db *sql.DB
}

func NewQueueDepth(db *sql.DB) *QueueDepth {
	return &QueueDepth{db: db}
}

func (d *QueueDepth) Describe(ch chan<- *prometheus.Desc) {
	ch <- queuedDesc
}

func (d *QueueDepth) Collect(ch chan<- prometheus.Metric) {
	// Collect takes no ctx
	ctx, cancel := context.WithTimeout(context.Background(), countTimeout)
	defer cancel()
	n, err := sqlc.New(d.db).CountQueuedJobs(ctx)
	if err != nil {
		ch <- prometheus.NewInvalidMetric(queuedDesc, fmt.Errorf("count queued jobs: %w", err))
		return
	}
	ch <- prometheus.MustNewConstMetric(queuedDesc, prometheus.GaugeValue, float64(n))
}
