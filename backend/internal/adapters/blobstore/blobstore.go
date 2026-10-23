// Package blobstore keeps trace chunks in an S3-compatible bucket: AWS S3, R2, GCS or SeaweedFS.
package blobstore

import (
	"bytes"
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/aws/ratelimit"
	"github.com/aws/aws-sdk-go-v2/aws/retry"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/tu-hm/code-viz/backend/internal/domain"
)

type Config struct {
	Endpoint  string // empty: AWS S3
	Bucket    string
	PathStyle bool
}

type Bucket struct {
	client *s3.Client
	name   string
}

// New takes the region and credentials from the AWS SDK's default chain: AWS_REGION, AWS_ACCESS_KEY_ID and so on.
func New(ctx context.Context, cfg Config) (*Bucket, error) {
	awsCfg, err := config.LoadDefaultConfig(ctx, config.WithRetryer(func() aws.Retryer {
		return retry.NewStandard(func(o *retry.StandardOptions) {
			o.MaxAttempts = 4              // first try + 3 retries (§7.8)
			o.RateLimiter = ratelimit.None // sdk default token bucket => no retries once ~100 have failed
		})
	}))
	if err != nil {
		return nil, fmt.Errorf("load aws config: %w", err)
	}
	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		if cfg.Endpoint != "" {
			o.BaseEndpoint = aws.String(cfg.Endpoint)
		}
		o.UsePathStyle = cfg.PathStyle
	})
	return &Bucket{client: client, name: cfg.Bucket}, nil
}

func (b *Bucket) Put(ctx context.Context, key string, gz []byte) error {
	_, err := b.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:          aws.String(b.name),
		Key:             aws.String(key),
		Body:            bytes.NewReader(gz),
		ContentType:     aws.String("application/json"),
		ContentEncoding: aws.String("gzip"),
		CacheControl:    aws.String("private, max-age=86400, immutable"),
	})
	if err != nil {
		return fmt.Errorf("put %s: %w: %w", key, domain.ErrInfra, err)
	}
	return nil
}
