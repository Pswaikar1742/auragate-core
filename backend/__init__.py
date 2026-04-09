"""AuraGate backend package marker.

Make the `backend` directory importable as a package so helper scripts
can be executed with `python -m backend.manage_supabase`.
"""

__all__ = ["database", "models", "main"]
