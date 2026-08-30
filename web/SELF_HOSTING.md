# 自有服务器部署说明

这个网页包含浏览器界面和服务器端查询接口，必须作为完整的 Node.js 应用运行，不能只把静态文件复制到 Nginx 目录。

推荐使用 Docker Compose。下面以 Ubuntu 22.04/24.04、域名 `badminton.example.com`、项目目录 `/opt/badminton/web` 为例。

## 一、服务器准备

服务器需要安装：

- Docker Engine
- Docker Compose 插件
- Nginx
- 有域名时安装 Certbot

确认 Docker 可用：

```bash
docker --version
docker compose version
```

## 二、上传项目

把整个项目上传到服务器的 `/opt/badminton`。需要保留隐藏目录
`web/.openai` 及其中的 `hosting.json`，Docker 构建会读取该配置。不需要上传
`node_modules`、`web/dist` 或任何 HAR 抓包文件。

在本机项目根目录可以使用：

```bash
rsync -av \
  --exclude node_modules \
  --exclude dist \
  --exclude '*.har' \
  ./ root@你的服务器IP:/opt/badminton/
```

## 三、启动网页

登录服务器后执行：

```bash
cd /opt/badminton/web
docker compose up -d --build
docker compose ps
```

如果正在替换早期版本的容器，请重建镜像并强制重建容器：

```bash
cd /opt/badminton/web
docker compose down
docker compose build
docker compose up -d --force-recreate
```

验证容器和网页：

```bash
curl http://127.0.0.1:3000/api/health
curl 'http://127.0.0.1:3000/api/availability?date=2026-08-29'
```

第一条应返回 `status: ok`。第二条应返回青羽、梅子、十环三个场馆的查询结果；某一个场馆的上游接口临时异常时，其状态会单独显示为失败，不影响另外两个场馆。

当前修复版的健康检查还会返回：

```json
{"status":"ok","service":"badminton-availability","build":"v1.1.4"}
```

如果没有看到这个 `build` 值，说明服务器仍在运行旧镜像或使用了错误的项目目录。

## 四、配置域名和 Nginx

先把域名的 A 记录解析到服务器公网 IP。然后复制示例配置：

```bash
sudo cp /opt/badminton/web/deploy/nginx.conf.example /etc/nginx/sites-available/badminton
sudo sed -i 's/badminton\.example\.com/你的真实域名/g' /etc/nginx/sites-available/badminton
sudo ln -s /etc/nginx/sites-available/badminton /etc/nginx/sites-enabled/badminton
sudo nginx -t
sudo systemctl reload nginx
```

如果 `/etc/nginx/sites-enabled/badminton` 已经存在，不要重复创建软链接。

浏览器访问 `http://你的真实域名` 验证成功后，再启用 HTTPS：

```bash
sudo certbot --nginx -d 你的真实域名
```

## 五、更新版本

以后在本机修改完成后，重新上传代码，再在服务器执行：

```bash
cd /opt/badminton/web
docker compose up -d --build
docker image prune -f
```

Dockerfile 会复用 npm 下载缓存，日常更新不要使用 `--no-cache`或频繁清理
BuildKit 缓存；只有怀疑缓存损坏时才需要完全重建。

更新期间可以查看日志：

```bash
docker compose logs --tail=200 -f
```

## 六、三个 Python 脚本

网页已经内置了三个场馆的 TypeScript 查询逻辑，网页运行不依赖 Python。

如果还要在服务器命令行单独使用 Python 脚本，它们只需要 Python 3 标准库：

```bash
cd /opt/badminton
python3 qingyu_availability.py 2026-08-29
python3 meizi_availability.py 2026-08-29
python3 shihuan_availability.py 2026-08-29
```

## 七、常见问题

### 页面能打开，但某个场馆查询失败

先查看应用日志：

```bash
cd /opt/badminton/web
docker compose logs --tail=200
```

服务器必须能够访问三个场馆的公网接口，其中梅子接口使用 HTTPS 8008 端口。请确认云服务器安全策略和运营商没有拦截出站连接。

### 不使用域名，只通过 IP 访问

把 `compose.yaml` 中的端口从 `127.0.0.1:3000:3000` 改为 `3000:3000`，然后在云服务器防火墙中只向可信 IP 开放 TCP 3000。长期公开使用仍建议配置域名、Nginx 和 HTTPS。

### HAR 文件是否需要上传

不需要。实时查询使用匿名请求，HAR 只用于本地离线回放，而且可能包含敏感信息。
