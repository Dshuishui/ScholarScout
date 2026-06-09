import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from logging_config import setup_logging
from sentry_config import setup_sentry
from routers import search, auth as auth_router, user as user_router, feedback as feedback_router, paper as paper_router
from routers import subscriptions as subscriptions_router
from routers import semantic as semantic_router
from routers import ws_router
from database import init_db
from config import CORS_ORIGINS
from scheduler import setup_scheduler

# Initialise structured logging before anything else logs.
setup_logging()
setup_sentry()

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    sched = setup_scheduler()
    sched.start()
    logger.info("ScholarScout started")
    yield
    sched.shutdown(wait=False)
    logger.info("ScholarScout shutdown")


app = FastAPI(title="ScholarScout API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST", "DELETE", "PATCH"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(search.router, prefix="/api")
app.include_router(auth_router.router, prefix="/api/auth")
app.include_router(user_router.router, prefix="/api/user")
app.include_router(feedback_router.router, prefix="/api/feedback")
app.include_router(paper_router.router, prefix="/api/paper")
app.include_router(subscriptions_router.router, prefix="/api")
app.include_router(semantic_router.router, prefix="/api/semantic")
app.include_router(ws_router.router)
