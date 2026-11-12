package gatewaytransport

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/quic-go/quic-go"
)

// Config is passed over the parent's private stdin pipe, never command-line
// arguments or environment variables. The caller owns permission and target policy.
type Config struct {
	Version    int    `json:"version"`
	Mode       string `json:"mode"`
	Host       string `json:"host"`
	ServerName string `json:"serverName,omitempty"`
	Port       int    `json:"port"`
	CA         string `json:"ca"`
	Cert       string `json:"cert"`
	Key        string `json:"key"`
	IdentityID string `json:"identityId"`
	OrgID      string `json:"orgId"`
	Command    string `json:"command"`
}

type Status struct {
	Version int    `json:"version"`
	Ready   bool   `json:"ready,omitempty"`
	Port    int    `json:"port,omitempty"`
	OK      bool   `json:"ok,omitempty"`
	Error   string `json:"error,omitempty"`
}

func clientTLS(config *Config) (*tls.Config, error) {
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM([]byte(config.CA)) {
		return nil, errors.New("invalid gateway CA")
	}
	certificate, err := tls.X509KeyPair([]byte(config.Cert), []byte(config.Key))
	if err != nil {
		return nil, errors.New("invalid gateway client certificate")
	}
	serverName := config.ServerName
	if serverName == "" {
		serverName = config.Host
	}
	return &tls.Config{
		MinVersion:   tls.VersionTLS13,
		RootCAs:      roots,
		Certificates: []tls.Certificate{certificate},
		ServerName:   serverName,
		// Deployed v1 peers use BoringSSL without hybrid key exchange. Keeping
		// their supported groups avoids fragmented hybrid ClientHello failures.
		CurvePreferences: []tls.CurveID{tls.X25519, tls.CurveP256},
		NextProtos:       []string{"vaultix-gateway"},
		VerifyConnection: func(state tls.ConnectionState) error {
			if len(state.PeerCertificates) == 0 {
				return errors.New("gateway certificate required")
			}
			subject := state.PeerCertificates[0].Subject
			if subject.CommonName != config.IdentityID || len(subject.Organization) != 1 || subject.Organization[0] != config.OrgID || len(subject.OrganizationalUnit) != 1 || subject.OrganizationalUnit[0] != "Gateway" {
				return errors.New("gateway certificate identity does not match this organization")
			}
			return nil
		},
	}, nil
}

func validate(config *Config) error {
	if config.Version != 1 || (config.Mode != "ping" && config.Mode != "proxy") {
		return errors.New("unsupported gateway transport request")
	}
	if config.Host == "" || config.Port < 1 || config.Port > 65535 || config.IdentityID == "" || config.OrgID == "" {
		return errors.New("gateway address and identity are required")
	}
	if config.Mode == "proxy" {
		command := strings.TrimSuffix(config.Command, "\n")
		if len(command) > 512*1024 || strings.ContainsAny(command, "\r\n\x00") || (!strings.HasPrefix(command, "FORWARD-TCP ") && command != "FORWARD-HTTP" && !strings.HasPrefix(command, "FORWARD-HTTP ")) {
			return errors.New("invalid gateway forwarding command")
		}
		if config.Command != command+"\n" {
			return errors.New("gateway command requires a line terminator")
		}
	}
	return nil
}

// Run copies the request so TLS callbacks and stream workers retain an immutable
// request even if the caller reuses its Config after starting this operation.
func Run(ctx context.Context, config Config, notify func(Status) error) error { //nolint:gocritic // the request value copy is an intentional ownership boundary
	if err := validate(&config); err != nil {
		return err
	}
	tlsConfig, err := clientTLS(&config)
	if err != nil {
		return err
	}
	connection, err := quic.DialAddr(ctx, net.JoinHostPort(config.Host, strconv.Itoa(config.Port)), tlsConfig, &quic.Config{
		HandshakeIdleTimeout:  15 * time.Second,
		MaxIdleTimeout:        90 * time.Second,
		KeepAlivePeriod:       30 * time.Second,
		MaxIncomingStreams:    -1,
		MaxIncomingUniStreams: -1,
	})
	if err != nil {
		return fmt.Errorf("gateway handshake failed: %w", err)
	}
	defer connection.CloseWithError(0, "Vaultix transport closed") //nolint:errcheck // terminal cleanup; the operation result is already determined
	stop := context.AfterFunc(ctx, func() {
		// Cancellation is terminal; closing an already closed peer has no recovery.
		_ = connection.CloseWithError(0, "Vaultix operation canceled") //nolint:errcheck // terminal cancellation cleanup
	})
	defer stop()
	if config.Mode == "ping" {
		stream, openErr := connection.OpenStreamSync(ctx)
		if openErr != nil {
			return openErr
		}
		defer stream.CancelRead(0)
		defer stream.CancelWrite(0)
		if err := stream.SetDeadline(time.Now().Add(15 * time.Second)); err != nil {
			return err
		}
		if _, err = io.WriteString(stream, "PING\n"); err != nil {
			return err
		}
		// ReadFull accepts fragmented responses and the deployed protocol's bare PONG.
		response := make([]byte, 4)
		if _, err = io.ReadFull(stream, response); err != nil {
			return errors.New("gateway closed before PONG")
		}
		if string(response) != "PONG" {
			return errors.New("unexpected gateway ping response")
		}
		return notify(Status{Version: 1, OK: true})
	}
	listener, err := (&net.ListenConfig{}).Listen(ctx, "tcp4", "127.0.0.1:0")
	if err != nil {
		return err
	}
	defer listener.Close() //nolint:errcheck // terminal cleanup; a concurrent cancellation can already close it
	operationCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	stopListener := context.AfterFunc(operationCtx, func() { _ = listener.Close() }) //nolint:errcheck // closing releases Accept; there is no recovery after cancellation
	defer stopListener()
	stopConnection := context.AfterFunc(connection.Context(), cancel)
	defer stopConnection()
	var workers sync.WaitGroup
	defer workers.Wait()
	address, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		return errors.New("invalid local gateway listener")
	}
	if err := notify(Status{Version: 1, Ready: true, Port: address.Port}); err != nil {
		return err
	}
	for {
		local, acceptErr := listener.Accept()
		if acceptErr != nil {
			cancel()
			if ctx.Err() != nil {
				return nil
			}
			if connection.Context().Err() != nil {
				return errors.New("gateway connection closed")
			}
			return acceptErr
		}
		workers.Add(1)
		go func() {
			defer workers.Done()
			forward(operationCtx, connection, local, config.Command)
		}()
	}
}

func forward(ctx context.Context, connection *quic.Conn, local net.Conn, command string) {
	defer local.Close()                                               //nolint:errcheck // terminal cleanup, including already closed sockets
	stopLocal := context.AfterFunc(ctx, func() { _ = local.Close() }) //nolint:errcheck // cancellation must release pending socket reads
	defer stopLocal()
	stream, err := connection.OpenStreamSync(ctx)
	if err != nil {
		return
	}
	defer stream.CancelRead(0)
	defer stream.CancelWrite(0)
	if _, err = io.WriteString(stream, command); err != nil {
		return
	}
	var send sync.WaitGroup
	send.Add(1)
	go func() {
		defer send.Done()
		if _, copyErr := io.Copy(stream, local); copyErr != nil {
			stream.CancelRead(1)
			stream.CancelWrite(1)
			return
		}
		if closeErr := stream.Close(); closeErr != nil {
			stream.CancelRead(1)
		}
	}()
	if _, copyErr := io.Copy(local, stream); copyErr != nil {
		stream.CancelRead(1)
	}
	// Close releases a pending local read, including when the peer resets a stream.
	_ = local.Close() //nolint:errcheck // terminal shutdown; still cancel the QUIC write and join its worker if close fails
	// A sender can also be blocked on QUIC flow control, after its local read.
	// Cancel that write before waiting for it; closing TCP alone cannot release it.
	stream.CancelWrite(0)
	send.Wait()
}
