import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import search
from routers import auth as auth_router
from routers import user as user_router
from config import CORS_ORIGINS

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

app = FastAPI(title="ScholarScout API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)

app.include_router(search.router, prefix="/api")
app.include_router(auth_router.router, prefix="/api/auth")
app.include_router(user_router.router, prefix="/api/user")
