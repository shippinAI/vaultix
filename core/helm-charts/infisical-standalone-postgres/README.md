# vaultix-standalone

![Version: 1.10.0](https://img.shields.io/badge/Version-1.10.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: 1.0.1](https://img.shields.io/badge/AppVersion-1.0.1-informational?style=flat-square)

A helm chart to deploy vaultix

## Requirements

| Repository | Name | Version |
|------------|------|---------|
| https://charts.bitnami.com/bitnami | postgresql | 14.1.3 |
| https://charts.bitnami.com/bitnami | redis | 18.14.0 |
| https://kubernetes.github.io/ingress-nginx | ingress-nginx | 4.0.13 |

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| fullnameOverride | string | `""` | Overrides the full name of the release, affecting resource names |
| vaultix.affinity | object | `{}` | Node affinity settings for pod placement |
| vaultix.containerSecurityContext | object | `{"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]},"readOnlyRootFilesystem":false,"runAsNonRoot":true,"runAsUser":1001,"seccompProfile":{"type":"RuntimeDefault"}}` | Container-level security context for vaultix's containers, including the bootstrap Job. Secure by default and compliant with the Pod Security "restricted" standard on its own. `readOnlyRootFilesystem` stays `false` because the app writes temporary files; to enable it, mount `emptyDir` volumes for writable paths like `/tmp` via `vaultix.extraVolumes` and `vaultix.extraVolumeMounts`. Set to `null` to omit. |
| vaultix.databaseSchemaMigrationJob.image.pullPolicy | string | `"IfNotPresent"` | Pulls image only if not present on the node |
| vaultix.databaseSchemaMigrationJob.image.repository | string | `"ghcr.io/groundnuty/k8s-wait-for"` | Image repository for migration wait job |
| vaultix.databaseSchemaMigrationJob.image.tag | string | `"no-root-v2.0"` | Image tag version |
| vaultix.deploymentAnnotations | object | `{}` | Custom annotations for vaultix deployment |
| vaultix.enabled | bool | `true` |  |
| vaultix.extraContainers | list | `[]` | Additional containers to run alongside the vaultix container (sidecars). Useful for running auxiliary services like HSM PKCS#11 clients |
| vaultix.extraEnv | list | `[]` | Extra environment variables to set on the vaultix container |
| vaultix.extraInitContainers | list | `[]` | Additional init containers to run before the vaultix container starts |
| vaultix.extraVolumeMounts | list | `[]` | Additional volume mounts for the vaultix container |
| vaultix.extraVolumes | list | `[]` | Additional volumes to attach to the vaultix pods |
| vaultix.fullnameOverride | string | `""` | Override for the full name of vaultix resources in this deployment |
| vaultix.image.imagePullSecrets | list | `[]` | Secret references for pulling the image, if needed |
| vaultix.image.pullPolicy | string | `"IfNotPresent"` | Pulls image only if not already present on the node |
| vaultix.image.repository | string | `"vaultix/vaultix"` | Image repository for the vaultix service |
| vaultix.image.tag | string | `"v0.93.1-postgres"` | Specific version tag of the vaultix image. View the latest version here https://hub.docker.com/r/vaultix/vaultix |
| vaultix.kubeSecretRef | string | `"vaultix-secrets"` | Kubernetes Secret reference containing vaultix root credentials |
| vaultix.name | string | `"vaultix"` |  |
| vaultix.podAnnotations | object | `{}` | Custom annotations for vaultix pods |
| vaultix.podSecurityContext | object | `{"fsGroup":1001}` | Pod-level security context for the vaultix pod. Sets only `fsGroup` so mounted volumes are writable by the non-root user. Other hardening lives in `containerSecurityContext`, so `extraContainers` and `extraInitContainers` keep their original user. Set to `null` to omit. |
| vaultix.replicaCount | int | `2` | Number of pod replicas for high availability |
| vaultix.resources.limits.memory | string | `"600Mi"` | Memory limit for vaultix container |
| vaultix.resources.requests.cpu | string | `"350m"` | CPU request for vaultix container |
| vaultix.service.annotations | object | `{}` | Custom annotations for vaultix service |
| vaultix.service.nodePort | string | `""` | Optional node port for service when using NodePort type |
| vaultix.service.type | string | `"ClusterIP"` | Service type, can be changed based on exposure needs (e.g., LoadBalancer) |
| vaultix.serviceAccount.annotations | object | `{}` | Custom annotations for the auto-created service account |
| vaultix.serviceAccount.create | bool | `true` | Creates a new service account if true, with necessary permissions for this chart. If false and `serviceAccount.name` is not defined, the chart will attempt to use the Default service account |
| vaultix.serviceAccount.name | string | `nil` | Optional custom service account name, if existing service account is used |
| ingress.annotations | object | `{}` | Custom annotations for ingress resource |
| ingress.enabled | bool | `true` | Enable or disable ingress configuration |
| ingress.hostName | string | `""` | Hostname for ingress access, e.g., app.example.com |
| ingress.ingressClassName | string | `""` | Specifies the ingress class. Defaults to "vaultix-nginx" when bundled ingress-nginx is enabled, or "nginx" otherwise |
| ingress.nginx.enabled | bool | `true` | Enable NGINX-specific settings, if using NGINX ingress controller |
| ingress.tls | list | `[]` | TLS settings for HTTPS access |
| nameOverride | string | `""` | Overrides the default release name |
| postgresql.auth.database | string | `"vaultixDB"` | Database name for vaultix |
| postgresql.auth.password | string | `"root"` | Password for PostgreSQL database access |
| postgresql.auth.username | string | `"vaultix"` | Database username for PostgreSQL |
| postgresql.enabled | bool | `true` | Enables an in-cluster PostgreSQL deployment. To achieve HA for Postgres, we recommend deploying https://github.com/zalando/postgres-operator instead. |
| postgresql.fullnameOverride | string | `"postgresql"` | Full name override for PostgreSQL resources |
| postgresql.name | string | `"postgresql"` | PostgreSQL resource name |
| postgresql.useExistingPostgresSecret.enabled | bool | `false` | Set to true if using an existing Kubernetes secret that contains PostgreSQL connection string |
| postgresql.useExistingPostgresSecret.existingConnectionStringSecret.key | string | `""` | Key name in the Kubernetes secret that holds the connection string |
| postgresql.useExistingPostgresSecret.existingConnectionStringSecret.name | string | `""` | Kubernetes secret name containing the PostgreSQL connection string |
| redis.architecture | string | `"standalone"` | Redis deployment type (e.g., standalone or cluster) |
| redis.auth.password | string | `"mysecretpassword"` | Redis password |
| redis.cluster.enabled | bool | `false` | Clustered Redis deployment |
| redis.enabled | bool | `true` | Enables an in-cluster Redis deployment |
| redis.fullnameOverride | string | `"redis"` | Full name override for Redis resources |
| redis.name | string | `"redis"` | Redis resource name |
| redis.usePassword | bool | `true` | Requires a password for Redis authentication |
| ingress-nginx.controller.ingressClassResource.name | string | `"vaultix-nginx"` | IngressClass name used by the bundled NGINX controller. Uses a unique name to avoid conflicts with existing cluster ingress controllers |
| ingress-nginx.controller.ingressClassResource.controllerValue | string | `"k8s.io/vaultix-nginx"` | Controller value for the bundled IngressClass |
| ingress-nginx.controller.ingressClassResource.default | bool | `false` | Whether the bundled IngressClass should be set as the cluster default |
| ingress-nginx.controller.ingressClass | string | `"vaultix-nginx"` | Ingress class the bundled controller watches for |
