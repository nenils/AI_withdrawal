"""Create isolated test participants from the administrator's container shell."""

import argparse
import os
import uuid

from withdrawal_store import CONDITIONS, WithdrawalStore, create_game_state, iso, utc_now


def create_debug_participant(store: WithdrawalStore, session: int, condition: str) -> str:
    if session not in range(1, 5) or condition not in CONDITIONS:
        raise ValueError("Invalid session or condition")
    participant_id = f"debug-{uuid.uuid4().hex}"
    record = store.get_or_create(participant_id, condition)
    record["current_session"] = session
    record["game_state"] = create_game_state(session, utc_now())
    record["updated_at"] = iso(utc_now())
    store.save(record)
    return participant_id


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session", type=int, choices=range(1, 5), required=True)
    parser.add_argument("--condition", choices=sorted(CONDITIONS), default="control")
    args = parser.parse_args()
    store = WithdrawalStore()
    if not store.persistent:
        parser.error("Supabase credentials are required to share the test record with the API")
    participant_id = create_debug_participant(store, args.session, args.condition)
    base = os.getenv("STUDY_PUBLIC_URL", "https://iivm11.cit.tum.de").rstrip("/")
    print(f"{base}/HAIC_part_{args.session}/?sona_id={participant_id}")
    print("Test participant only; no SONA credit. Exclude debug- IDs from analysis.")


if __name__ == "__main__":
    main()
