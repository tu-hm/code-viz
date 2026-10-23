package main

import "testing"

func TestPickSandbox(t *testing.T) {
	tests := []struct {
		name    string
		vizEnv  string
		sandbox string
		want    string
	}{
		{"dev defaults to docker", "dev", "", "docker"},
		{"dev allows docker", "dev", "docker", "docker"},
		{"test allows docker", "test", "docker", "docker"},
		{"staging refuses docker", "staging", "docker", ""},
		{"prod refuses docker", "prod", "docker", ""},
		{"prod allows runsc", "prod", "runsc", "runsc"},
		{"staging allows nsjail", "staging", "nsjail", "nsjail"},
		{"test requires a sandbox", "test", "", ""},
		{"prod requires a sandbox", "prod", "", ""},
		{"unknown sandbox is refused", "dev", "firecracker", ""},
		{"unknown env is refused", "production", "runsc", ""},
		{"missing env is refused", "", "docker", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := pickSandbox(tc.vizEnv, tc.sandbox)
			if got != tc.want || (err == nil) != (tc.want != "") {
				t.Errorf("pickSandbox(%q, %q) = %q, %v; want %q", tc.vizEnv, tc.sandbox, got, err, tc.want)
			}
		})
	}
}
