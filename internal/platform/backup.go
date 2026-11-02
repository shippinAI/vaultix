package platform

import (
	"errors"
	"io"
	"strings"

	"filippo.io/age"
)

func releaseRead(r io.Reader, limit int64) ([]byte, error) {
	b, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil || int64(len(b)) > limit {
		return nil, errors.New("lifecycle input exceeds limit")
	}
	return b, nil
}

// Use the maintained age streaming format and native hybrid recipient. Recovery
// keys are independent of application encryption keys and never enter arguments.
func newRecoveryKey() ([]byte, error) {
	identity, err := age.GenerateHybridIdentity()
	if err != nil {
		return nil, err
	}
	return []byte(identity.String() + "\n"), nil
}
func recoveryIdentity(key []byte) (*age.HybridIdentity, error) {
	if len(key) > 8192 {
		return nil, errors.New("invalid recovery key")
	}
	id, err := age.ParseHybridIdentity(strings.TrimSpace(string(key)))
	if err != nil {
		return nil, errors.New("invalid recovery key")
	}
	return id, nil
}
func encryptBackup(dst io.Writer, src io.Reader, key []byte) error {
	identity, err := recoveryIdentity(key)
	if err != nil {
		return err
	}
	writer, err := age.Encrypt(dst, identity.Recipient())
	if err != nil {
		return errors.New("cannot initialize encrypted checkpoint")
	}
	if _, err = io.Copy(writer, src); err != nil {
		return err
	}
	if err = writer.Close(); err != nil {
		return errors.New("cannot finish encrypted checkpoint")
	}
	return nil
}
func decryptBackup(dst io.Writer, src io.Reader, key []byte) error {
	identity, err := recoveryIdentity(key)
	if err != nil {
		return err
	}
	reader, err := age.Decrypt(src, identity)
	if err != nil {
		return errors.New("checkpoint decryption failed")
	}
	if _, err = io.Copy(dst, reader); err != nil {
		return errors.New("checkpoint authentication or restore stream failed")
	}
	return nil
}
