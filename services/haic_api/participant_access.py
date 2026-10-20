"""Supabase identity binding and short-lived same-origin API sessions."""

import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request


COOKIE_NAME = "study_session"


class ParticipantAccess:
    def __init__(self, store):
        self.store = store
        self.secret = os.getenv("STUDY_SESSION_SECRET", "") or store.service_key
        if store.persistent and len(self.secret) < 32:
            raise ValueError("The study session signing key must have at least 32 characters")

    def user_for_token(self, token):
        request = urllib.request.Request(
            f"{self.store.base_url}/auth/v1/user",
            headers={"apikey": self.store.service_key, "Authorization": f"Bearer {token}"},
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                return json.load(response)["id"]
        except (urllib.error.HTTPError, KeyError) as exc:
            raise PermissionError("Please reopen the original study link to sign in.") from exc

    def is_researcher(self, user_id):
        user = urllib.parse.quote(user_id, safe="")
        return bool(self.store._request("GET", f"study_researchers?user_id=eq.{user}&select=user_id"))

    def bind(self, user_id, participant_id):
        participant = urllib.parse.quote(participant_id, safe="")
        rows = self.store._request("GET", f"withdrawal_participant_access?participant_id=eq.{participant}&select=user_id")
        if rows:
            if rows[0]["user_id"] != user_id and not self.is_researcher(user_id):
                raise PermissionError("This study link is already associated with another browser. Please contact the researcher to restore access.")
            return
        if participant_id.startswith('debug-') and not self.store.get(participant_id):
            raise PermissionError('Generate a debug link using the administrator command first.')
        self.store.get_or_create(participant_id)
        # Ignore a concurrent insert, then check ownership rather than overwriting it.
        self.store._request("POST", "withdrawal_participant_access?on_conflict=participant_id", {
            "participant_id": participant_id, "user_id": user_id,
        }, "resolution=ignore-duplicates,return=minimal")
        self.require_owner(user_id, participant_id)

    def require_owner(self, user_id, participant_id):
        participant = urllib.parse.quote(participant_id, safe="")
        rows = self.store._request("GET", f"withdrawal_participant_access?participant_id=eq.{participant}&select=user_id")
        if not rows or (rows[0]["user_id"] != user_id and not self.is_researcher(user_id)):
            raise PermissionError("You do not have access to this participant.")

    def issue_cookie(self, user_id):
        payload = base64.urlsafe_b64encode(json.dumps({"uid": user_id, "exp": int(time.time()) + 28800}).encode()).decode()
        signature = hmac.new(self.secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
        return f"{payload}.{signature}"

    def read_cookie(self, cookie):
        try:
            payload, signature = cookie.rsplit(".", 1)
            expected = hmac.new(self.secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(signature, expected):
                raise ValueError("Invalid signature")
            value = json.loads(base64.urlsafe_b64decode(payload))
            if value["exp"] <= time.time():
                raise ValueError("Expired session")
            return value["uid"]
        except (ValueError, KeyError, TypeError, AttributeError) as exc:
            raise PermissionError("Please reopen the original study link to renew your session.") from exc
