"""
Sentry SDK setup.

Set SENTRY_DSN in environment to enable. Disabled by default so the app
works without Sentry in local development.
"""
import os
import logging

logger = logging.getLogger(__name__)

SENTRY_DSN = os.environ.get("SENTRY_DSN", "")
SENTRY_ENVIRONMENT = os.environ.get("SENTRY_ENVIRONMENT", "development")
SENTRY_TRACES_SAMPLE_RATE = float(os.environ.get("SENTRY_TRACES_SAMPLE_RATE", "0.1"))


def setup_sentry() -> None:
    """Initialize Sentry SDK. No-op if SENTRY_DSN is not configured."""
    if not SENTRY_DSN:
        logger.info("SENTRY_DSN not set — error tracking disabled")
        return

    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
        from sentry_sdk.integrations.logging import LoggingIntegration

        sentry_sdk.init(
            dsn=SENTRY_DSN,
            environment=SENTRY_ENVIRONMENT,
            traces_sample_rate=SENTRY_TRACES_SAMPLE_RATE,
            integrations=[
                FastApiIntegration(transaction_style="endpoint"),
                SqlalchemyIntegration(),
                LoggingIntegration(
                    level=logging.WARNING,        # capture WARNING+ as breadcrumbs
                    event_level=logging.ERROR,    # send ERROR+ as events
                ),
            ],
            # Strip PII from request bodies
            send_default_pii=False,
            # Ignore expected operational errors
            ignore_errors=[KeyboardInterrupt],
        )
        logger.info("Sentry initialized (env=%s, traces=%.0f%%)",
                    SENTRY_ENVIRONMENT, SENTRY_TRACES_SAMPLE_RATE * 100)
    except Exception as e:
        logger.warning("Sentry init failed (non-fatal): %s", e)
