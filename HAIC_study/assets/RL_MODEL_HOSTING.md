# Hosting the Mastermind RL Suggestion Model

The low cognitive responsibility condition (`HAIC_role_Advisor_increasing_complexity.html`) is wired to the Docker API endpoint:

```js
var RL_MODEL_ENDPOINT = "/api/rl/predict";
```

That endpoint is served by `services/haic_api/app.py` and uses the adapter in `services/haic_api/rl_model.py`.

## Integrated Docker setup

Put the trained model artifact here before rebuilding:

```text
services/haic_api/models/mastermind_rl_model.pt
```

Then set this in `.env.docker` on the VM:

```bash
RL_MODEL_PATH=/app/models/mastermind_rl_model.pt
```

Reload:

```bash
sudo docker compose up --build -d
```

Check whether the model loaded:

```bash
curl http://localhost:8080/api/health
```

If `rlModelLoaded` is `false`, the API automatically falls back to the bundled dummy consistency-filter model.

The adapter accepts:

- a `.pt` / `.pth` artifact loaded with `torch.load(...)`; the loaded object should be callable or expose `predict(state_dict)`
- a `.json` policy with `openingGuess`, `defaultGuess`, or a keyed `policy` object

The model receives a state dictionary with `round`, `codeLength`, `availableColors`, `attempt`, `guessHistory`, and `feedbackHistory`, and should return a list such as:

```json
["Green", "Blue", "Blue", "Red"]
```

## External endpoint option

If you later want to host the RL model separately, the same frontend can point to an HTTPS endpoint.

## Endpoint contract

Set this variable in the Advisor HTML:

```js
var RL_MODEL_ENDPOINT = "https://your-domain.example/predict";
```

The page sends one `POST` request per Advisor iteration:

```json
{
  "game": "mastermind",
  "reason": "round start",
  "round": 3,
  "codeLength": 4,
  "availableColors": ["Blue", "Green", "Red"],
  "maxAttemptsPerRound": 10,
  "attempt": 2,
  "guessHistory": {
    "1": ["Blue", "Green", "Red", "Blue"]
  },
  "feedbackHistory": {
    "1": { "black": 1, "white": 2 }
  }
}
```

Return any of these fields as a 4-color array using only the current `availableColors`:

```json
{
  "guess": ["Green", "Blue", "Blue", "Red"]
}
```

The frontend also accepts `suggestion`, `next_guess`, or `action`.

## Minimal FastAPI wrapper

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://your-study-domain.example"],
    allow_methods=["POST"],
    allow_headers=["*"],
)

class State(BaseModel):
    availableColors: list[str]
    codeLength: int
    guessHistory: dict = {}
    feedbackHistory: dict = {}

@app.post("/predict")
def predict(state: State):
    guess = trained_mastermind_agent.predict(
        colors=state.availableColors,
        code_length=state.codeLength,
        guesses=state.guessHistory,
        feedback=state.feedbackHistory,
    )
    return {"guess": guess}
```

Host options:

- **Cloud Run**: good default for HTTPS, autoscaling, and simple Docker deployment.
- **Hugging Face Spaces**: convenient if the model is Python-based and latency is not critical.
- **University VM**: fine for a lab deployment; put Nginx/Caddy in front for HTTPS.

Keep the RL model server separate from the static study frontend so model files and credentials are not exposed in the browser. Enable CORS only for the study domain.
