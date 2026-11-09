#!/usr/bin/env bash
# 一键部署：渲染配置 → 重建镜像 → 重启容器 → 健康检查。
#
# 前置：仓库根有 .env（含 R2_* / EMBED_* / SET_*，权限 600，已在 .gitignore 里）。
# 用法：./deploy/deploy.sh [--no-build] [--check-only]
#   --no-build    只重启容器（改了 sets.json / .env 时够用；注意 env_file 变更必须重建容器，restart 不重读）
#   --check-only  只渲染 + 校验，不碰容器
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
COMPOSE_SERVICE=${COMPOSE_SERVICE:-md-server}
NO_BUILD=0
CHECK_ONLY=0
for a in "$@"; do
  case "$a" in
    --no-build) NO_BUILD=1 ;;
    --check-only) CHECK_ONLY=1 ;;
    *) echo "未知参数：$a" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "1/4 渲染空间 set 配置"
node deploy/render-config.mjs --env .env --out sets.json

if [ "$CHECK_ONLY" = "1" ]; then
  echo "→ --check-only：到此为止"
  exit 0
fi

if [ "$NO_BUILD" = "1" ]; then
  say "2/4 重建容器（不重建镜像）"
  docker compose up -d --force-recreate "$COMPOSE_SERVICE"
else
  say "2/4 重建镜像 + 容器"
  docker compose up -d --build "$COMPOSE_SERVICE"
fi

say "3/4 等健康检查（最多 90s）"
ok=0
for _ in $(seq 1 45); do
  if docker exec "$COMPOSE_SERVICE" node -e \
      "fetch('http://127.0.0.1:3001/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      >/dev/null 2>&1; then
    ok=1; break
  fi
  sleep 2
done
if [ "$ok" != "1" ]; then
  echo "✖ 健康检查超时，最近日志：" >&2
  docker logs --tail 40 "$COMPOSE_SERVICE" >&2 || true
  exit 1
fi

say "4/4 运行态自检"
docker exec "$COMPOSE_SERVICE" node -e "
(async () => {
  const get = async (p) => (await fetch('http://127.0.0.1:3001' + p)).json();
  const st = await get('/api/status');
  const emb = await get('/api/embeddings/status');
  console.log('  index dataVersion :', st.dataVersion);
  console.log('  embeddings        :', emb.built + '/' + emb.total, emb.model, emb.stale ? '(stale!)' : '');
  if (emb.stale) { console.error('  ✖ 向量指纹与索引库不一致，需要重建：POST /api/reindex-embeddings'); process.exit(1); }
  if (emb.total > 0 && emb.built < emb.total) console.warn('  ! 语义索引未跑满，可 POST /api/reindex-embeddings');
})().catch((e) => { console.error('自检失败', e.message); process.exit(1); });
"

echo
echo "✔ 部署完成：容器 $COMPOSE_SERVICE 已就绪（对外经 nginx-proxy 暴露）"
