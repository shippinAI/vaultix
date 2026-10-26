package license

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"github.com/vaultix/api/internal/config"
)

func TestNewService_IncludedWithoutLicenseServer(t *testing.T) {
	svc := NewService(context.Background(), slog.New(slog.NewTextHandler(io.Discard, nil)), &Deps{
		Config: &config.Config{LicenseServerURL: "https://unused.invalid", LicenseServerKey: "obsolete"},
	})
	plan, err := svc.GetPlan(context.Background(), "org-1")
	if err != nil {
		t.Fatal(err)
	}
	if !plan.SecretApproval || !plan.SecretRotation || !plan.AuditLogs || !plan.DynamicSecret || !plan.RBAC || !plan.OidcSSO {
		t.Fatal("security features must be included")
	}
	if plan.MemberLimit != nil || plan.WorkspaceLimit != nil || plan.IdentityLimit != nil {
		t.Fatal("included features must not have paid capacity limits")
	}
	if svc.cloudAPI != nil || svc.onPremAPI != nil || svc.stopSync != nil {
		t.Fatal("Vaultix must not create billing clients or a license synchronization job")
	}
}
