#!/bin/bash

# Stoky — prepara una instalación / prepares an installation.
#
#   bash install.sh [vVERSION]
#
# Downloads one release's installation files into the current directory,
# verifies them against that release's SHA256SUMS, and creates whatever
# configuration is missing: `.env` from `example.env`, with the two secrets
# generated. It changes no value that is already set, and it never starts,
# pulls or stops anything — reviewing `.env` and starting Stoky is the
# operator's step, by design. Running it again is safe.
#
# Guide: https://github.com/NGarate/stoky/blob/master/docs/INSTALL.md
set -euo pipefail

# The release this copy installs. scripts/release-assets.sh refuses a tag
# this line disagrees with, so an attached install.sh installs its own release.
DEFAULT_VERSION=v0.1.0-alpha.4

VERSION="${1:-$DEFAULT_VERSION}"
# Overridable so a release can be served from a directory (file://): the
# tests do, and so can a maintainer checking packaged assets before a release.
# An operator has no use for it.
BASE_URL="${STOKY_RELEASE_BASE_URL:-https://github.com/NGarate/stoky/releases/download}"
FILES=(docker-compose.yml example.env traefik.yml)
# The project name fixed in docker-compose.yml, which names its volumes.
DATABASE_VOLUME=stoky-release_postgres_data

fail() {
  echo "Error: $*" >&2
  exit 1
}

if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]]; then
  fail "se esperaba una versión como $DEFAULT_VERSION, no '$VERSION'."
fi
for tool in curl sha256sum openssl; do
  command -v "$tool" > /dev/null || fail "hace falta $tool y no está instalado."
done
if [ "$(uname -m)" != x86_64 ]; then
  echo "Aviso: Stoky solo publica imágenes Linux amd64; este equipo es $(uname -m)." >&2
fi

# Everything is downloaded and verified before anything in the installation
# directory is touched: a failed download or checksum leaves it as it was.
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> Descargando Stoky $VERSION"
# GitHub answers each download with a redirect, and --location would follow
# one to plain http: SHA256SUMS arrives over the same hops as the files, so a
# downgraded hop could swap both and the check below would pass. Redirects are
# therefore https-only, at TLS 1.2 or later. Not --proto '=https': the default
# BASE_URL is a literal https URL, and the override above must still reach a
# file:// release.
for file in "${FILES[@]}" SHA256SUMS; do
  curl --fail --silent --show-error --location --proto-redir '=https' --tlsv1.2 \
    --output "$WORK/$file" "$BASE_URL/$VERSION/$file" \
    || fail "no se pudo descargar $file de $VERSION. Revisa la versión y la conexión."
done

echo "==> Comprobando las sumas SHA-256"
# Each required file must have its own line: `sha256sum -c` alone would pass
# a SHA256SUMS that simply did not list one of them.
for file in "${FILES[@]}"; do
  grep -E "^[0-9a-f]{64}  $file\$" "$WORK/SHA256SUMS" > "$WORK/check" \
    || fail "el SHA256SUMS de $VERSION no incluye $file."
  # Not --quiet: BusyBox's sha256sum, on Alpine hosts, does not have it.
  (cd "$WORK" && sha256sum -c check > /dev/null) \
    || fail "$file no coincide con la suma publicada para $VERSION. No se ha cambiado nada."
done

# A file already here is kept if identical and refused if not: replacing the
# Compose or Traefik file of a running installation is an upgrade, and the
# guide's upgrade steps (backup first) are the way to do one.
for file in "${FILES[@]}" SHA256SUMS; do
  if [ -e "$file" ] && ! cmp -s "$file" "$WORK/$file"; then
    fail "$file ya existe y es distinto del de $VERSION. Para actualizar, sigue la sección de actualización de la guía. No se ha cambiado nada."
  fi
done

ENV_EXISTS=false
[ -e .env ] && ENV_EXISTS=true
env_value() {
  # The value of KEY in .env, without surrounding quotes; empty if unset.
  sed -n "s/^$1=//p" .env | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}
env_has() {
  grep -q "^$1=" .env
}
if { [ "$ENV_EXISTS" = false ] || [ -z "$(env_value POSTGRES_PASSWORD)" ]; } \
   && command -v docker > /dev/null; then
  # PostgreSQL keeps the password it was created with. A new one in .env would
  # not reach the database; it would only lock the application out of it.
  #
  # Only "no such volume" means there is none. Any other failure — most often
  # permission denied on Docker's socket, for a user outside the docker group —
  # says nothing about the volume, and reading it as "absent" wrote a fresh
  # password over the one the database still holds.
  if inspect_error=$(docker volume inspect "$DATABASE_VOLUME" 2>&1 > /dev/null); then
    fail "falta POSTGRES_PASSWORD en .env, pero el volumen de la base de datos $DATABASE_VOLUME ya existe. Recupera la contraseña con la que se creó. No se ha cambiado nada."
  elif ! printf '%s' "$inspect_error" | grep -qi "no such volume"; then
    fail "no se puede preguntar a Docker si existe el volumen $DATABASE_VOLUME ($inspect_error). Ejecuta el script con un usuario que pueda usar Docker. No se ha cambiado nada."
  fi
fi

for file in "${FILES[@]}" SHA256SUMS; do
  if [ -e "$file" ]; then
    echo "    conservado $file (idéntico)"
  else
    cp "$WORK/$file" "$file"
    echo "    creado     $file"
  fi
done
# Traefik runs with every capability dropped and cannot read a file only its
# owner can; a restrictive umask would otherwise leave it serving 404s.
chmod 644 docker-compose.yml example.env traefik.yml SHA256SUMS

echo "==> Configurando .env"
if [ "$ENV_EXISTS" = false ]; then
  (umask 077 && cp example.env .env)
  echo "    creado     .env a partir de example.env"
fi
chmod 600 .env

CHANGED=false

# Every setting example.env declares, added if missing; the two secrets
# generated if missing or empty. A value already set is never changed.
while IFS= read -r line; do
  key="${line%%=*}"
  case "$key" in
    POSTGRES_PASSWORD | STOKY_SECRET)
      if [ -z "$(env_value "$key")" ]; then
        secret="$(openssl rand -hex 32)"
        if env_has "$key"; then
          sed -i "s/^$key=.*/$key=$secret/" .env
        else
          printf '%s=%s\n' "$key" "$secret" >> .env
        fi
        echo "    generado   $key"
        CHANGED=true
      fi
      ;;
    *)
      if ! env_has "$key"; then
        printf '%s\n' "$line" >> .env
        echo "    añadido    $line"
        CHANGED=true
      fi
      ;;
  esac
done < <(grep -E '^[A-Z_][A-Z0-9_]*=' example.env)
[ "$CHANGED" = true ] || echo "    conservado .env (ya tiene todos los ajustes)"

if [ "$(env_value STOKY_VERSION)" != "$VERSION" ]; then
  echo "Aviso: .env indica STOKY_VERSION=$(env_value STOKY_VERSION), no $VERSION. Se ha dejado como estaba." >&2
fi

MISSING=()
for key in DOMAIN ACME_EMAIL; do
  [ -n "$(env_value "$key")" ] || MISSING+=("$key")
done

echo
echo "Stoky $VERSION está listo para configurar en $(pwd). No se ha arrancado nada."
echo
if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "1. Edita .env y rellena: ${MISSING[*]}"
  echo "   DOMAIN es solo el nombre (stoky.example.com), con el DNS apuntando a este servidor;"
  echo "   ACME_EMAIL es el correo al que escribe Let's Encrypt."
else
  echo "1. Revisa .env."
fi
echo "   No compartas .env: contiene la contraseña de la base de datos y el secreto de sesión."
echo "2. Cuando esté revisado, arranca Stoky:"
echo
echo "     docker compose config --quiet"
echo "     docker compose pull"
echo "     docker compose up -d --wait --wait-timeout 180"
echo
echo "Guía: https://github.com/NGarate/stoky/blob/master/docs/INSTALL.md"
