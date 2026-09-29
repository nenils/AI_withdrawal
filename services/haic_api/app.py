import json
import os
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from rl_model import MastermindRLModel
from withdrawal_store import WithdrawalStore


OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "").strip()
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.1-70b-instruct")
OPENROUTER_BASE_URL = os.getenv(
    "OPENROUTER_BASE_URL",
    "https://openrouter.ai/api/v1/chat/completions",
)
STUDY_PUBLIC_URL = os.getenv("STUDY_PUBLIC_URL", "http://localhost:8080")
PROLIFIC_COMPLETION_CODE = os.getenv("PROLIFIC_COMPLETION_CODE", "").strip()
SONA_CREDIT_TEST_MODE = os.getenv("SONA_CREDIT_TEST_MODE", "false").lower() == "true"
SONA_COMPLETION_URLS = {
    part: os.getenv(f"SONA_PART_{part}_COMPLETION_URL", "").strip()
    for part in range(1, 5)
}
RL_MODEL_PATH = os.getenv("RL_MODEL_PATH", "").strip()
RL_MODEL = MastermindRLModel(RL_MODEL_PATH or None)
MAX_LLM_MESSAGES_PER_ROUND = int(os.getenv("MAX_LLM_MESSAGES_PER_ROUND", "20"))
LLM_MESSAGE_COUNTS: dict[tuple[str, int, int], int] = {}
WITHDRAWAL_STORE = WithdrawalStore()
ALLOWED_STUDY_ORIGINS = {
    STUDY_PUBLIC_URL,
    "http://iivm6.cit.tum.de",
    "https://iivm6.cit.tum.de",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
}

app = FastAPI(title="HAIC Study API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(ALLOWED_STUDY_ORIGINS),
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


class RLState(BaseModel):
    reason: str | None = None
    round: int = 1
    codeLength: int = 4
    availableColors: list[str] = Field(default_factory=lambda: ["Blue"])
    maxAttemptsPerRound: int = 10
    attempt: int = 1
    guessHistory: dict[str, list[str]] = Field(default_factory=dict)
    feedbackHistory: dict[str, dict[str, int]] = Field(default_factory=dict)


class ChatPayload(BaseModel):
    participantId: str | None = None
    studyRound: int | None = None
    studySession: int | None = None
    model: str | None = None
    max_tokens: int | None = None
    temperature: float | None = None
    top_p: float | None = None
    frequency_penalty: float | None = None
    presence_penalty: float | None = None
    stop: list[str] | None = None
    messages: list[dict[str, Any]]


class WithdrawalStatePayload(BaseModel):
    participantId: str = Field(min_length=1, max_length=128)
    condition: str | None = None
    partNumber: int = Field(ge=1, le=4)


class WithdrawalGuessPayload(WithdrawalStatePayload):
    guess: list[str]


class WithdrawalEventsPayload(BaseModel):
    participantId: str = Field(min_length=1, max_length=128)
    events: list[dict[str, Any]]


class SonaCompletionPayload(BaseModel):
    participantId: str = Field(min_length=1, max_length=128)
    partNumber: int = Field(ge=1, le=4)


def grant_sona_credit(part_number: int, survey_code: str) -> None:
    if SONA_CREDIT_TEST_MODE:
        return
    template = SONA_COMPLETION_URLS[part_number]
    if not template:
        raise RuntimeError(f"SONA Part {part_number} completion URL is not configured")
    encoded_code = urllib.parse.quote(survey_code, safe="")
    if "{survey_code}" in template:
        url = template.replace("{survey_code}", encoded_code)
    elif "XXXX" in template:
        url = template.replace("XXXX", encoded_code)
    else:
        separator = "&" if "?" in template else "?"
        url = f"{template}{separator}survey_code={encoded_code}"
    request = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read().decode("utf-8", errors="replace")
            if response.status < 200 or response.status >= 300:
                raise RuntimeError(f"SONA returned HTTP {response.status}")
            try:
                root = ET.fromstring(body)
            except ET.ParseError as exc:
                raise RuntimeError("SONA returned an invalid credit response") from exc
            result = next(
                (element for element in root.iter() if element.tag.split("}")[-1] == "Result"),
                None,
            )
            credit_status = next(
                (
                    (element.text or "").strip()
                    for element in root.iter()
                    if element.tag.split("}")[-1] == "credit_status"
                ),
                "",
            )
            if result is None or credit_status != "G":
                raise RuntimeError("SONA rejected the participant credit request")
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"SONA returned HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError("SONA could not be reached") from exc


def dummy_llm_response(payload: ChatPayload) -> dict[str, Any]:
    text = "\n".join(str(message.get("content", "")) for message in payload.messages)
    prediction = None
    final_guess = None

    for marker in ("PREDICTION:", "FINAL GUESS:"):
        marker_idx = text.upper().rfind(marker)
        if marker_idx == -1:
            continue
        bracket_start = text.find("[", marker_idx)
        bracket_end = text.find("]", bracket_start)
        if bracket_start != -1 and bracket_end != -1:
            colors = [part.strip() for part in text[bracket_start + 1:bracket_end].split(",")]
            if len(colors) == 4:
                if marker == "PREDICTION:":
                    prediction = colors
                else:
                    final_guess = colors

    if prediction:
        content = (
            "The dummy LLM proxy is active. The trained RL model suggested this guess "
            "because it is consistent with the current game state supplied by the frontend. "
            f"PREDICTION: [{', '.join(prediction)}]"
        )
    elif final_guess:
        content = (
            "The dummy LLM proxy is active. I would keep this proposed guess for now because "
            "no external LLM token is configured to provide a deeper review. "
            f"FINAL GUESS: [{', '.join(final_guess)}]"
        )
    else:
        content = (
            "The dummy LLM proxy is active. Configure OPENROUTER_API_KEY in the Docker "
            "environment for full explanations. FINAL GUESS: [Blue, Blue, Blue, Blue]"
        )

    return {"choices": [{"message": {"content": content}}], "dummy": True}


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "rlModelLoaded": RL_MODEL.is_loaded,
        "rlModelPath": str(RL_MODEL.model_path),
        "rlModelLoadError": RL_MODEL.load_error,
        "withdrawalStorage": "supabase" if WITHDRAWAL_STORE.persistent else "memory",
    }


@app.post("/api/withdrawal/state")
def withdrawal_state(payload: WithdrawalStatePayload) -> dict[str, Any]:
    try:
        record = WITHDRAWAL_STORE.get_or_create(payload.participantId, payload.condition)
        return WITHDRAWAL_STORE.public_state(record, payload.partNumber)
    except PermissionError as exc:
        raise HTTPException(status_code=423, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/withdrawal/guess")
def withdrawal_guess(payload: WithdrawalGuessPayload) -> dict[str, Any]:
    try:
        return WITHDRAWAL_STORE.submit_guess(
            payload.participantId,
            payload.condition,
            payload.guess,
            payload.partNumber,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=423, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/withdrawal/events")
def withdrawal_events(payload: WithdrawalEventsPayload) -> dict[str, int]:
    try:
        return {"accepted": WITHDRAWAL_STORE.append_events(payload.participantId, payload.events)}
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/sona/complete-part")
def complete_sona_part(payload: SonaCompletionPayload) -> dict[str, Any]:
    try:
        record = WITHDRAWAL_STORE.part_ready_for_credit(
            payload.participantId,
            payload.partNumber,
        )
        already_credited = payload.partNumber in (record.get("credited_parts") or [])
        if not already_credited:
            grant_sona_credit(payload.partNumber, payload.participantId)
            record = WITHDRAWAL_STORE.mark_part_credited(
                payload.participantId,
                payload.partNumber,
            )
        return {
            "credited": True,
            "alreadyCredited": already_credited,
            "partNumber": payload.partNumber,
            "studyCompleted": bool(record.get("completed_at")),
        }
    except PermissionError as exc:
        raise HTTPException(status_code=423, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/prolific/complete")
def complete_prolific() -> RedirectResponse:
    if not PROLIFIC_COMPLETION_CODE:
        raise HTTPException(
            status_code=503,
            detail="Prolific completion code is not configured on the server.",
        )

    return RedirectResponse(
        url=f"https://app.prolific.com/submissions/complete?cc={PROLIFIC_COMPLETION_CODE}",
        status_code=302,
    )


@app.post("/api/rl/predict")
def predict_rl(state: RLState) -> dict[str, Any]:
    return RL_MODEL.predict(state)


@app.post("/api/llm/chat")
def llm_chat(payload: ChatPayload) -> dict[str, Any]:
    participant_id = (payload.participantId or "anonymous").strip()[:128] or "anonymous"
    study_round = payload.studyRound or 0
    study_session = payload.studySession or 0
    counter_key = (participant_id, study_session, study_round)
    current_count = LLM_MESSAGE_COUNTS.get(counter_key, 0)
    if current_count >= MAX_LLM_MESSAGES_PER_ROUND:
        raise HTTPException(
            status_code=429,
            detail=(
                "The AI message limit for this round has been reached. "
                "Please continue with the game board; the AI chat will be available again in the next round."
            ),
        )
    LLM_MESSAGE_COUNTS[counter_key] = current_count + 1

    if not OPENROUTER_API_KEY:
        return dummy_llm_response(payload)

    body = payload.model_dump(exclude={"participantId", "studyRound", "studySession"}, exclude_none=True)
    body["model"] = body.get("model") or OPENROUTER_MODEL
    data = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        OPENROUTER_BASE_URL,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "HTTP-Referer": STUDY_PUBLIC_URL,
            "X-Title": "HAIC Mastermind Study",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=exc.code, detail=detail) from exc
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=502, detail=str(exc.reason)) from exc
