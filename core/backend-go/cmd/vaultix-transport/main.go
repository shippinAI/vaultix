package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/signal"
	"syscall"

	"github.com/vaultix-cloud/api/internal/gatewaytransport"
)

func main() {
	os.Exit(run())
}

func run() int {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	output := json.NewEncoder(os.Stdout)
	notify := func(status gatewaytransport.Status) error { return output.Encode(status) }
	input := bufio.NewReaderSize(os.Stdin, 1024*1024)
	line, err := input.ReadSlice('\n')
	if err == nil {
		decoder := json.NewDecoder(bytes.NewReader(line))
		decoder.DisallowUnknownFields()
		var config gatewaytransport.Config
		err = decoder.Decode(&config)
		if err == nil {
			var extra any
			if decoder.Decode(&extra) != io.EOF {
				err = errors.New("invalid gateway transport request")
			}
		}
		if err == nil {
			// EOF means the owning operation (or parent process) has gone away.
			go func() {
				defer cancel()
				if _, copyErr := io.Copy(io.Discard, input); copyErr != nil {
					return // Broken parent input terminates the operation just like EOF.
				}
			}()
			err = gatewaytransport.Run(ctx, config, notify)
		}
	}
	if err != nil {
		// Provider errors can contain remote input. Keep IPC errors bounded and do
		// not serialize the request, certificates, private keys, or forwarded data.
		message := err.Error()
		if len(message) > 512 {
			message = "gateway transport failed"
		}
		if notifyErr := notify(gatewaytransport.Status{Version: 1, Error: message}); notifyErr != nil {
			return 1 // The parent pipe is unavailable; never expose the request on stderr.
		}
		return 1
	}
	return 0
}
