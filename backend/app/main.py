import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from .i18n import I18nJSONResponse, http_exception_handler, lang_middleware

from .bootstrap import ensure_admin
from .crypto import check_key
from .db import Base, SessionLocal, engine
from .routers import admin, analysis, auth, cases, daily, flocks, imports, reports


@asynccontextmanager
async def lifespan(_: FastAPI):
    # 1단계에서는 create_all로 시작하고, 운영 전환 시 Alembic 마이그레이션으로 바꾼다.
    check_key()
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        ensure_admin(db)
    yield


app = FastAPI(
    title="반석 가금 생산·방역 관리 API",
    version="0.1.0",
    lifespan=lifespan,
    default_response_class=I18nJSONResponse,
)
app.middleware("http")(lang_middleware)
app.add_exception_handler(StarletteHTTPException, http_exception_handler)

_origins = os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _origins if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"ok": True}


app.include_router(auth.router)
app.include_router(daily.router)
app.include_router(reports.router)
app.include_router(analysis.router)
app.include_router(admin.router)
app.include_router(cases.router)
app.include_router(flocks.router)
app.include_router(imports.router)


# 운영: 빌드한 화면(frontend/out)을 같은 서버에서 내보낸다 (포트 하나, CORS 불필요).
# API 경로가 먼저 등록되어 있으므로 /api/* 는 영향받지 않는다.
_front = Path(os.environ.get("FRONTEND_DIR", Path(__file__).resolve().parents[2] / "frontend" / "out"))
if _front.is_dir():
    app.mount("/", StaticFiles(directory=_front, html=True), name="frontend")
