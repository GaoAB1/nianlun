# 年轮 Nianlun —— 零依赖 Node + SQLite，镜像里没有任何 npm 包
FROM node:24-alpine

# tzdata：让容器内日志与日期符合本地习惯
# su-exec：以 root 修正数据目录属主后降权运行
RUN apk add --no-cache tzdata su-exec

ARG VERSION=1.0.1
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    APP_VERSION=${VERSION} \
    PUID=1000 \
    PGID=1000 \
    TZ=Asia/Shanghai

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY bin ./bin
COPY src ./src
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data/uploads

EXPOSE 8080

# 健康检查直接用 Node 内置 fetch，避免额外装 curl
HEALTHCHECK --interval=30s --timeout=5s --start-period=8s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 入口脚本负责数据目录权限，然后降权 exec 出真正进程（PID 1 仍是 node，信号可正常传递）
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
# 用启动器：Node 22/24 的 node:sqlite 参数差异由它自动处理
CMD ["node", "bin/nianlun.mjs"]
