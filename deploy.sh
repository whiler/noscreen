#!/bin/bash

webdomain=
webcert=
webkey=

signaldomain=
signalcert=
signalkey=

turndomain=
turnuser=

# {{{ 解析命令行参数
for arg in "${@}"; do
	case "${arg}" in
	-wd=*)
		webdomain="${arg#*=}"
		shift
		;;
	-wc=*)
		webcert="${arg#*=}"
		shift
		;;

	-wk=*)
		webkey="${arg#*=}"
		shift
		;;

	-sd=*)
		signaldomain="${arg#*=}"
		shift
		;;
	-sc=*)
		signalcert="${arg#*=}"
		shift
		;;
	-sk=*)
		signalkey="${arg#*=}"
		shift
		;;

	-td=*)
		turndomain="${arg#*=}"
		shift
		;;
	-tu=*)
		turnuser="${arg#*=}"
		shift
		;;

	*)
		shift
		;;
	esac
done
if [[ -z ${turnuser} ]]; then
	turnuser=noscreen
fi
# }}}

os="$(grep -oP "^ID=\K\w+" /etc/os-release)"
if [[ "${os}" != "debian" && "${os}" != "ubuntu" ]]; then
	echo "${0} does not support current OS release"
	exit 0
elif [[ 0 -ne ${UID} ]]; then
	echo "root privilege required"
	exit 0
fi

# {{{ 读取标准输入
if [[ -z ${webdomain} ]]; then
	read -r -p "输入 WEB 服务的域名：" webdomain
	if [[ -z ${webdomain} ]]; then
		exit 0
	fi
fi
if [[ -z ${webcert} ]]; then
	read -r -p "输入 WEB 服务 HTTPS 证书的公钥路径：" webcert
	if [[ -z ${webcert} ]]; then
		exit 0
	fi
fi
if [[ -z ${webkey} ]]; then
	read -r -p "输入 WEB 服务 HTTPS 证书的私钥路径：" webkey
	if [[ -z ${webkey} ]]; then
		exit 0
	fi
fi

if [[ -z ${signaldomain} ]]; then
	read -r -p "输入信令服务的域名(${webdomain})：" signaldomain
	if [[ -z ${signaldomain} ]]; then
		signaldomain="${webdomain}"
	fi
fi
if [[ -z ${signalcert} ]]; then
	read -r -p "输入信令服务 HTTPS 证书的公钥路径(${webcert})：" signalcert
	if [[ -z ${signalcert} ]]; then
		signalcert="${webcert}"
	fi
fi
if [[ -z ${signalkey} ]]; then
	read -r -p "输入信令服务 HTTPS 证书的私钥路径(${webkey})：" signalkey
	if [[ -z ${signalkey} ]]; then
		signalkey="${webkey}"
	fi
fi

if [[ -z ${turndomain} ]]; then
	read -r -p "输入中继服务的域名(${webdomain})：" turndomain
	if [[ -z ${turndomain} ]]; then
		turndomain="${webdomain}"
	fi
fi
# }}}

[ -z "$(find -H /var/lib/apt/lists -maxdepth 0 -mtime -7)" ] && apt-get update -qq -y
apt install -qq -y wget

# {{{ 部署 WEB 服务
test -e /etc/nginx/nginx.conf || apt install -qq -y nginx
test -e /var/www/noscreen-master && rm -fr /var/www/noscreen-master
pushd /var/www || exit 0
wget -q -O - https://github.com/whiler/noscreen/archive/refs/heads/master.tar.gz | tar -xz
popd || exit 0
cat <<EOF >/etc/nginx/sites-available/noscreen
server {
	listen 443 ssl;
	listen [::]:443 ssl;
	ssl_certificate ${webcert};
	ssl_certificate_key ${webkey};

	server_name ${webdomain};
	root /var/www/noscreen-master;

	location / {
		try_files \$uri \$uri/ =404;
	}
}
EOF
ln -sf /etc/nginx/sites-available/noscreen /etc/nginx/sites-enabled/noscreen
systemctl enable nginx
systemctl reload nginx
# }}}
# {{{ 部署信令服务
wget -q -O /usr/local/bin/wspipe "$(wget -q -O - https://api.github.com/repos/whiler/wspipe/releases/latest | grep browser_download_url | sed -E 's/.*"([^"]+)".*/\1/')"
chmod a+x /usr/local/bin/wspipe
cat <<EOF >/etc/default/wspipe
TOKEN=$(tr --delete --complement 'A-Za-z0-9' </dev/urandom | head --bytes=16)
EOF
cat <<EOF >/lib/systemd/system/wspipe.service
[Unit]
Description=WebSocket pipe service
After=network.target

[Service]
EnvironmentFile=-/etc/default/wspipe
ExecStart=/usr/local/bin/wspipe -token \${TOKEN} -cert "${signalcert}" -key "${signalkey}"

[Install]
WantedBy=multi-user.target
EOF
systemctl enable wspipe.service
systemctl restart wspipe.service
# }}}
# {{{ 部署中继服务
test -e /etc/turnserver.conf || apt install -qq -y coturn
cat <<EOF >/etc/turnserver.conf
lt-cred-mech
user=${turnuser}:$(tr --delete --complement 'A-Za-z0-9' </dev/urandom | head --bytes=16)

syslog
fingerprint
no-tls
no-dtls
no-cli
no-rfc5780
no-stun-backward-compatibility
response-origin-only-with-rfc5780
EOF
systemctl enable coturn.service
systemctl restart coturn.service
# }}}
# {{{ 打包遥控服务
apt install -qq -y zip unzip
tmpd=$(mktemp -d)
pushd "${tmpd}" || exit 0
wget -q -O localhost.direct.zip https://aka.re/localhost
unzip -P localhost localhost.direct.zip
mv localhost.direct.crt cert.pem
mv localhost.direct.key key.pem
cp cert.pem key.pem /var/www/noscreen-master
echo "https://${webdomain}" >repo.txt
for u in $(wget -q -O - https://api.github.com/repos/whiler/kmactor/releases/latest | grep browser_download_url | sed -E 's/.*"([^"]+)".*/\1/'); do
	name="$(basename "${u}")"
	pkg="${name}.zip"
	app=kmactor
	if [[ "${name}" == *.exe ]]; then
		pkg="${name%.exe}.zip"
		app=kmactor.exe
	fi
	rm -f "${name}" "${pkg}" "${app}"
	wget -q "${u}"
	mv "${name}" "${app}"
	chmod a+x "${app}"
	zip "${pkg}" "${app}" cert.pem key.pem repo.txt
	mv "${pkg}.zip" /var/www/noscreen-master
done
popd || exit 0
rm -fr "${tmpd}"
# }}}
# {{{ 更新 config.json
cat <<EOF >/var/www/noscreen-master/config.json
{
    "advanced": {
       "actor": {
          "addr": "wss://actor.localhost.direct:9242",
          "token": null
       },
       "signal": {
          "addr": "wss://${signaldomain}:10057/ws/pipe",
          "token": "$(grep -oP "^TOKEN=\K\w+" /etc/default/wspipe)"
       },
       "turn": {
          "addr": "turn:${turndomain}:3478",
          "username": "${turnuser}",
          "credential": "$(grep -oP ":\K\w+" /etc/turnserver.conf)"
       }
    },
    "main": {
       "local": {
          "id": null
       },
       "remote": {
          "id": null
       }
    }
}
EOF
# }}}

echo "部署完成"
