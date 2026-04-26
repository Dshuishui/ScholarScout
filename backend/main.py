import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import search
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
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(search.router, prefix="/api")
