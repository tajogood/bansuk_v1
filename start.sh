#!/usr/bin/env bash
# 반석 시스템 실행 스크립트
#
#   ./start.sh           최신 코드 받기 → 설치 → 화면 빌드 → 서버 (재)시작
#   ./start.sh stop      서버 멈춤
#   ./start.sh status    돌고 있는지 확인
#   ./start.sh logs      서버 기록 보기 (Ctrl+C로 나옴)
#   ./start.sh key       암호화 키 다시 보기 (보관용)
#
# 처음 실행하면 backend/.env 를 만들고 암호화 키를 자동으로 생성합니다.
# 화면이 뜬 키는 반드시 따로 보관하세요 (잃으면 저장된 휴대폰 번호를 읽을 수 없습니다).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACK="$ROOT/backend"
FRONT="$ROOT/frontend"
DATA="$BACK/data"
ENV_FILE="$BACK/.env"
VENV="$BACK/.venv"
PID_FILE="$DATA/server.pid"
LOG_FILE="$DATA/server.log"
BUILT_FILE="$DATA/frontend.built"

say()  { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✕ %s\033[0m\n' "$*" >&2; exit 1; }

mkdir -p "$DATA"

load_env() {
  if [[ -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
  fi
  PORT="${PORT:-8000}"
}

running_pid() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE")"
  kill -0 "$pid" 2>/dev/null && echo "$pid" || return 1
}

stop_server() {
  local pid
  if pid="$(running_pid)"; then
    say "서버를 멈춥니다 (PID $pid)"
    kill "$pid"
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" || true
  fi
  rm -f "$PID_FILE"
}

show_key_box() {
  local key="$1"
  cat <<EOF

  ──────────────────────────────────────────────────────────────
   암호화 키 (BANSUK_DATA_KEY)

     $key

   이 키를 비밀번호 관리 도구나 금고에 따로 보관하세요.
   서버를 새로 만들 때 같은 키가 있어야 휴대폰 번호를 읽습니다.
   카톡·메일·GitHub에는 올리지 마세요. 다시 보기: ./start.sh key
  ──────────────────────────────────────────────────────────────

EOF
}

case "${1:-start}" in
  stop)
    stop_server
    say "멈췄습니다"
    exit 0
    ;;
  status)
    load_env
    if pid="$(running_pid)"; then
      say "돌고 있습니다 (PID $pid, 포트 $PORT)"
      curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && echo "  응답 정상" || warn "응답이 없습니다. ./start.sh logs 로 확인하세요"
    else
      warn "멈춰 있습니다. ./start.sh 로 시작하세요"
    fi
    exit 0
    ;;
  logs)
    touch "$LOG_FILE"
    tail -n 100 -f "$LOG_FILE"
    exit 0
    ;;
  key)
    load_env
    [[ -n "${BANSUK_DATA_KEY:-}" ]] || die "아직 키가 없습니다. ./start.sh 를 먼저 실행하세요"
    show_key_box "$BANSUK_DATA_KEY"
    exit 0
    ;;
  start|restart) ;;
  *)
    die "알 수 없는 명령: $1 (start | stop | status | logs | key)"
    ;;
esac

# ---------- 0. 필요한 프로그램 ----------
command -v python3 >/dev/null || die "python3 가 필요합니다 (3.11 이상)"
command -v npm >/dev/null || die "Node.js(npm)가 필요합니다 (20 이상)"
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' || die "python 3.11 이상이 필요합니다"

# ---------- 1. 최신 코드 ----------
if [[ "${NO_PULL:-0}" != "1" && -d "$ROOT/.git" ]]; then
  say "최신 코드를 받습니다"
  if [[ -n "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ]]; then
    warn "서버에서 고친 파일이 있어 받지 않고 지금 코드로 계속합니다:"
    git -C "$ROOT" status --short --untracked-files=no
  else
    git -C "$ROOT" pull --ff-only || die "코드를 받지 못했습니다. 네트워크나 GitHub 권한을 확인하세요"
  fi
fi

# ---------- 2. 설정 파일과 암호화 키 ----------
NEW_KEY=""
if [[ ! -f "$ENV_FILE" ]]; then
  say "처음 실행입니다. 설정 파일을 만듭니다"
  admin_phone="010-9999-9999"
  admin_name="반석 관리자"
  if [[ -t 0 ]]; then
    read -r -p "  첫 관리자 휴대폰 번호 [$admin_phone]: " ans || true
    admin_phone="${ans:-$admin_phone}"
    read -r -p "  첫 관리자 이름 [$admin_name]: " ans || true
    admin_name="${ans:-$admin_name}"
  fi
  NEW_KEY="$(python3 -c 'import base64,os;print(base64.b64encode(os.urandom(32)).decode())')"
  umask 077
  cat >"$ENV_FILE" <<EOF
# 반석 서버 설정 (이 파일은 GitHub에 올라가지 않습니다)
BANSUK_ENV=production
BANSUK_DATA_KEY=$NEW_KEY
BANSUK_ADMIN_PHONE="$admin_phone"
BANSUK_ADMIN_NAME="$admin_name"
PORT=8000
# 운영 DB를 PostgreSQL로 쓸 때만 아래 줄의 # 을 지우고 고치세요
# DATABASE_URL=postgresql+psycopg://사용자:비밀번호@localhost:5432/bansuk
EOF
  umask 022
fi
load_env
[[ -n "${BANSUK_DATA_KEY:-}" ]] || die "backend/.env 에 BANSUK_DATA_KEY 가 없습니다"

# ---------- 3. 백엔드 설치 ----------
say "백엔드 패키지를 확인합니다"
if [[ ! -x "$VENV/bin/python" ]]; then
  python3 -m venv "$VENV" || die "가상환경을 만들지 못했습니다 (Ubuntu라면: sudo apt install python3-venv)"
fi
REQ_HASH="$(sha256sum "$BACK/requirements.txt" | cut -c1-16)"
if [[ "$(cat "$DATA/requirements.hash" 2>/dev/null)" != "$REQ_HASH" ]]; then
  "$VENV/bin/pip" install -q --upgrade pip
  "$VENV/bin/pip" install -q -r "$BACK/requirements.txt"
  echo "$REQ_HASH" >"$DATA/requirements.hash"
fi

# ---------- 4. 화면 빌드 (코드가 바뀐 경우만) ----------
FRONT_REV="$( (git -C "$ROOT" rev-parse HEAD:frontend 2>/dev/null) || echo none)"
if [[ ! -d "$FRONT/out" || "$(cat "$BUILT_FILE" 2>/dev/null)" != "$FRONT_REV" || "$FRONT_REV" == none ]]; then
  say "화면을 빌드합니다 (1~2분)"
  (
    cd "$FRONT"
    npm ci --silent --no-audit --no-fund
    rm -rf .next out
    # 화면과 API를 같은 서버에서 내보내므로 API 주소는 비워 둔다 (같은 주소)
    NEXT_PUBLIC_API_URL="" NEXT_TELEMETRY_DISABLED=1 npx next build >"$DATA/frontend-build.log" 2>&1 \
      || { tail -30 "$DATA/frontend-build.log"; exit 1; }
  ) || die "화면 빌드에 실패했습니다 (기록: backend/data/frontend-build.log)"
  echo "$FRONT_REV" >"$BUILT_FILE"
else
  echo "  화면은 바뀐 것이 없어 그대로 씁니다"
fi

# ---------- 5. 서버 재시작 ----------
stop_server
say "서버를 시작합니다 (포트 $PORT)"
(
  cd "$BACK"
  nohup "$VENV/bin/uvicorn" app.main:app --host 0.0.0.0 --port "$PORT" --proxy-headers \
    >>"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
)

ok=0
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then ok=1; break; fi
  running_pid >/dev/null || break
  sleep 0.5
done
if [[ "$ok" != 1 ]]; then
  tail -30 "$LOG_FILE"
  die "서버가 뜨지 않았습니다 (위 기록 확인, 전체: ./start.sh logs)"
fi

# ---------- 6. 안내 ----------
[[ -n "$NEW_KEY" ]] && show_key_box "$NEW_KEY"

admin_line="$(grep -a '반석 관리자 계정을 만들었습니다' "$LOG_FILE" | tail -1 || true)"
if [[ -n "$admin_line" && ! -f "$DATA/admin-notice.shown" ]]; then
  printf '  \033[1m%s\033[0m\n  첫 로그인 때 새 비밀번호를 정하게 됩니다.\n' "$admin_line"
  touch "$DATA/admin-notice.shown"
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
say "준비됐습니다"
echo "  이 서버에서:   http://localhost:$PORT"
[[ -n "$IP" ]] && echo "  같은 망에서:   http://$IP:$PORT"
echo "  멈추기: ./start.sh stop   상태: ./start.sh status   기록: ./start.sh logs"
