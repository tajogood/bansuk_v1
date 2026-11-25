import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import Base, engine
from .routers import auth, daily


@asynccontextmanager
async def lifespan(_: FastAPI):
    # 1단계에서는 create_all로 시작하고, 운영 전환 시 Alembic 마이그레이션으로 바꾼다.
    Base.metadata.create_all(engine)
    yield


app = FastAPI(title="반석 가금 생산·방역 관리 API", version="0.1.0", lifespan=lifespan)

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
