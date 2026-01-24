# Master Pool Schema (v1)

Each selection MUST contain:

- match_id: string        # Flashscore ID (mandatory)
- flashscore_url: string  # https://www.flashscore.mobi/match/{ID}/
- teams: string           # "Liverpool – Burnley"
- start_time: string      # ISO or "HH:MM"
- competition: string     # "Premier League"
- country: string         # "ENGLAND"

- bet_type: string        # enum:
                          # 1x2 | goals_ou | team_goals_min | btts | dc
- bet_text_ro: string     # RO text (source language)
- bet_text_en: string     # EN text (translated OR generated)
- params: object          # depends on bet_type
- odd: number

- source: string          # e.g. "claudiuhood"
