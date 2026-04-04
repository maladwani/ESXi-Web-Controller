import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/app.db")

connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    import models  # noqa: F401 — register models with Base.metadata

    if DATABASE_URL.startswith("sqlite"):
        from pathlib import Path

        raw = DATABASE_URL.replace("sqlite:///", "", 1)
        p = Path(raw)
        if not p.is_absolute():
            p = Path.cwd() / p
        p.parent.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
