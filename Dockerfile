# 年轮 Nianlun —— 零依赖 Node + SQLite，镜像里没有任何 npm 包
FROM node:24-alpine

# 时区数据：让容器内日志与日期符合本地习惯
RUN apk add --no-cache tzdata

ARG VERSION=1.0.0
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    APP_VERSION=${VERSION} \
    TZ=Asia/Shanghai

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY bin ./bin
COPY src ./src
COPY public ./public

# 数据目录必须可写（SQLite 库 + 上传的图片都放这里）
RUN mkdir -p /data/uploads && chown -R node:node /app /data

USER node

EXPOSE 8080

# 健康检查直接用 Node 内置 fetch，避免额外装 curl
HEALTHCHECK --interval=30s --timeout=5s --start-period=8s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 用启动器：Node 22/24 的 node:sqlite 参数差异由它自动处理
CMD ["node", "bin/nianlun.mjs"]
