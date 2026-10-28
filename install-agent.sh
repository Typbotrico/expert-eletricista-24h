#!/usr/bin/env bash
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo 'Execute com sudo.'; exit 1; fi
if ! command -v python3 >/dev/null || ! command -v curl >/dev/null; then echo 'Instale python3 e curl no Ubuntu antes de continuar.'; exit 1; fi
if [ "$(ps -p 1 -o comm= | tr -d ' ')" != systemd ]; then echo 'O WSL precisa estar com systemd ativo. Nenhuma configuração foi alterada.'; exit 1; fi
if ! command -v asterisk >/dev/null; then echo 'Execute no mesmo Ubuntu/WSL onde está o Asterisk.'; exit 1; fi
ami_source=''
for candidate in /etc/asterisk/central_piloto_ami.secret /etc/central-ami-bridge/ami.secret; do
 if [ -s "$candidate" ]; then ami_source="$candidate"; break; fi
done
if [ -z "$ami_source" ]; then echo 'Não encontrei o arquivo da senha AMI existente. Nenhuma alteração no Asterisk foi feita.'; exit 1; fi
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT
curl --fail --silent --show-error --proto '=https' --tlsv1.2 'https://raw.githubusercontent.com/Typbotrico/expert-eletricista-24h/central-ligacoes-motor-piloto/agent.py' -o "$work_dir/agent.py"
printf '%s  %s\n' 'a6d549279b03c6ef6b1903954de67449f2bf80266d5c62c0bd9e97b684b49d6c' "$work_dir/agent.py" | sha256sum --check --status
id central-motor >/dev/null 2>&1 || useradd --system --home-dir /var/lib/central-motor-agent --shell /usr/sbin/nologin central-motor
install -d -m 700 -o central-motor -g central-motor /etc/central-motor-agent /var/lib/central-motor-agent
install -d -m 755 /opt/central-motor-agent
install -m 600 -o central-motor -g central-motor "$ami_source" /etc/central-motor-agent/ami.secret
# Preserve the running agent until enrollment of this replacement succeeds.
if ! python3 -c 'import json,re; assert re.fullmatch("[a-f0-9]{64}",json.load(open("/etc/central-motor-agent/token.json"))["token"])' 2>/dev/null; then
 python3 "$work_dir/agent.py" --enroll
else
 echo 'Pareamento existente preservado; não é necessário outro código.'
fi
python3 "$work_dir/agent.py" --configure-route
if [ -f /etc/central-motor-agent/route.json ]; then chown central-motor:central-motor /etc/central-motor-agent/route.json; fi
chown central-motor:central-motor /etc/central-motor-agent/token.json
systemctl stop central-motor-agent.service 2>/dev/null || true
install -m 755 "$work_dir/agent.py" /opt/central-motor-agent/agent.py
cat > /etc/systemd/system/central-motor-agent.service <<'UNIT'
[Unit]
Description=Central de Ligacoes - agente piloto 1001 e rota fixa 700
After=network-online.target asterisk.service
Wants=network-online.target
[Service]
Type=simple
User=central-motor
Group=central-motor
ExecStart=/usr/bin/python3 -u /opt/central-motor-agent/agent.py
Restart=on-failure
RestartSec=10
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/central-motor-agent
ReadOnlyPaths=/etc/central-motor-agent
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
UMask=0077
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now central-motor-agent.service
systemctl is-active --quiet central-motor-agent.service
echo 'Agente iniciado. Abra Telefonia real no painel e clique em Atualizar conexão.'
echo 'Nenhuma configuração Asterisk ou regra de rede foi alterada. Piloto externo depende da validação da rota 700 pelo servidor.'
