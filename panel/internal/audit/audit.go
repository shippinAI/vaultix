// Package audit appends one JSON line per secret-adjacent action. The
// contract marks Vaultix auditRequired; this is the panel-side half of that.
package audit

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

type Event struct {
	Time   time.Time `json:"ts"`
	User   string    `json:"user"`
	Action string    `json:"action"`
	Target string    `json:"target,omitempty"`
	OK     bool      `json:"ok"`
	Detail string    `json:"detail,omitempty"`
}

type Log struct {
	mu   sync.Mutex
	path string

	// Optional SIEM stream valve (doc 0003). Empty streamURL => closed.
	streamURL string
	client    *http.Client
}

// New returns an audit log writing to path; empty path logs to stderr only.
func New(path string) *Log { return &Log{path: path} }

// WithStream opens the audit-stream valve: every event is also POSTed to
// streamURL (best-effort, async). Empty streamURL leaves it closed.
func (l *Log) WithStream(streamURL string) *Log {
	l.streamURL = streamURL
	l.client = &http.Client{Timeout: 5 * time.Second}
	return l
}

func (l *Log) Record(user, action, target string, ok bool, detail string) {
	ev := Event{Time: time.Now().UTC(), User: user, Action: action, Target: target, OK: ok, Detail: detail}
	line, err := json.Marshal(ev)
	if err != nil {
		return
	}
	log.Printf("audit %s", line)
	if l.streamURL != "" {
		go l.stream(line)
	}
	if l.path == "" {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	f, err := os.OpenFile(l.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		log.Printf("audit: cannot open %s: %v", l.path, err)
		return
	}
	defer f.Close()
	f.Write(append(line, '\n'))
}

// stream POSTs one event to the SIEM sink, best-effort. Never blocks Record.
func (l *Log) stream(line []byte) {
	resp, err := l.client.Post(l.streamURL, "application/json", bytes.NewReader(line))
	if err != nil {
		log.Printf("audit stream: %v", err)
		return
	}
	resp.Body.Close()
}
