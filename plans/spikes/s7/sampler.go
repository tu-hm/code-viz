// Command sampler polls one cgroup's memory.stat every 5 ms until the cgroup empties or goes away,
// then prints the largest anon, file and shmem it saw, and anon and file at the largest total.
// usage: sampler <container id>
package main

import (
	"bufio"
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

type stat struct{ anon, file, shmem int64 }

func read(dir string) (stat, bool) {
	data, err := os.ReadFile(filepath.Join(dir, "memory.stat"))
	if err != nil {
		return stat{}, false
	}
	var s stat
	sc := bufio.NewScanner(bytes.NewReader(data))
	for sc.Scan() {
		name, value, _ := bytes.Cut(sc.Bytes(), []byte(" "))
		n, _ := strconv.ParseInt(string(value), 10, 64)
		switch string(name) {
		case "anon":
			s.anon = n
		case "file":
			s.file = n
		case "shmem":
			s.shmem = n
		}
	}
	return s, true
}

func populated(dir string) bool {
	data, err := os.ReadFile(filepath.Join(dir, "cgroup.events"))
	return err == nil && bytes.Contains(data, []byte("populated 1"))
}

func main() {
	id := os.Args[1]
	dirs := []string{"/cg/docker/" + id, "/cg/system.slice/docker-" + id + ".scope"}
	var dir string
	for start := time.Now(); dir == ""; time.Sleep(time.Millisecond) {
		if time.Since(start) > time.Minute {
			fmt.Println("no cgroup for", id)
			os.Exit(1)
		}
		for _, d := range dirs {
			if populated(d) {
				dir = d
			}
		}
	}
	var top, atPeak stat
	samples := 0
	for {
		s, ok := read(dir)
		if !ok || !populated(dir) {
			break
		}
		samples++
		top.anon = max(top.anon, s.anon)
		top.file = max(top.file, s.file)
		top.shmem = max(top.shmem, s.shmem)
		if s.anon+s.file > atPeak.anon+atPeak.file {
			atPeak = s
		}
		time.Sleep(5 * time.Millisecond)
	}
	const mib = 1 << 20
	fmt.Printf("%.1f\t%.1f\t%.1f\t%.1f\t%.1f\t%d\n",
		float64(top.anon)/mib, float64(top.file)/mib, float64(top.shmem)/mib,
		float64(atPeak.anon)/mib, float64(atPeak.file)/mib, samples)
}
