## 部署 ##

NoScreen 基于 WebRTC ，至少需要部署两个服务：一个 WEB 服务提供静态文件，一个信令服务帮助建立端到端连接；中继服务是可选的。

[一键部署脚本](deploy.sh)

### HTTPS 证书 ###

如果有有效的 HTTPS 证书，可以直接使用现有证书；如果没有，可以通过 [acme.sh](https://github.com/acmesh-official/acme.sh) 申请免费证书或者通过其他方式购买证书。

### WEB 服务 ###

下载 NoScreen 文件并解压到 noscreen-master `wget -O - https://github.com/whiler/noscreen/archive/refs/heads/master.tar.gz | tar -xz` 。
NoScreen 仅需要 WEB 服务托管几个静态文件，能胜任这个工作的 WEB 服务有很多。

#### NGINX ####

```
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    ssl_certificate /path/to/noscreen.example.com.cert.pem;
    ssl_certificate_key /path/to/noscreen.example.com.key.pem;

    server_name noscreen.example.com;
    root /path/to/noscreen-master;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

### 信令服务 ###

使用 [wspipe](https://github.com/whiler/wspipe) 提供信令服务，它绑定两个 WebSocket 连接建立双向通信。

1. 下载 wspipe `wget -O wspipe "$(wget -q -O - https://api.github.com/repos/whiler/wspipe/releases/latest | grep browser_download_url | sed -E 's/.*"([^"]+)".*/\1/')"`
2. chmod `chmod a+x wspipe`
3. 生成密令 `export TOKEN=$(tr --delete --complement 'A-Za-z0-9' </dev/urandom | head --bytes=16)`
4. 运行 wspipe `./wspipe -token ${TOKEN} -cert /path/to/signal.example.com.cert.pem -key /path/to/signal.example.com.key.pem`
5. 更新 noscreen-master/config.json 中信令服务的地址和密令

### 中继服务 ###

使用符合 RFC 5766 的 [coturn](https://github.com/coturn/coturn) 提供中继服务。

1. 生成密码 `export TURNPASS=$(tr --delete --complement 'A-Za-z0-9' </dev/urandom | head --bytes=16)`
2. turnserver.conf

    ```
    lt-cred-mech
    user=noscreen:${TURNPASS}
    
    syslog
    fingerprint
    no-tls
    no-dtls
    no-cli
    no-rfc5780
    no-stun-backward-compatibility
    response-origin-only-with-rfc5780
    ```

5. 更新 noscreen-master/config.json 中中继服务的地址、用户名和密码

### 遥控服务 ###

使用 [kmactor](https://github.com/whiler/kmactor) 提供遥控服务，它接收遥控指令，操作本地电脑。

1. 从 https://github.com/whiler/kmactor/releases 下载各个操作系统最新的 kmactor
2. 为指向本地的域名申请证书，将证书公钥导出为 cert.pem ，将证书私钥导出为 key.pem
3. 将各个操作系统的 kmactor 和证书文件一起分别压缩打包到 noscreen-master
4. 更新 noscreen-master/config.json 中遥控服务的地址和密令
