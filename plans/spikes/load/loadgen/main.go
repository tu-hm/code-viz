// Command loadgen drives vizd's HTTP API for the load spike (plans/spikes/load-capacity.md).
//
//	loadgen create -c 32 -d 15s          POST distinct Python programs from random client IPs
//	loadgen get -c 32 -d 15s -id viz_…   GET one completed visualization, which signs its chunk URLs
//	loadgen park -n 5000 -ids file       park long-polls on queued visualizations, then wake them
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"os"
	"os/exec"
	"slices"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

var base = "http://127.0.0.1:18080/api/v1"

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: loadgen create|get|park [flags]")
		os.Exit(2)
	}
	fs := flag.NewFlagSet(os.Args[1], flag.ExitOnError)
	conc := fs.Int("c", 32, "concurrent clients")
	dur := fs.Duration("d", 15*time.Second, "how long to send")
	id := fs.String("id", "", "visualization to GET")
	n := fs.Int("n", 5000, "long-polls to park")
	ids := fs.String("ids", "", "file of queued visualization ids, one per line")
	out := fs.String("out", "", "file to write created ids to")
	trigger := fs.String("trigger", "", "shell command that bumps the parked traces' versions")
	rss := fs.String("rss", "", "shell command that prints vizd's memory while the long-polls are parked")
	fs.StringVar(&base, "base", base, "API base URL")
	if err := fs.Parse(os.Args[2:]); err != nil {
		os.Exit(2)
	}
	client := &http.Client{Transport: &http.Transport{MaxIdleConnsPerHost: 10000, MaxConnsPerHost: 0}, Timeout: 60 * time.Second}

	switch os.Args[1] {
	case "create":
		var mu sync.Mutex
		var created []string
		var seq atomic.Int64
		res := closedLoop(*conc, *dur, func() (int, error) {
			i := seq.Add(1)
			src := fmt.Sprintf("total = %d\nfor i in range(2000):\n    total += i\nprint(total)\n", i+rand.Int64N(1<<40))
			body, _ := json.Marshal(map[string]any{
				"language": "python3", "source": src, "stdin": "",
				"options": map[string]any{"maxSteps": 1000, "startAtLines": []int{}},
				"context": map[string]any{"problemCode": nil, "client": "loadgen"},
			})
			req, _ := http.NewRequest(http.MethodPost, base+"/visualizations", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Forwarded-For", fmt.Sprintf("10.%d.%d.%d", rand.IntN(256), rand.IntN(256), rand.IntN(256)))
			resp, err := client.Do(req)
			if err != nil {
				return 0, err
			}
			defer resp.Body.Close()
			var v struct {
				ID string `json:"id"`
			}
			if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&v); err == nil && v.ID != "" {
				mu.Lock()
				created = append(created, v.ID)
				mu.Unlock()
			}
			return resp.StatusCode, nil
		})
		res.print("create")
		if *out != "" {
			if err := os.WriteFile(*out, []byte(strings.Join(created, "\n")+"\n"), 0o644); err != nil {
				fmt.Fprintln(os.Stderr, err)
				os.Exit(1)
			}
		}
	case "get":
		res := closedLoop(*conc, *dur, func() (int, error) {
			resp, err := client.Get(base + "/visualizations/" + *id)
			if err != nil {
				return 0, err
			}
			defer resp.Body.Close()
			if _, err := io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20)); err != nil {
				return 0, err
			}
			return resp.StatusCode, nil
		})
		res.print("get")
	case "park":
		park(client, *n, *ids, *trigger, *rss)
	default:
		fmt.Fprintln(os.Stderr, "unknown command", os.Args[1])
		os.Exit(2)
	}
}

type result struct {
	wall      time.Duration
	latencies []time.Duration
	codes     map[int]int
	errors    int
	firstErr  string
}

func closedLoop(conc int, dur time.Duration, do func() (int, error)) result {
	var mu sync.Mutex
	res := result{codes: map[int]int{}}
	stop := time.Now().Add(dur)
	start := time.Now()
	var wg sync.WaitGroup
	for range conc {
		wg.Go(func() {
			var lat []time.Duration
			codes := map[int]int{}
			errs := 0
			firstErr := ""
			for time.Now().Before(stop) {
				t := time.Now()
				code, err := do()
				if err != nil {
					errs++
					firstErr = err.Error()
					continue
				}
				lat = append(lat, time.Since(t))
				codes[code]++
			}
			mu.Lock()
			res.latencies = append(res.latencies, lat...)
			for c, k := range codes {
				res.codes[c] += k
			}
			res.errors += errs
			if firstErr != "" {
				res.firstErr = firstErr
			}
			mu.Unlock()
		})
	}
	wg.Wait()
	res.wall = time.Since(start)
	return res
}

func (r result) print(name string) {
	slices.Sort(r.latencies)
	q := func(p float64) time.Duration {
		if len(r.latencies) == 0 {
			return 0
		}
		return r.latencies[int(p*float64(len(r.latencies)-1))]
	}
	fmt.Printf("%s: %d requests in %.1fs = %.0f req/s; p50 %v p95 %v p99 %v max %v; codes %v; errors %d %s\n",
		name, len(r.latencies), r.wall.Seconds(), float64(len(r.latencies))/r.wall.Seconds(),
		q(0.5).Round(10*time.Microsecond), q(0.95).Round(10*time.Microsecond), q(0.99).Round(10*time.Microsecond),
		q(1).Round(10*time.Microsecond), r.codes, r.errors, r.firstErr)
}

func park(client *http.Client, n int, idsFile, trigger, rss string) {
	f, err := os.Open(idsFile)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	var ids []string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if s := strings.TrimSpace(sc.Text()); s != "" {
			ids = append(ids, s)
		}
	}
	f.Close()

	type parked struct {
		code int
		done time.Time
	}
	results := make([]parked, n)
	var started, failed atomic.Int64
	var firstErr atomic.Value
	var wg sync.WaitGroup
	for i := range n {
		wg.Go(func() {
			url := fmt.Sprintf("%s/visualizations/%s?wait=20&since=0", base, ids[i%len(ids)])
			started.Add(1)
			resp, err := client.Get(url)
			if err != nil {
				failed.Add(1)
				firstErr.CompareAndSwap(nil, err.Error())
				return
			}
			_, _ = io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			results[i] = parked{code: resp.StatusCode, done: time.Now()}
		})
	}
	time.Sleep(5 * time.Second)
	fmt.Printf("park: %d long-polls sent\n", started.Load())
	if rss != "" {
		out, _ := exec.Command("sh", "-c", rss).Output()
		fmt.Printf("park: vizd memory while parked: %s", out)
	}
	time.Sleep(time.Second)
	woke := time.Now()
	if trigger != "" {
		if out, err := exec.Command("sh", "-c", trigger).CombinedOutput(); err != nil {
			fmt.Fprintf(os.Stderr, "trigger: %v: %s\n", err, out)
		}
	}
	wg.Wait()

	var lat []time.Duration
	codes := map[int]int{}
	early := 0
	for _, r := range results {
		if r.done.IsZero() {
			continue
		}
		codes[r.code]++
		if r.done.Before(woke) {
			early++
			continue
		}
		lat = append(lat, r.done.Sub(woke))
	}
	sort.Slice(lat, func(a, b int) bool { return lat[a] < lat[b] })
	q := func(p float64) time.Duration {
		if len(lat) == 0 {
			return 0
		}
		return lat[int(p*float64(len(lat)-1))]
	}
	fmt.Printf("park: %d answered after the trigger: p50 %v p95 %v p99 %v max %v; %d answered before it; codes %v; errors %d %v\n",
		len(lat), q(0.5).Round(time.Millisecond), q(0.95).Round(time.Millisecond), q(0.99).Round(time.Millisecond),
		q(1).Round(time.Millisecond), early, codes, failed.Load(), firstErr.Load())
}
