// vaultix-control is the private operator console for the hosted Vaultix service (docs/0125).
// It runs on the hosting server, listens on loopback only, and is reached over SSH or a private
// tunnel. It is a separate binary: the Vaultix image and `vaultix` command never contain it.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"time"

	"shippin.cloud/vaultix/platform/shippin/backups"
	"shippin.cloud/vaultix/platform/shippin/console"
	"shippin.cloud/vaultix/platform/shippin/fleet"
)

const usage = `usage: vaultix-control --control-directory DIR [--listen 127.0.0.1:8300] [--no-schedule]

Serves the private operator console for hosted customer instances. The control
directory holds the fleet record and operator.key, both readable only by the
operator. On first start the key is created there; open the file on the server
to sign in. Every five minutes it backs up each instance whose newest verified
backup is older than its profile allows (--no-schedule turns that off). Reach
the console over SSH, for example:
  ssh -L 8300:127.0.0.1:8300 operator@host`

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	fs := flag.NewFlagSet("vaultix-control", flag.ContinueOnError)
	fs.Usage = func() { fmt.Fprintln(os.Stderr, usage) }
	directory := fs.String("control-directory", "", "private control directory")
	listen := fs.String("listen", "127.0.0.1:8300", "loopback address")
	noSchedule := fs.Bool("no-schedule", false, "do not run scheduled backups")
	if err := fs.Parse(os.Args[1:]); err != nil || fs.NArg() != 0 || *directory == "" {
		return errors.New(usage)
	}
	if err := console.RequireLoopback(*listen); err != nil {
		return err
	}
	if err := os.MkdirAll(*directory, 0o700); err != nil {
		return err
	}
	f, err := fleet.Open(*directory, nil)
	if err != nil {
		return err
	}
	key, keyPath, err := console.OperatorKey(*directory)
	if err != nil {
		return err
	}
	server := &http.Server{Addr: *listen, Handler: console.New(f, key).Handler(), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 40 * time.Minute}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	if !*noSchedule {
		go schedule(ctx, f)
	}
	fmt.Fprintf(os.Stderr, "Vaultix Control on http://%s\nOperator key file: %s\n", *listen, keyPath)
	if err = server.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// One round at a time: a round that outlasts the interval delays the next instead of overlapping it.
func schedule(ctx context.Context, f *fleet.Fleet) {
	for {
		outcomes, err := backups.RunDue(ctx, f, nil, time.Now().UTC())
		if err != nil {
			fmt.Fprintf(os.Stderr, "scheduled backups: %v\n", err)
		}
		for _, o := range outcomes {
			if o.Error != "" {
				fmt.Fprintf(os.Stderr, "backup failed [label=%s]: %s\n", o.Label, o.Error)
			} else {
				fmt.Fprintf(os.Stderr, "backup kept [label=%s] [backup=%s]\n", o.Label, o.Backup)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Minute):
		}
	}
}
