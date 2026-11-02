package platform

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

func digest(b []byte) string { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }
func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func configPath(root, name string) string { return filepath.Join(root, "config", name) }

func privateDirectory(path string, create bool) (string, error) {
	root, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if create {
		if err = os.MkdirAll(root, 0700); err != nil {
			return "", err
		}
	}
	info, err := os.Lstat(root)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("instance directory must be a real directory")
	}
	real, err := filepath.EvalSymlinks(root)
	if err != nil || real != root {
		return "", errors.New("instance directory cannot traverse links")
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0 {
		return "", errors.New("instance directory must have mode 0700")
	}
	return root, nil
}

func privateRead(path string, limit int64) ([]byte, error) {
	real, err := filepath.EvalSymlinks(path)
	if err != nil {
		return nil, err
	}
	if real != path {
		return nil, errors.New("lifecycle files cannot traverse links")
	}
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > limit || runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("lifecycle file must be bounded, private and regular")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return nil, errors.New("lifecycle file changed")
	}
	return releaseRead(f, limit)
}

func newFile(path string, data []byte) error {
	if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
		return errors.New("refusing to replace an existing lifecycle file")
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".pending-")
	if err != nil {
		return err
	}
	temp := f.Name()
	defer os.Remove(temp)
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(data)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if err = os.Rename(temp, path); err != nil {
		return err
	}
	return syncDirectory(filepath.Dir(path))
}

func newJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return newFile(path, append(b, '\n'))
}

func loadState(root string) (*State, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	var names []string
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "event-") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	if len(names) > 10000 {
		return nil, errors.New("lifecycle journal capacity reached")
	}
	var last *State
	previous := ""
	for index, name := range names {
		if name != fmt.Sprintf("event-%08d.json", index+1) {
			return nil, errors.New("lifecycle journal sequence gap")
		}
		raw, err := privateRead(filepath.Join(root, name), 1024*1024)
		if err != nil {
			return nil, err
		}
		var state State
		if err = decode(raw, &state); err != nil {
			return nil, err
		}
		if err = state.validate(); err != nil {
			return nil, err
		}
		if state.Sequence != index+1 || state.Previous != previous {
			return nil, errors.New("lifecycle journal chain mismatch")
		}
		previous = digest(raw)
		last = &state
	}
	return last, nil
}

func saveState(root string, s *State, phase string) error {
	last, err := loadState(root)
	if err != nil {
		return err
	}
	s.Sequence = 1
	s.Previous = ""
	if last != nil {
		s.Sequence = last.Sequence + 1
		raw, err := privateRead(filepath.Join(root, fmt.Sprintf("event-%08d.json", last.Sequence)), 1024*1024)
		if err != nil {
			return err
		}
		s.Previous = digest(raw)
	}
	s.SchemaVersion = Schema
	s.Phase = phase
	s.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if err = s.validate(); err != nil {
		return err
	}
	return newJSON(filepath.Join(root, fmt.Sprintf("event-%08d.json", s.Sequence)), s)
}

func configuration(root string) (string, error) {
	var all []byte
	for _, name := range []string{"instance.json", "compose.yml", "vaultix.env"} {
		raw, err := privateRead(configPath(root, name), 1024*1024)
		if err != nil {
			return "", err
		}
		all = append(all, []byte(name+"\x00"+digest(raw)+"\n")...)
	}
	return digest(all), nil
}
