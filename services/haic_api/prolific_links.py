import argparse
import os

from prolific import COHORTS


def study_links(base_url):
    params = "PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}"
    for cohort, condition in COHORTS.items():
        for part in range(1, 5):
            yield condition, part, f"{base_url.rstrip('/')}/api/prolific/start/{cohort}/{part}?{params}"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Print the 12 Prolific wave entry links (no participant records are created).")
    parser.add_argument("--base-url", default=os.getenv("STUDY_PUBLIC_URL", "https://iivm11.cit.tum.de"))
    args = parser.parse_args()
    for condition, part, url in study_links(args.base_url):
        print(f"{condition} / Session {part}\n{url}\n")
