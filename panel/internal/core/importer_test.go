package core

import (
	"strings"
	"testing"
)

func TestChunksByCount(t *testing.T) {
	items := make([]Secret, 250)
	for i := range items {
		items[i] = Secret{Key: "K", Value: "v"}
	}
	got := chunks(items)
	if len(got) != 3 || len(got[0]) != 100 || len(got[2]) != 50 {
		t.Fatalf("want 100+100+50, got %d chunks: %v", len(got), lens(got))
	}
}

func TestChunksBySize(t *testing.T) {
	big := strings.Repeat("x", 300*1024)
	items := []Secret{{Key: "A", Value: big}, {Key: "B", Value: big}, {Key: "C", Value: "small"}}
	got := chunks(items)
	// 300KB + 300KB exceeds the 512KB budget -> B starts a new chunk.
	if len(got) != 2 || len(got[0]) != 1 || len(got[1]) != 2 {
		t.Fatalf("want [A][B C], got %v", lens(got))
	}
}

func TestChunksEmpty(t *testing.T) {
	if got := chunks(nil); got != nil {
		t.Fatalf("nil in, want nil out, got %v", got)
	}
}

func lens(c [][]Secret) []int {
	out := make([]int, len(c))
	for i, x := range c {
		out[i] = len(x)
	}
	return out
}
