#!/bin/sh
# 年轮 Nianlun 容器入口
# 作用：确保数据目录可写，然后降权到 PUID:PGID 运行。
# 这样即使宿主机数据目录是被 Docker 以 root 创建的，也能自动修正，不需要手动 chown。
set -e

DATA_DIR="${DATA_DIR:-/data}"
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

# 非 root 运行（用户显式指定了 user: 或 --user）时，无法改属主，直接按原样执行
if [ "$(id -u)" != "0" ]; then
  exec "$@"
fi

# 先用目标用户的身份试一次建目录：成功说明权限已经正确，跳过 chown
# （避免每次启动都对上传目录做全量递归 chown，图片多时会拖慢启动）
if ! su-exec "$PUID:$PGID" sh -c "mkdir -p '$DATA_DIR/uploads'" 2>/dev/null; then
  echo "[年轮] 数据目录 $DATA_DIR 当前属主不是 $PUID:$PGID，正在修正…"
  mkdir -p "$DATA_DIR/uploads" 2>/dev/null || true
  if ! chown -R "$PUID:$PGID" "$DATA_DIR" 2>/dev/null; then
    echo "[年轮] ✗ 无法修正 $DATA_DIR 的属主，容器即将退出。"
    echo "       可能原因与处理办法："
    echo "       1. 挂载卷是只读的 —— 检查 docker-compose.yml 的 volumes 是否加了 :ro";
    echo "       2. 宿主机目录属主既不是 root 也不是可写的 —— 手动执行："
    echo "          chown -R $PUID:$PGID <宿主机数据目录>"
    echo "       3. 把 PUID / PGID 设成宿主机目录实际属主的 uid/gid 后重启容器。"
    exit 1
  fi
  echo "[年轮] 已将 $DATA_DIR 属主修正为 $PUID:$PGID"
fi

exec su-exec "$PUID:$PGID" "$@"
