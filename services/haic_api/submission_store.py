import hashlib
import json
import urllib.parse


class SubmissionStore:
    def __init__(self, store):
        self.store = store

    def get(self, participant_id, part):
        if not self.store.persistent:
            return None
        query = urllib.parse.urlencode({
            "participant_id": f"eq.{participant_id}",
            "part_number": f"eq.{part}",
            "select": "*",
        })
        rows = self.store._request("GET", f"withdrawal_submissions?{query}")
        return rows[0] if rows else None

    def freeze(self, participant_id, part, data):
        if not self.store.persistent:
            raise RuntimeError("Persistent submission storage is required before credit")
        encoded = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        rows = self.store._request(
            "POST", "withdrawal_submissions?on_conflict=participant_id,part_number",
            {
                "participant_id": participant_id, "part_number": part,
                "data": data, "sha256": hashlib.sha256(encoded.encode()).hexdigest(),
            },
            "resolution=ignore-duplicates,return=representation",
        )
        saved = rows[0] if rows else self.get(participant_id, part)
        if not saved:
            raise RuntimeError("The original submission could not be preserved")
        return saved
