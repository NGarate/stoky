# The PostgreSQL the release bundle runs: the official Alpine image with
# Alpine's package fixes applied. Upstream rebuilds its images on its own
# schedule, and between rebuilds they carry fixes Alpine has already shipped:
# on 2026-11-12 every postgres:*-alpine tag had 19 fixable HIGH findings
# (krb5, libxslt) that `apk upgrade` clears. Nothing else differs from the
# official image — same entrypoint, environment and data layout — but two
# things that follow from never running as root:
#
# - It starts as postgres (70:70 on Alpine), as the bundle already runs it,
#   rather than as root.
# - gosu is gone. The entrypoint calls it only as root, to step down to
#   postgres, so as 70:70 it never runs. It is a Go binary built with an old
#   toolchain (Go 1.24.6 in 18.6), so every Go advisory since was matched
#   against it: 62 findings, 26 CRITICAL or HIGH, that every scan had to skip.
#   Started as root on purpose (`--user 0`), the entrypoint now stops at
#   "gosu: not found" instead of running PostgreSQL's setup as root.
#
# Built, scanned and published by .github/workflows/postgres-image.yml as
# ghcr.io/ngarate/stoky/postgres. Pinned by the digest of the multi-platform
# index, as the application's base is; the tag must name the same index
# (`docker buildx imagetools inspect postgres:<version>-alpine`).
FROM postgres:18.6-alpine@sha256:9ba53c7d41ea093baf5c1ba635ba5434c4f979880527d49bb7d9237d3193085b

RUN apk upgrade --no-cache && rm /usr/local/bin/gosu

USER 70:70
