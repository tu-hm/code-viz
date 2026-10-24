// Package blobstore keeps trace chunks in an S3-compatible bucket: AWS S3, R2, GCS or SeaweedFS.
package blobstore

import (
	"bytes"
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/aws/ratelimit"
	"github.com/aws/aws-sdk-go-v2/aws/retry"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"

	"github.com/tu-hm/code-viz/backend/internal/domain"
)

type Config struct {
	Endpoint       string // empty: AWS S3
	PublicEndpoint string // the host browsers reach; empty: Endpoint
	Bucket         string
	PathStyle      bool
}

type Bucket struct {
	client  *s3.Client
	presign *s3.PresignClient
	name    string
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
	public := client
	if cfg.PublicEndpoint != "" {
		// signature covers the host => sign for the host the browser fetches from
		public = s3.NewFromConfig(awsCfg, func(o *s3.Options) {
			o.BaseEndpoint = aws.String(cfg.PublicEndpoint)
			o.UsePathStyle = cfg.PathStyle
		})
	}
	return &Bucket{client: client, presign: s3.NewPresignClient(public), name: cfg.Bucket}, nil
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

func (b *Bucket) Sign(ctx context.Context, key string, ttl time.Duration) (string, error) {
	req, err := b.presign.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(b.name),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", fmt.Errorf("sign %s: %w", key, err)
	}
	return req.URL, nil
}

func (b *Bucket) Delete(ctx context.Context, keys []string) error {
	for batch := range slices.Chunk(keys, 1000) { // DeleteObjects takes at most 1,000 keys
		objects := make([]types.ObjectIdentifier, len(batch))
		for i, key := range batch {
			objects[i] = types.ObjectIdentifier{Key: aws.String(key)}
		}
		out, err := b.client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(b.name),
			Delete: &types.Delete{Objects: objects, Quiet: aws.Bool(true)},
		})
		if err != nil {
			return fmt.Errorf("delete %d objects: %w: %w", len(batch), domain.ErrInfra, err)
		}
		if len(out.Errors) > 0 {
			e := out.Errors[0]
			return fmt.Errorf("delete %s: %w: %s", aws.ToString(e.Key), domain.ErrInfra, aws.ToString(e.Message))
		}
	}
	return nil
}
