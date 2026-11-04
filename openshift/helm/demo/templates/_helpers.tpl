{{- define "chart.labels" -}}
app.kubernetes.io/part-of: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{/* Container hardening for restricted-v2: no runAsUser/runAsGroup/fsGroup,
     so OpenShift assigns a UID from the namespace range. */}}
{{- define "chart.containerSecurity" -}}
securityContext:
  runAsNonRoot: true
  allowPrivilegeEscalation: false
  capabilities:
    drop: ["ALL"]
  seccompProfile:
    type: RuntimeDefault
{{- end -}}

{{- define "chart.image" -}}
{{ .root.Values.registry }}/{{ .root.Release.Namespace }}/{{ .name }}:{{ .root.Values.imageTag }}
{{- end -}}

{{/* Pod template for one service.
     dict: root, name, svc, version ("v1"/"v2"), native (bool) */}}
{{- define "chart.podTemplate" -}}
{{- $ := .root -}}
{{- $name := .name -}}
{{- $svc := .svc -}}
metadata:
  labels:
    app.kubernetes.io/name: {{ $name }}
    app.kubernetes.io/part-of: {{ $.Release.Name }}
    {{- if $.Values.mesh.enabled }}
    istio.io/rev: {{ $.Values.mesh.revision }}
    version: {{ .version }}
    {{- end }}
  annotations:
    # Env from a ConfigMap is read at pod start: roll the pods when it changes.
    checksum/config: {{ include (print $.Template.BasePath "/config.yaml") $ | sha256sum }}
    {{- if and $.Values.observability.enabled (not .native) (ne (toString $svc.instrument) "false") }}
    instrumentation.opentelemetry.io/inject-java: "{{ $.Release.Name }}-java"
    {{- end }}
spec:
  {{- if and $svc.db $.Values.postgres.enabled }}
  # Hibernate connects at boot; without this the service restarts while
  # Postgres initialises. The JVM image (also for a native service) has
  # bash's /dev/tcp, so nothing extra is pulled. With the mesh on, the
  # native istio-proxy sidecar starts first, so this goes through it.
  initContainers:
    - name: wait-for-postgres
      image: {{ include "chart.image" (dict "root" $ "name" $name) | quote }}
      command: ["bash", "-c", "until (exec 3<>/dev/tcp/{{ $.Release.Name }}-postgres-rw/5432) 2>/dev/null; do echo waiting for {{ $.Release.Name }}-postgres-rw:5432; sleep 2; done"]
      resources:
        requests: {cpu: 10m, memory: 32Mi}
        limits: {memory: 64Mi}
      {{- include "chart.containerSecurity" $ | nindent 6 }}
  {{- end }}
  containers:
    - name: {{ $name }}
      {{- if .native }}
      image: {{ include "chart.image" (dict "root" $ "name" (printf "%s-native" $name)) | quote }}
      {{- else }}
      image: {{ include "chart.image" (dict "root" $ "name" $name) | quote }}
      {{- end }}
      imagePullPolicy: Always
      ports:
        - name: http
          containerPort: 8080
        {{- with $svc.grpcPort }}
        - name: grpc
          containerPort: {{ . }}
        {{- end }}
      envFrom:
        - configMapRef:
            name: {{ $.Release.Name }}-app-config
      env:
        {{- if and $svc.javaToolOptions (not .native) }}
        - name: JAVA_TOOL_OPTIONS
          value: {{ $svc.javaToolOptions | quote }}
        {{- end }}
        {{- if and $svc.db $.Values.postgres.enabled }}
        - name: QUARKUS_DATASOURCE_USERNAME
          valueFrom:
            secretKeyRef: {name: {{ $.Release.Name }}-postgres-app, key: username}
        - name: QUARKUS_DATASOURCE_PASSWORD
          valueFrom:
            secretKeyRef: {name: {{ $.Release.Name }}-postgres-app, key: password}
        {{- end }}
        {{- range $k, $v := $svc.env }}
        - name: {{ $k }}
          value: {{ $v | quote }}
        {{- end }}
      {{- if eq ($svc.probe | default "http") "tcp" }}
      startupProbe:
        tcpSocket: {port: http}
        periodSeconds: 5
        failureThreshold: 60
      readinessProbe:
        tcpSocket: {port: http}
        periodSeconds: 10
      {{- else }}
      startupProbe:
        httpGet: {path: /q/health/started, port: http}
        initialDelaySeconds: 5
        periodSeconds: 5
        failureThreshold: 60
      readinessProbe:
        httpGet: {path: /q/health/ready, port: http}
        periodSeconds: 10
        failureThreshold: 3
      livenessProbe:
        httpGet: {path: /q/health/live, port: http}
        periodSeconds: 10
        failureThreshold: 3
      {{- end }}
      resources:
        {{- toYaml $svc.resources | nindent 8 }}
      {{- include "chart.containerSecurity" $ | nindent 6 }}
{{- end -}}
