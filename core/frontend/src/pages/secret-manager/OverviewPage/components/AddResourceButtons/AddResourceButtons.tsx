import {
  ChevronDown,
  ChevronsLeftRightEllipsisIcon,
  ClipboardPasteIcon,
  FingerprintIcon,
  FolderIcon,
  HexagonIcon,
  ImportIcon,
  PlugZapIcon,
  PlusIcon,
  RefreshCwIcon,
  UploadIcon
} from "lucide-react";

import { ProjectPermissionCan } from "@app/components/permissions";
import {
  Button,
  ButtonGroup,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@app/components/v3";
import { vaultixActionTrigger } from "@app/components/vaultix/action-trigger";
import {
  IMPORT_PROVIDER_DETAILS,
  IMPORT_PROVIDER_ORDER
} from "@app/components/vaultix/mcpl-manifest";
import { ProjectPermissionActions, ProjectPermissionSub } from "@app/context";
import { ProjectPermissionProxiedServiceActions } from "@app/context/ProjectPermissionContext/types";
import type { TImportProviderId } from "@app/hooks/api/migration/types";

type Props = {
  onAddSecret: () => void;
  onAddFolder: () => void;
  onAddDyanamicSecret: () => void;
  onAddSecretRotation: () => void;
  onAddHoneyToken: () => void;
  onAddProxiedService: () => void;
  onAddSecretImport: () => void;
  onImportSecrets: () => void;
  onReplicateSecrets: () => void;
  onImportFromVault: () => void;
  // null opens the provider cards; a provider opens its import directly.
  onImportFromProvider: (provider: TImportProviderId | null) => void;
  isDyanmicSecretAvailable: boolean;
  isSecretRotationAvailable: boolean;
  isHoneyTokenAvailable: boolean;
  isReplicateSecretsAvailable: boolean;
  isSecretImportAvailable: boolean;
  isSingleEnvSelected: boolean;
  hasVaultConnection: boolean;
  importProviderConnections: Partial<Record<TImportProviderId, number>>;
};

export function AddResourceButtons({
  onAddSecret,
  onAddFolder,
  onAddDyanamicSecret,
  onAddSecretRotation,
  onAddHoneyToken,
  onAddProxiedService,
  onAddSecretImport,
  onImportSecrets,
  onReplicateSecrets,
  onImportFromVault,
  onImportFromProvider,
  isDyanmicSecretAvailable,
  isSecretRotationAvailable,
  isHoneyTokenAvailable,
  isReplicateSecretsAvailable,
  isSecretImportAvailable,
  isSingleEnvSelected,
  hasVaultConnection,
  importProviderConnections
}: Props) {
  return (
    <ButtonGroup>
      <ProjectPermissionCan I={ProjectPermissionActions.Create} a={ProjectPermissionSub.Secrets}>
        {(isAllowed) => (
          <Tooltip open={!isAllowed ? undefined : false}>
            <TooltipTrigger>
              <Button
                className="rounded-r-none"
                isDisabled={!isAllowed}
                variant="project"
                onClick={onAddSecret}
              >
                <PlusIcon />
                Add Secret
              </Button>
            </TooltipTrigger>
            <TooltipContent>Access Denied</TooltipContent>
          </Tooltip>
        )}
      </ProjectPermissionCan>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton variant="project" aria-label="More ways to add">
            <ChevronDown />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>New</DropdownMenuLabel>
          <ProjectPermissionCan
            I={ProjectPermissionActions.Create}
            a={ProjectPermissionSub.SecretFolders}
          >
            {(isAllowed) => (
              <Tooltip open={!isAllowed ? undefined : false}>
                <TooltipTrigger className="block w-full">
                  <DropdownMenuItem onClick={onAddFolder} isDisabled={!isAllowed}>
                    <FolderIcon className="text-folder" />
                    Add Folder
                  </DropdownMenuItem>
                </TooltipTrigger>
                <TooltipContent side="left">Access Restricted</TooltipContent>
              </Tooltip>
            )}
          </ProjectPermissionCan>
          <Tooltip open={!isDyanmicSecretAvailable ? undefined : false}>
            <TooltipTrigger className="block w-full">
              <DropdownMenuItem
                onClick={onAddDyanamicSecret}
                isDisabled={!isDyanmicSecretAvailable}
              >
                <FingerprintIcon className="text-dynamic-secret" />
                Add Dynamic Secret
              </DropdownMenuItem>
            </TooltipTrigger>
            <TooltipContent side="left">Access restricted</TooltipContent>
          </Tooltip>
          <Tooltip open={!isSecretRotationAvailable ? undefined : false}>
            <TooltipTrigger className="block w-full">
              <DropdownMenuItem
                onClick={onAddSecretRotation}
                isDisabled={!isSecretRotationAvailable}
              >
                <RefreshCwIcon className="text-secret-rotation" />
                Add Secret Rotation
              </DropdownMenuItem>
            </TooltipTrigger>
            <TooltipContent side="left">Access restricted</TooltipContent>
          </Tooltip>
          <ProjectPermissionCan
            I={ProjectPermissionActions.Create}
            a={ProjectPermissionSub.HoneyTokens}
          >
            {(isAllowed) => (
              <Tooltip open={!isHoneyTokenAvailable || !isAllowed ? undefined : false}>
                <TooltipTrigger className="block w-full">
                  <DropdownMenuItem
                    onClick={onAddHoneyToken}
                    isDisabled={!isHoneyTokenAvailable || !isAllowed}
                  >
                    <HexagonIcon className="text-yellow" />
                    Add Honey Token
                  </DropdownMenuItem>
                </TooltipTrigger>
                <TooltipContent side="left">
                  {!isAllowed ? "Access Restricted" : "Access restricted"}
                </TooltipContent>
              </Tooltip>
            )}
          </ProjectPermissionCan>
          <ProjectPermissionCan
            I={ProjectPermissionProxiedServiceActions.Create}
            a={ProjectPermissionSub.ProxiedServices}
          >
            {(isAllowed) => (
              <Tooltip open={!isSingleEnvSelected || !isAllowed ? undefined : false}>
                <TooltipTrigger className="block w-full">
                  <DropdownMenuItem
                    onClick={onAddProxiedService}
                    isDisabled={!isSingleEnvSelected || !isAllowed}
                  >
                    <ChevronsLeftRightEllipsisIcon className="text-proxied-service" />
                    Add Proxied Service
                  </DropdownMenuItem>
                </TooltipTrigger>
                <TooltipContent side="left">
                  {!isAllowed
                    ? "Access Restricted"
                    : "Select a single environment to add a proxied service"}
                </TooltipContent>
              </Tooltip>
            )}
          </ProjectPermissionCan>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Bulk</DropdownMenuLabel>
          <Tooltip open={!isSecretImportAvailable || !isSingleEnvSelected ? undefined : false}>
            <TooltipTrigger className="block w-full">
              <DropdownMenuItem
                onClick={onAddSecretImport}
                isDisabled={!isSecretImportAvailable || !isSingleEnvSelected}
              >
                <ImportIcon className="text-import" />
                Add Secret Import
              </DropdownMenuItem>
            </TooltipTrigger>
            <TooltipContent side="left">
              {!isSecretImportAvailable
                ? "Access restricted"
                : "Select a single environment to add a secret import"}
            </TooltipContent>
          </Tooltip>
          <ProjectPermissionCan
            I={ProjectPermissionActions.Create}
            a={ProjectPermissionSub.Secrets}
          >
            {(isAllowed) => (
              <Tooltip open={!isAllowed ? undefined : false}>
                <TooltipTrigger className="block w-full">
                  <DropdownMenuItem onClick={onImportSecrets} isDisabled={!isAllowed}>
                    <UploadIcon className="text-accent" />
                    Upload Secrets
                  </DropdownMenuItem>
                </TooltipTrigger>
                <TooltipContent side="left">Access Restricted</TooltipContent>
              </Tooltip>
            )}
          </ProjectPermissionCan>
          <ProjectPermissionCan
            I={ProjectPermissionActions.Create}
            a={ProjectPermissionSub.SecretFolders}
          >
            {(isAllowed) => (
              <Tooltip open={!isReplicateSecretsAvailable || !isAllowed ? undefined : false}>
                <TooltipTrigger className="block w-full">
                  <DropdownMenuItem
                    onClick={onReplicateSecrets}
                    isDisabled={!isReplicateSecretsAvailable || !isAllowed}
                  >
                    <ClipboardPasteIcon className="text-accent" />
                    Replicate Secrets
                  </DropdownMenuItem>
                </TooltipTrigger>
                <TooltipContent side="left">
                  {!isReplicateSecretsAvailable
                    ? "Select a single environment to replicate secrets"
                    : "Access Denied"}
                </TooltipContent>
              </Tooltip>
            )}
          </ProjectPermissionCan>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>IMPORT FROM</DropdownMenuLabel>
          {hasVaultConnection && (
            <ProjectPermissionCan
              I={ProjectPermissionActions.Create}
              a={ProjectPermissionSub.Secrets}
            >
              {(isAllowed) => {
                let vaultImportTooltip: string;
                if (!hasVaultConnection) {
                  vaultImportTooltip = "No HashiCorp Vault connection found";
                } else if (!isSingleEnvSelected) {
                  vaultImportTooltip = "Select a single environment to import from Vault";
                } else {
                  vaultImportTooltip = "Access Restricted";
                }

                return (
                  <Tooltip
                    open={
                      !isAllowed || !isSingleEnvSelected || !hasVaultConnection ? undefined : false
                    }
                  >
                    <TooltipTrigger className="block w-full">
                      <DropdownMenuItem
                        onClick={onImportFromVault}
                        isDisabled={!isAllowed || !isSingleEnvSelected || !hasVaultConnection}
                      >
                        <div className="flex w-4.5 justify-center rounded-full bg-foreground/75">
                          <img
                            src="/images/integrations/Vault.png"
                            alt="HashiCorp Vault"
                            className="mt-0.5 h-4 w-4"
                          />
                        </div>
                        Add from HashiCorp Vault
                      </DropdownMenuItem>
                    </TooltipTrigger>
                    <TooltipContent side="left">{vaultImportTooltip}</TooltipContent>
                  </Tooltip>
                );
              }}
            </ProjectPermissionCan>
          )}
          <ProjectPermissionCan
            I={ProjectPermissionActions.Create}
            a={ProjectPermissionSub.Secrets}
          >
            {(isAllowed) => (
              <>
                {IMPORT_PROVIDER_ORDER.filter(
                  (provider) => (importProviderConnections[provider] ?? 0) > 0
                ).map((provider) => {
                  const details = IMPORT_PROVIDER_DETAILS[provider];
                  let tooltip: string | null = null;
                  if (!isSingleEnvSelected)
                    tooltip = `Select a single environment to import from ${details.name}`;
                  else if (!isAllowed) tooltip = "Access Restricted";
                  return (
                    <Tooltip key={provider} open={tooltip ? undefined : false}>
                      <TooltipTrigger className="block w-full">
                        <DropdownMenuItem
                          onClick={() => onImportFromProvider(provider)}
                          isDisabled={Boolean(tooltip)}
                          {...vaultixActionTrigger(details.actionId, {
                            scope: "secrets-overview",
                            target: provider
                          })}
                        >
                          <div className="flex w-4.5 justify-center rounded-full bg-foreground/75">
                            <img src={details.image} alt="" className="mt-0.5 h-4 w-4" />
                          </div>
                          Add from {details.name}
                        </DropdownMenuItem>
                      </TooltipTrigger>
                      <TooltipContent side="left">{tooltip}</TooltipContent>
                    </Tooltip>
                  );
                })}
                <Tooltip open={!isSingleEnvSelected || !isAllowed ? undefined : false}>
                  <TooltipTrigger className="block w-full">
                    <DropdownMenuItem
                      onClick={() => onImportFromProvider(null)}
                      isDisabled={!isSingleEnvSelected || !isAllowed}
                      {...vaultixActionTrigger("vaultix.ui.connect.import.providers", {
                        scope: "secrets-overview"
                      })}
                    >
                      <PlugZapIcon className="text-muted" />
                      Browse import providers…
                    </DropdownMenuItem>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    {!isSingleEnvSelected
                      ? "Select a single environment to import into"
                      : "Access Restricted"}
                  </TooltipContent>
                </Tooltip>
              </>
            )}
          </ProjectPermissionCan>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );
}
