# githubcity

Your GitHub as a city. Each repo is a building, rendered in 3D at night:

- **Height** is the repo's stars, on a log scale by default (switch to linear in Settings).
- **Lit windows** are commits from the last 90 days. A dead repo is a dark tower.
- **Roof color** is the repo's main language.
- **Traffic** in the streets scales with the profile's total recent commits.
- **Footprint** grows a little with repo size. The most-starred repos sit downtown, and the top three get blinking antennas.

Hover a building to see its name, click it to fly over and open its card, and press **Post skyline** to export a 16:9 or square PNG with your handle and stats. The poster uses your current camera angle. Links like `?u=torvalds` open straight to that city.

## Run it

It's a static site with no build step. Three.js loads from jsDelivr.

```bash
python3 serve.py
```

Then open http://localhost:4173. `serve.py` is a plain static server with browser caching turned off, so edits show up on reload. Any static server works.

## Data and rate limits

Everything comes from GitHub's public REST API, called from the browser.

- **Without a token** you get 60 requests an hour. A city costs about 3–7 of them. Lights are *estimated* from the profile's public event feed: GitHub keeps 90 days and at most 300 events. A repo that was pushed recently but falls outside the feed still gets a light on.
- **With a token** (Settings, no scopes needed) you get 5,000 requests an hour. Lights are exact commit counts on each repo's default branch for the last 90 days, up to 150 recently pushed repos. The token stays in the tab's memory and is only sent to `api.github.com`.
- Accounts with more than 300 repos show their 200 most-starred repos (from the Search API) plus the 100 most recently pushed.
- Responses are cached in `localStorage` for an hour per username.
- Type `demo` to get a made-up city that costs no API calls.

## Files

- `src/github.js`: fetching, commit counting and the demo city
- `src/city.js`: the Three.js scene, including layout, facades, traffic, bloom and the poster snapshot
- `src/poster.js`: composes the shareable PNG
- `src/main.js`: UI wiring
- `src/languages.js`: language colors from GitHub Linguist
