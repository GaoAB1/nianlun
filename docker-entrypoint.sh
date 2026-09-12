#!/bin/sh
# 年轮 Nianlun 容器入口
# 作用：确保数据目录对 PUID:PGID 可写，然后降权运行。
# 这样即使宿主机数据目录是被 Docker 以 root 创建的，也能自动修正，不需要手动 chown。
set -e

DATA_DIR="${DATA_DIR:-/data}"
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

# 非 root 运行（用户显式指定了 user: 或 --user）时无法改属主，直接按原样执行
if [ "$(id -u)" != "0" ]; then
  exec "$@"
fi

# 关键：必须用「写权限」判断，不能用 mkdir -p 探测 ——
# 目录已存在时 mkdir -p 永远返回 0，会误判成可写而跳过 chown
if ! su-exec "$PUID:$PGID" test -w "$DATA_DIR"; then
  echo "[年轮] 数据目录 $DATA_DIR 对 $PUID:$PGID 不可写，正在修正属主…"
  mkdir -p "$DATA_DIR" 2>/dev/null || true
  if ! chown -R "$PUID:$PGID" "$DATA_DIR" 2>/dev/null; then
    echo "[年轮] ✗ 无法修正 $DATA_DIR 的属主，容器即将退出。"
    echo "       可能原因与处理办法："
    echo "       1. 挂载卷是只读的 —— 检查 docker-compose.yml 的 volumes 是否带了 :ro"
    echo "       2. 宿主机目录属主无法被容器内 root 修改（例如挂载在特殊文件系统上）——"
    echo "          在宿主机手动执行：chown -R $PUID:$PGID <宿主机数据目录>"
    echo "       3. 把 PUID / PGID 设成宿主机目录实际属主的 uid/gid 后重启容器。"
    exit 1
  fi
  echo "[年轮] 已将 $DATA_DIR 属主修正为 $PUID:$PGID"
fi

# 数据子目录（uploads 放上传的图片），以运行身份创建
su-exec "$PUID:$PGID" sh -c "mkdir -p '$DATA_DIR/uploads'" || {
  echo "[年轮] ✗ 无法创建 $DATA_DIR/uploads"
  exit 1
}

exec su-exec "$PUID:$PGID" "$@"
