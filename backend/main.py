from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import search
from config import CORS_ORIGINS

app = FastAPI(title="ScholarScout API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(search.router, prefix="/api")
