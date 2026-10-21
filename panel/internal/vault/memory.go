package vault

import (
	"context"
	"crypto/cipher"
	"fmt"
	"strings"
	"sync"
	"time"
)

type memSecret struct {
	id        string
	meta      SecretMeta
	nonce     []byte
	ct        []byte
	versions  []memVersion
}

type memVersion struct {
	id     string
	ver    int
	nonce  []byte
	ct     []byte
	actor  string
	at     time.Time
}

type memInject struct {
	id        string
	hash      string
	boxID     string
	env       string
	name      string
	actor     string
	exp       time.Time
	consumed  time.Time
}

// Memory is the in-process engine used by tests. Same seal as Postgres.
type Memory struct {
	mu      sync.Mutex
	aead    cipher.AEAD
	boxes   map[string]Box
	secrets map[string]*memSecret // box\x00env\x00name
	injects map[string]*memInject // handle hash
}

func OpenMemory(keyHex string) (*Memory, error) {
	aead, err := aeadFromHex(keyHex)
	if err != nil {
		return nil, err
	}
	return &Memory{
		aead:    aead,
		boxes:   map[string]Box{},
		secrets: map[string]*memSecret{},
		injects: map[string]*memInject{},
	}, nil
}

func secretKey(boxID, env, name string) string { return boxID + "\x00" + env + "\x00" + name }

func (m *Memory) Healthy(context.Context) error { return nil }

func (m *Memory) CountBoxes(context.Context) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.boxes), nil
}

func (m *Memory) CreateBox(_ context.Context, tenant, name string) (Box, error) {
	name = trimName(name)
	if name == "" || tenant == "" {
		return Box{}, fmt.Errorf("vault: tenant and name required")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now().UTC()
	slug := m.uniqueSlugLocked(tenant, slugify(name))
	b := Box{ID: newID(), TenantID: tenant, Name: name, Slug: slug, CreatedAt: now, UpdatedAt: now}
	m.boxes[b.ID] = b
	return b, nil
}

func (m *Memory) EnsureBox(_ context.Context, id, tenant, name string) (Box, error) {
	if id == "" {
		return m.CreateBox(context.Background(), tenant, name)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if b, ok := m.boxes[id]; ok {
		return b, nil
	}
	name = trimName(name)
	if name == "" {
		name = id
	}
	if tenant == "" {
		return Box{}, fmt.Errorf("vault: tenant required")
	}
	now := time.Now().UTC()
	slug := m.uniqueSlugLocked(tenant, slugify(name))
	b := Box{ID: id, TenantID: tenant, Name: name, Slug: slug, CreatedAt: now, UpdatedAt: now}
	m.boxes[id] = b
	return b, nil
}

func (m *Memory) GetBox(_ context.Context, id string) (Box, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	b, ok := m.boxes[id]
	if !ok {
		return Box{}, ErrNotFound
	}
	return b, nil
}

func (m *Memory) uniqueSlugLocked(tenant, slug string) string {
	taken := map[string]bool{}
	for _, b := range m.boxes {
		if b.TenantID == tenant {
			taken[b.Slug] = true
		}
	}
	if !taken[slug] {
		return slug
	}
	return slug + "-" + newID()[:8]
}

func (m *Memory) PutSecret(_ context.Context, boxID, env, name, value, actor string) (SecretMeta, error) {
	if err := requireCoords(boxID, env, name); err != nil {
		return SecretMeta{}, err
	}
	if value == "" {
		return SecretMeta{}, fmt.Errorf("vault: value required")
	}
	nonce, ct, err := seal(m.aead, value)
	if err != nil {
		return SecretMeta{}, err
	}
	now := time.Now().UTC()
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.boxes[boxID]; !ok {
		return SecretMeta{}, ErrNotFound
	}
	k := secretKey(boxID, env, name)
	s, ok := m.secrets[k]
	if !ok {
		s = &memSecret{id: newID()}
		m.secrets[k] = s
	}
	ver := 1
	if ok {
		ver = s.meta.Version + 1
	}
	s.nonce, s.ct = nonce, ct
	s.meta = SecretMeta{BoxID: boxID, Env: env, Name: name, Version: ver, UpdatedAt: now, UpdatedBy: actor}
	s.versions = append(s.versions, memVersion{id: newID(), ver: ver, nonce: nonce, ct: ct, actor: actor, at: now})
	return s.meta, nil
}

func (m *Memory) GetSecretMeta(_ context.Context, boxID, env, name string) (SecretMeta, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.secrets[secretKey(boxID, env, name)]
	if !ok {
		return SecretMeta{}, ErrNotFound
	}
	return s.meta, nil
}

func (m *Memory) ListSecretMeta(_ context.Context, boxID, env string) ([]SecretMeta, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.boxes[boxID]; !ok {
		return nil, ErrNotFound
	}
	var out []SecretMeta
	for _, s := range m.secrets {
		if s.meta.BoxID == boxID && (env == "" || s.meta.Env == env) {
			out = append(out, s.meta)
		}
	}
	return out, nil
}

func (m *Memory) Reveal(_ context.Context, boxID, env, name string) (string, error) {
	m.mu.Lock()
	s, ok := m.secrets[secretKey(boxID, env, name)]
	if !ok {
		m.mu.Unlock()
		return "", ErrNotFound
	}
	nonce, ct := s.nonce, s.ct
	m.mu.Unlock()
	return open(m.aead, nonce, ct)
}

func (m *Memory) MintInject(_ context.Context, boxID, env, name, actor string, ttl time.Duration) (string, time.Time, error) {
	if err := requireCoords(boxID, env, name); err != nil {
		return "", time.Time{}, err
	}
	if ttl <= 0 {
		ttl = 90 * time.Second
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.secrets[secretKey(boxID, env, name)]; !ok {
		return "", time.Time{}, ErrNotFound
	}
	handle := newHandle()
	exp := time.Now().UTC().Add(ttl)
	h := hashHandle(handle)
	m.injects[h] = &memInject{id: newID(), hash: h, boxID: boxID, env: env, name: name, actor: actor, exp: exp}
	return handle, exp, nil
}

func (m *Memory) ConsumeInject(_ context.Context, handle string) (Redeem, error) {
	if handle == "" {
		return Redeem{}, ErrNotFound
	}
	h := hashHandle(handle)
	m.mu.Lock()
	inj, ok := m.injects[h]
	if !ok {
		m.mu.Unlock()
		return Redeem{}, ErrNotFound
	}
	if !inj.consumed.IsZero() {
		m.mu.Unlock()
		return Redeem{}, ErrConsumed
	}
	if time.Now().After(inj.exp) {
		m.mu.Unlock()
		return Redeem{}, ErrExpired
	}
	s, ok := m.secrets[secretKey(inj.boxID, inj.env, inj.name)]
	if !ok {
		m.mu.Unlock()
		return Redeem{}, ErrNotFound
	}
	nonce, ct := s.nonce, s.ct
	inj.consumed = time.Now().UTC()
	boxID, env, name := inj.boxID, inj.env, inj.name
	m.mu.Unlock()
	val, err := open(m.aead, nonce, ct)
	if err != nil {
		return Redeem{}, err
	}
	return Redeem{BoxID: boxID, Env: env, Name: name, Value: val}, nil
}

func trimName(name string) string {
	s := strings.TrimSpace(name)
	if len(s) > 120 {
		return s[:120]
	}
	return s
}
