#!/usr/bin/env bash
# Add IP-address HTTPS to the existing PlantLight Nginx reverse proxy.
set -Eeuo pipefail

public_ip=''
print_phase=''
nginx_config=/etc/nginx/conf.d/plantlight-https.conf
webroot=/var/lib/plantlight-acme
certbot_env=/opt/plantlight-certbot
cert_name=plantlight-ip
cert_dir=/etc/letsencrypt/live/plantlight-ip
managed_marker='# Managed by PlantLight setup_https.sh.'

usage() {
    cat <<'EOF'
Usage: sudo bash scripts/setup_https.sh [--ip PUBLIC_IPV4]
       bash scripts/setup_https.sh --ip PUBLIC_IPV4 --print-nginx-config http|https

On a Google Cloud VM, the current external IPv4 is read from instance metadata.
Requires the existing Nginx -> 127.0.0.1:8000 setup and public TCP ports 80/443.
Certbot prompts for its account details/terms when first run. No domain is needed.
The print command only renders configuration; it does not change the machine.
EOF
}

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

while (($#)); do
    case "$1" in
        --ip)
            (($# >= 2)) || die '--ip needs a public IPv4 address'
            public_ip=$2; shift 2 ;;
        --print-nginx-config)
            (($# >= 2)) || die '--print-nginx-config needs http or https'
            [[ $2 == http || $2 == https ]] || die 'Print phase must be http or https'
            print_phase=$2; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) die "Unknown argument: $1" ;;
    esac
done

validate_ip() {
    python3 - "$public_ip" <<'PY'
import ipaddress
import sys
try:
    address = ipaddress.ip_address(sys.argv[1])
    if address.version != 4 or not address.is_global:
        raise ValueError('a public IPv4 address is required')
except ValueError as error:
    sys.exit(f'Invalid --ip: {error}')
PY
}

render_proxy() {
    cat <<'EOF'
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 900s;
    }
EOF
}

render_nginx() {
    local phase=$1
    cat <<EOF
$managed_marker
server {
    listen 80;
    server_name $public_ip;
    client_max_body_size 100m;

    location ^~ /.well-known/acme-challenge/ {
        root $webroot;
        default_type text/plain;
        try_files \$uri =404;
    }
EOF
    if [[ $phase == https ]]; then
        # A fixed destination avoids redirecting to an untrusted Host header.
        printf "    location / { return 308 https://%s\$request_uri; }\n" "$public_ip"
    else
        render_proxy
    fi
    printf '}\n'
    if [[ $phase == https ]]; then
        cat <<EOF

server {
    listen 443 ssl;
    server_name $public_ip;
    ssl_certificate $cert_dir/fullchain.pem;
    ssl_certificate_key $cert_dir/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 100m;
EOF
        render_proxy
        printf '}\n'
    fi
}

if [[ -n $print_phase ]]; then
    [[ $print_phase == http || $print_phase == https ]] || die 'Print phase must be http or https'
    [[ -n $public_ip ]] || die 'Rendering requires --ip; metadata is not read in print mode'
    validate_ip
    render_nginx "$print_phase"
    exit 0
fi

[[ $EUID == 0 ]] || die 'Run this script with sudo on the Google Cloud VM'
for tool in curl python3 nginx systemctl openssl flock; do
    command -v "$tool" >/dev/null || die "Required command is missing: $tool"
done
nginx_bin=$(command -v nginx)
systemctl_bin=$(command -v systemctl)
exec 9>/run/lock/plantlight-https.lock
flock -n 9 || die 'Another PlantLight HTTPS setup is already running'

if [[ -z $public_ip ]]; then
    public_ip=$(curl --fail --silent --show-error --noproxy '*' \
        --connect-timeout 3 --max-time 5 -H 'Metadata-Flavor: Google' \
        http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip) \
        || die 'Cannot read the VM external IP; use --ip with the current external IPv4'
fi
validate_ip
"$nginx_bin" -t
"$systemctl_bin" is-active --quiet nginx || die 'Start the existing nginx service first'
curl --fail --silent --show-error --noproxy '*' --max-time 10 \
    http://127.0.0.1:8000/health >/dev/null || die 'The existing backend on port 8000 is not responding'
[[ -d /etc/nginx/conf.d ]] || die 'Expected /etc/nginx/conf.d (Debian/Ubuntu Nginx)'

assert_managed_or_absent() {
    local file=$1 first_line=''
    [[ ! -L $file ]] || die "Refusing to replace a symlink: $file"
    if [[ -e $file ]]; then
        IFS= read -r first_line < "$file" || true
        [[ $first_line == "$managed_marker" ]] || die "Unrelated file already exists: $file"
    fi
}
assert_managed_or_absent "$nginx_config"
assert_managed_or_absent /etc/systemd/system/plantlight-certbot-renew.service
assert_managed_or_absent /etc/systemd/system/plantlight-certbot-renew.timer

# Keep Certbot separate from the application's virtual environment.
if ! "$certbot_env/bin/python" -c \
    'from importlib.metadata import version; assert tuple(map(int, version("certbot").split(".")[:2])) >= (5, 4)' \
    >/dev/null 2>&1; then
    if ! python3 -m venv "$certbot_env"; then
        command -v apt-get >/dev/null || die 'Install python3-venv, then rerun'
        apt-get update
        apt-get install --yes python3-venv
        python3 -m venv "$certbot_env"
    fi
    "$certbot_env/bin/python" -m pip install --upgrade pip 'certbot>=5.4.0'
fi
certbot_bin=$certbot_env/bin/certbot

install -d -m 0755 "$webroot/.well-known/acme-challenge" /var/backups
backup_dir=$(mktemp -d /var/backups/plantlight-https.XXXXXXXX)
original_exists=false
if [[ -f $nginx_config ]]; then
    cp -p -- "$nginx_config" "$backup_dir/plantlight-https.conf"
    original_exists=true
fi
modified=false
committed=false
challenge_file=''

cleanup() {
    local status=$?
    trap - EXIT
    [[ -z $challenge_file ]] || rm -f -- "$challenge_file"
    if [[ $modified == true && $committed == false ]]; then
        printf '\nHTTPS setup did not finish. Restoring the previous Nginx configuration.\n' >&2
        if [[ $original_exists == true ]]; then
            cp -p -- "$backup_dir/plantlight-https.conf" "$nginx_config"
        else
            rm -f -- "$nginx_config"
        fi
        if "$nginx_bin" -t; then
            "$systemctl_bin" reload nginx || true
        fi
        printf 'Backup directory: %s\n' "$backup_dir" >&2
    fi
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

check_nginx() {
    local result
    if ! result=$("$nginx_bin" -t 2>&1); then
        printf '%s\n' "$result" >&2
        return 1
    fi
    printf '%s\n' "$result"
    if [[ $result == *'conflicting server name'* ]]; then
        die 'An existing Nginx virtual host conflicts with this IP. Inspect sudo nginx -T before retrying.'
    fi
}

# During issuance, normal HTTP still proxies to the existing backend.
# If already configured for this IP, keep HTTPS available on repeat runs.
modified=true
if [[ -f $cert_dir/fullchain.pem && -f $cert_dir/privkey.pem ]] && \
    openssl x509 -in "$cert_dir/fullchain.pem" -noout -checkip "$public_ip" >/dev/null 2>&1; then
    render_nginx https > "$nginx_config"
else
    render_nginx http > "$nginx_config"
fi
check_nginx
"$systemctl_bin" reload nginx

# Catch a wrong include/server_name before asking the CA to validate port 80.
challenge_file=$(mktemp "$webroot/.well-known/acme-challenge/plantlight-check.XXXXXXXX")
challenge_name=${challenge_file##*/}
printf '%s' "$challenge_name" > "$challenge_file"
chmod 0644 "$challenge_file"
challenge_response=$(curl --fail --silent --show-error --noproxy '*' --max-time 10 \
    --retry 5 --retry-delay 1 --retry-max-time 20 --retry-all-errors \
    -H "Host: $public_ip" "http://127.0.0.1/.well-known/acme-challenge/$challenge_name")
[[ $challenge_response == "$challenge_name" ]] || die 'Nginx is not serving the ACME challenge directory'
rm -f -- "$challenge_file"
challenge_file=''

# Do not use --nginx for IP certificates: use the supported webroot authenticator.
# Certbot asks the operator to accept its terms instead of silently accepting them.
reload_hook="$nginx_bin -t && $systemctl_bin reload nginx"
"$certbot_bin" certonly --webroot --webroot-path "$webroot" \
    --preferred-profile shortlived --ip-address "$public_ip" \
    --cert-name "$cert_name" --keep-until-expiring --deploy-hook "$reload_hook"
openssl x509 -in "$cert_dir/fullchain.pem" -noout -checkip "$public_ip"
openssl x509 -in "$cert_dir/fullchain.pem" -noout -checkend 3600
render_nginx https > "$nginx_config"
check_nginx
"$systemctl_bin" reload nginx

# Verify the real certificate chain and IP SAN, without -k / insecure TLS.
curl --fail --silent --show-error --noproxy '*' --max-time 15 \
    --retry 5 --retry-delay 1 --retry-max-time 20 --retry-all-errors \
    --resolve "$public_ip:443:127.0.0.1" "https://$public_ip/health" >/dev/null
"$certbot_bin" renew --cert-name "$cert_name" --dry-run \
    --run-deploy-hooks --deploy-hook "$reload_hook"

cat > /etc/systemd/system/plantlight-certbot-renew.service <<EOF
$managed_marker
[Unit]
Description=Renew the PlantLight IP TLS certificate and reload Nginx
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=$certbot_bin renew --cert-name $cert_name --quiet --deploy-hook "$reload_hook"
TimeoutStartSec=10min
EOF
cat > /etc/systemd/system/plantlight-certbot-renew.timer <<EOF
$managed_marker
[Unit]
Description=Check PlantLight TLS renewal twice daily

[Timer]
OnCalendar=*-*-* 00:00:00
OnCalendar=*-*-* 12:00:00
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
EOF
"$systemctl_bin" daemon-reload
"$systemctl_bin" enable --now plantlight-certbot-renew.timer
"$systemctl_bin" is-active --quiet plantlight-certbot-renew.timer
committed=true

printf '\nHTTPS configured and verified locally: https://%s/health\n' "$public_ip"
printf 'Readiness: https://%s/ready\n' "$public_ip"
printf 'API docs: https://%s/docs\n' "$public_ip"
printf 'Renewal: systemctl list-timers plantlight-certbot-renew.timer\n'
printf 'Check the same HTTPS URL from a teammate device to verify the Google Cloud 443 firewall.\n'
printf 'If the external IP changes, rerun this script for the new IP.\n'
printf 'Previous Nginx configuration backup: %s\n' "$backup_dir"
