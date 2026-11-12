{{/*
Expand the name of the chart.
*/}}
{{- define "vaultix.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "vaultix.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Create unified labels for vaultix components
*/}}
{{- define "vaultix.common.matchLabels" -}}
app: {{ template "vaultix.name" . }}
release: {{ .Release.Name }}
{{- end -}}

{{- define "vaultix.common.metaLabels" -}}
chart: {{ template "vaultix.chart" . }}
heritage: {{ .Release.Service }}
{{- end -}}

{{- define "vaultix.common.labels" -}}
{{ include "vaultix.common.matchLabels" . }}
{{ include "vaultix.common.metaLabels" . }}
{{- end -}}

{{- define "vaultix.labels" -}}
{{ include "vaultix.matchLabels" . }}
{{ include "vaultix.common.metaLabels" . }}
{{- end -}}

{{- define "vaultix.matchLabels" -}}
component: {{ .Values.vaultix.name | quote }}
{{ include "vaultix.common.matchLabels" . }}
{{- end -}}

{{- define "vaultix.roleName" -}}
{{- printf "%s-vaultix" .Release.Name -}}
{{- end -}}

{{- define "vaultix.roleBindingName" -}}
{{- printf "%s-vaultix" .Release.Name -}}
{{- end -}}

{{- define "vaultix.serviceAccountName" -}}
{{- if .Values.vaultix.serviceAccount.create -}}
{{- printf "%s-vaultix" .Release.Name -}}
{{- else -}}
{{- .Values.vaultix.serviceAccount.name | default "default" -}}
{{- end -}}
{{- end -}}


{{/*
Create a fully qualified backend name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
*/}}
{{- define "vaultix.fullname" -}}
{{- if .Values.vaultix.fullnameOverride -}}
{{- .Values.vaultix.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- printf "%s-%s" .Release.Name .Values.vaultix.name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s-%s" .Release.Name $name .Values.vaultix.name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "vaultix.postgresService" -}}
{{- if .Values.postgresql.fullnameOverride -}}
{{- .Values.postgresql.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-postgresql" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "vaultix.postgresDBConnectionString" -}}
{{- $dbUsername := .Values.postgresql.auth.username -}}
{{- $dbPassword := .Values.postgresql.auth.password -}}
{{- $dbName := .Values.postgresql.auth.database -}}
{{- $serviceName := include "vaultix.postgresService" . -}}
{{- printf "postgresql://%s:%s@%s:5432/%s" $dbUsername $dbPassword $serviceName $dbName -}}
{{- end -}}

{{/*
Create a fully qualified redis name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
*/}}
{{- define "vaultix.redis.fullname" -}}
{{- if .Values.redis.fullnameOverride -}}
{{- .Values.redis.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- printf "%s-%s" .Release.Name .Values.redis.name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s-%s" .Release.Name $name .Values.redis.name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}


{{- define "vaultix.redisServiceName" -}}
{{- if .Values.redis.fullnameOverride -}}
{{- printf "%s-master" .Values.redis.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-master" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}


{{- define "vaultix.redisConnectionString" -}}
{{- $password := .Values.redis.auth.password -}}
{{- $serviceName := include "vaultix.redisServiceName" . -}}
{{- printf "redis://default:%s@%s:6379" $password "redis-master" -}}
{{- end -}}