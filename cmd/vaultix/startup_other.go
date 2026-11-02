//go:build !windows

package main

func commandArguments(args []string) []string {
	return args[1:]
}
