"""Read-only Sleeper history importer for the Ugh Who Cares league.

The script follows Sleeper's previous_league_id chain and saves raw JSON snapshots
outside the repository. It never writes back to Sleeper.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import time
from pathlib import Path

API = "https://api.sleeper.app/v1"


def get_json(path: str):
    result = subprocess.run(
        ["curl.exe", "-sS", "--fail", "-A", "ugh-who-cares-import/1.0", f"{API}{path}"],
        check=True,
        capture_output=True,
        timeout=60,
    )
    return json.loads(result.stdout)


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def fetch_league(league_id: str, root: Path) -> dict:
    league = get_json(f"/league/{league_id}")
    season = league.get("season", league_id)
    season_dir = root / str(season)
    write_json(season_dir / "league.json", league)

    for name, endpoint in {
        "users.json": f"/league/{league_id}/users",
        "rosters.json": f"/league/{league_id}/rosters",
        "traded_picks.json": f"/league/{league_id}/traded_picks",
        "winners_bracket.json": f"/league/{league_id}/winners_bracket",
        "losers_bracket.json": f"/league/{league_id}/losers_bracket",
        "drafts.json": f"/league/{league_id}/drafts",
    }.items():
        try:
            write_json(season_dir / name, get_json(endpoint))
        except Exception as exc:  # keep the import resilient to optional endpoints
            write_json(season_dir / (name.replace(".json", ".error.json")), {"error": str(exc)})

    for week in range(1, 18):
        try:
            write_json(season_dir / "matchups" / f"week-{week}.json", get_json(f"/league/{league_id}/matchups/{week}"))
        except Exception as exc:
            write_json(season_dir / "matchups" / f"week-{week}.error.json", {"error": str(exc)})
        time.sleep(0.03)

    for round_number in range(1, 19):
        try:
            write_json(season_dir / "transactions" / f"round-{round_number}.json", get_json(f"/league/{league_id}/transactions/{round_number}"))
        except Exception as exc:
            write_json(season_dir / "transactions" / f"round-{round_number}.error.json", {"error": str(exc)})
        time.sleep(0.03)

    drafts = get_json(f"/league/{league_id}/drafts")
    for draft in drafts or []:
        draft_id = draft.get("draft_id")
        if not draft_id:
            continue
        try:
            write_json(season_dir / "drafts" / f"{draft_id}-picks.json", get_json(f"/draft/{draft_id}/picks"))
        except Exception as exc:
            write_json(season_dir / "drafts" / f"{draft_id}-picks.error.json", {"error": str(exc)})

    return league


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--league-id", default="1389347064877441024")
    parser.add_argument("--seasons", type=int, default=3)
    parser.add_argument("--output", type=Path, default=Path("work/sleeper-snapshots"))
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    try:
        write_json(args.output / "players-nfl.json", get_json("/players/nfl"))
    except Exception as exc:
        write_json(args.output / "players-nfl.error.json", {"error": str(exc)})

    league_id = args.league_id
    imported = []
    for _ in range(args.seasons):
        league = fetch_league(league_id, args.output)
        imported.append({"league_id": league.get("league_id"), "season": league.get("season"), "previous_league_id": league.get("previous_league_id")})
        league_id = league.get("previous_league_id")
        if not league_id:
            break
    write_json(args.output / "index.json", imported)
    print(json.dumps(imported, indent=2))


if __name__ == "__main__":
    main()
