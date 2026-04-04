#!/usr/bin/env python3
"""Create an admin user if it does not exist. Run from backend directory: python scripts/init_admin.py"""
import os
import sys

_backend_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend_root not in sys.path:
    sys.path.insert(0, _backend_root)


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Create initial ESXi Web admin user")
    parser.add_argument(
        "--username",
        default=os.getenv("INITIAL_ADMIN_USERNAME"),
        help="Or set INITIAL_ADMIN_USERNAME",
    )
    parser.add_argument(
        "--password",
        default=os.getenv("INITIAL_ADMIN_PASSWORD"),
        help="Or set INITIAL_ADMIN_PASSWORD",
    )
    args = parser.parse_args()
    if not args.username or not args.password:
        print(
            "Error: provide --username and --password or set "
            "INITIAL_ADMIN_USERNAME and INITIAL_ADMIN_PASSWORD",
            file=sys.stderr,
        )
        sys.exit(1)

    from db import SessionLocal, init_db
    from models import User
    from auth import hash_password

    init_db()
    db = SessionLocal()
    try:
        if db.query(User).filter(User.username == args.username.strip()).first():
            print("User already exists; nothing to do.")
            return
        db.add(
            User(
                username=args.username.strip(),
                password_hash=hash_password(args.password),
            )
        )
        db.commit()
        print("Admin user created successfully.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
