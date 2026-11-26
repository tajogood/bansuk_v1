#!/bin/bash
# 반석 시스템 맥 설치 · 실행
# Finder에서 더블클릭하면 터미널이 열리고 차례대로 진행됩니다.
# 다시 실행해도 됩니다 (이미 깔린 것은 건너뜀).
set -e
# 이 파일은 bansuk_v1 폴더 바로 바깥에 두고 실행한다 (저장소 안에 있으면 저장소 폴더를 바로 씀)
HERE="$(cd "$(dirname "$0")" && pwd)"
if [[ -f "$HERE/start.sh" ]]; then cd "$HERE"; elif [[ -f "$HERE/../../start.sh" ]]; then cd "$HERE/../.."; else cd "$HERE/bansuk_v1"; fi

say()  { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✕ %s\033[0m\n' "$*"; read -r -p "엔터를 누르면 창이 닫힙니다 " _; exit 1; }

# 1. Homebrew
for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [[ -x "$b" ]] && eval "$("$b" shellenv)" && break; done
if ! command -v brew >/dev/null; then
  say "Homebrew를 설치합니다. 맥 로그인 비밀번호를 물으면 입력하세요 (입력해도 화면에 안 보입니다)"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || fail "Homebrew 설치 실패"
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [[ -x "$b" ]] && eval "$("$b" shellenv)" && break; done
fi

# 2. 파이썬 3.11+ 와 Node 20+
py_ok=0
for c in python3.13 python3.12 python3.11; do command -v "$c" >/dev/null && py_ok=1 && break; done
if [[ "$py_ok" == 0 ]]; then say "Python 3.12를 설치합니다"; HOMEBREW_NO_AUTO_UPDATE=1 brew install python@3.12 < <(yes) || fail "Python 설치 실패"; fi

node_major="$(node -v 2>/dev/null | sed 's/^v//; s/\..*//')"
if [[ -z "$node_major" || "$node_major" -lt 20 ]]; then
  # node 가 없거나, brew 라이브러리 업그레이드로 실행이 안 되는 경우: brew로 설치·업그레이드
  say "Node.js를 설치·업그레이드합니다"
  HOMEBREW_NO_AUTO_UPDATE=1 brew install node < <(yes) || HOMEBREW_NO_AUTO_UPDATE=1 brew upgrade node < <(yes) || fail "Node 설치 실패"
  hash -r
  node -v >/dev/null 2>&1 || fail "Node가 실행되지 않습니다 (brew reinstall node 필요)"
fi

# 3. 설치 · 빌드 · 서버 시작
FIRST=0; [[ -f backend/.env ]] || FIRST=1
./start.sh || fail "서버 시작 실패 (./start.sh logs 로 기록 확인)"

# 4. 첫 설치 때만: 데모 데이터
if [[ "$FIRST" == 1 ]]; then
  read -r -p $'\n  화면을 둘러볼 가상 데모 데이터를 넣을까요? [Y/n] ' ans || true
  if [[ "${ans:-Y}" =~ ^[Yy] ]]; then
    say "데모 데이터를 넣습니다"
    ( set -a; . backend/.env; set +a; cd backend && .venv/bin/python -m app.seed ) || fail "데모 데이터 실패"
    NO_PULL=1 ./start.sh >/dev/null && echo "  완료. 데모 계정: 관리자 010-2222-2222 / bansuk2026, 농장주 010-0000-0000 / 246810"
  fi
fi

open "http://localhost:$(grep -E '^PORT=' backend/.env | cut -d= -f2 || echo 8000)"
say "끝났습니다. 위의 암호화 키는 꼭 따로 보관하세요. 이 창은 닫아도 서버는 계속 돕니다"
read -r -p "엔터를 누르면 창이 닫힙니다 " _
