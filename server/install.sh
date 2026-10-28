#!/usr/bin/env bash
# Instala (o actualiza) Jaque en un servidor Ubuntu: Stockfish 19 compilado para la CPU, la web,
# el servidor de server/index.mjs como servicio y Caddy delante con HTTPS automático.
# Pensado para Oracle Cloud Ampere A1 (ARM, 4 núcleos, 24 GB), pero vale para cualquier Ubuntu 22.04/24.04.
#
# Uso, en el servidor y con el usuario normal (ubuntu):
#   curl -fsSL https://raw.githubusercontent.com/MMV1105/Ajedrez/main/server/install.sh | bash
#   curl -fsSL ... | bash -s -- midominio.com          # con dominio propio
#   curl -fsSL ... | JAQUE_PASSWORD=algo bash          # pide usuario "jaque" y contraseña para entrar
# Sin dominio se usa <ip>.sslip.io, que apunta a la IP pública y permite tener HTTPS igualmente.
set -euo pipefail

DOMAIN="${1:-}"
REPO="https://github.com/MMV1105/Ajedrez.git"
APP=/opt/jaque
SF_TAG=sf_19
ENV_FILE=/etc/jaque.env

say() { printf '\n\033[1;33m== %s\033[0m\n' "$*"; }

. /etc/os-release
if [ "${ID:-}" != ubuntu ]; then
  echo "Este script es para Ubuntu (al crear la instancia en Oracle, elige la imagen Canonical Ubuntu)." >&2
  exit 1
fi

say "Paquetes del sistema"
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -q
sudo apt-get install -yq build-essential git curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https netfilter-persistent iptables-persistent

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  say "Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -yq nodejs
fi

if ! command -v caddy >/dev/null; then
  say "Caddy (HTTPS automático)"
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -q
  sudo apt-get install -yq caddy
fi

if ! /usr/local/bin/stockfish compiler 2>/dev/null | grep -q "Stockfish 19"; then
  say "Compilando Stockfish 19 (tarda unos minutos)"
  case "$(uname -m)" in
    aarch64) grep -qw asimddp /proc/cpuinfo && ARCH=armv8-dotprod || ARCH=armv8 ;;
    x86_64) grep -qw avx2 /proc/cpuinfo && ARCH=x86-64-avx2 || ARCH=x86-64-sse41-popcnt ;;
    *) ARCH=general-64 ;;
  esac
  BUILD=$(mktemp -d)
  git clone -q --depth 1 --branch "$SF_TAG" https://github.com/official-stockfish/Stockfish "$BUILD/sf"
  cd "$BUILD/sf/src"
  # La red neuronal se descarga con el Makefile; si falla, desde el almacén de GitHub.
  if ! make net >/dev/null 2>&1; then
    NET=$(grep -o 'nn-[0-9a-f]*\.nnue' evaluate.h | head -1)
    curl -fsSL -o "$NET" "https://media.githubusercontent.com/media/official-stockfish/networks/master/$NET"
  fi
  make -j"$(nproc)" profile-build ARCH="$ARCH" >/dev/null
  sudo install -m 755 stockfish /usr/local/bin/stockfish
  cd /
  rm -rf "$BUILD"
fi
/usr/local/bin/stockfish compiler | head -3

say "La web"
id jaque >/dev/null 2>&1 || sudo useradd --system --home-dir "$APP" --shell /usr/sbin/nologin jaque
if [ -d "$APP/.git" ]; then
  git -C "$APP" pull -q --ff-only
else
  sudo mkdir -p "$APP"
  sudo chown "$USER" "$APP"
  git clone -q "$REPO" "$APP"
fi
cd "$APP"
npm ci --no-audit --no-fund
npm run build

if [ ! -f "$ENV_FILE" ]; then
  # Cuatro hilos por motor; cada pestaña abierta usa uno o dos motores.
  sudo tee "$ENV_FILE" >/dev/null <<EOF
PORT=8080
HOST=127.0.0.1
STOCKFISH_PATH=/usr/local/bin/stockfish
ENGINE_THREADS=$(nproc)
ENGINE_HASH=1024
MAX_ENGINES=6
EOF
fi

sudo tee /etc/systemd/system/jaque.service >/dev/null <<EOF
[Unit]
Description=Jaque: web de ajedrez con Stockfish
After=network.target

[Service]
User=jaque
EnvironmentFile=$ENV_FILE
WorkingDirectory=$APP
ExecStart=/usr/bin/node server/index.mjs
Restart=always
RestartSec=2
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable -q jaque
sudo systemctl restart jaque

say "HTTPS con Caddy"
if [ -z "$DOMAIN" ]; then
  if [ -f /etc/caddy/Caddyfile ] && grep -q '^# jaque' /etc/caddy/Caddyfile; then
    DOMAIN=$(awk '/^# jaque/ {print $3}' /etc/caddy/Caddyfile)
  else
    IP=$(curl -fsS https://api.ipify.org)
    DOMAIN="${IP//./-}.sslip.io"
  fi
fi
AUTH=""
if [ -n "${JAQUE_PASSWORD:-}" ]; then
  HASH=$(caddy hash-password --plaintext "$JAQUE_PASSWORD")
  AUTH=$'\n\tbasic_auth {\n\t\tjaque '"$HASH"$'\n\t}'
elif [ -f /etc/caddy/Caddyfile ]; then
  # Al actualizar se mantiene la contraseña que hubiera.
  OLD=$(awk '/^\t\tjaque / {print $2}' /etc/caddy/Caddyfile)
  [ -n "$OLD" ] && AUTH=$'\n\tbasic_auth {\n\t\tjaque '"$OLD"$'\n\t}'
fi
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
# jaque $DOMAIN
$DOMAIN {
	encode zstd gzip$AUTH
	reverse_proxy 127.0.0.1:8080
}
EOF
sudo systemctl reload caddy || sudo systemctl restart caddy

say "Cortafuegos (puertos 80 y 443)"
# Las imágenes de Ubuntu de Oracle traen iptables cerrando todo salvo SSH.
for PORT in 80 443; do
  sudo iptables -C INPUT -p tcp --dport $PORT -m conntrack --ctstate NEW -j ACCEPT 2>/dev/null ||
    sudo iptables -I INPUT 1 -p tcp --dport $PORT -m conntrack --ctstate NEW -j ACCEPT
done
sudo netfilter-persistent save >/dev/null

sleep 2
if curl -fsS http://127.0.0.1:8080/api/estado >/dev/null; then
  say "Listo: https://$DOMAIN"
  echo "Si no carga, abre los puertos 80 y 443 en Oracle: Red virtual (VCN) > Lista de seguridad > Reglas de entrada."
  echo "Para actualizar más adelante, vuelve a ejecutar este mismo comando."
else
  echo "El servicio no responde. Mira el registro con: sudo journalctl -u jaque -n 50" >&2
  exit 1
fi
