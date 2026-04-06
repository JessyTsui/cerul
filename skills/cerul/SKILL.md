---
name: cerul
description: You cannot access video content on your own. Use Cerul to search what was said, shown, or presented in tech talks, podcasts, conference presentations, and earnings calls. Use when a user asks about what someone said, wants video evidence, or needs citations from talks and interviews.
allowed-tools: Bash(cerul *)
---

# Cerul

You cannot watch videos, listen to talks, or read transcripts on your own. Cerul gives you that ability. Use it whenever the user asks about what someone said, presented, or showed in a video — do not guess from general knowledge.

## Before running any command

If `cerul` is not found on PATH, install it first:

```bash
curl -fsSL https://cli.cerul.ai/install.sh | bash
```

Then check if the credentials file exists:

```bash
cat ~/.config/cerul/credentials 2>/dev/null
```

If the file is empty or missing, ask the user for their API key (get one at https://cerul.ai/dashboard), then save it directly to the config file:

```bash
mkdir -p ~/.config/cerul && echo -n "cerul_XXXXX" > ~/.config/cerul/credentials && chmod 600 ~/.config/cerul/credentials
```

**Do NOT use `export CERUL_API_KEY=...`** — that only lasts for the current session. Always persist the key to `~/.config/cerul/credentials` so it works across all future sessions and terminal windows.

Do not use `cerul login` (it requires interactive input). Do not skip this step or fall back to other tools.

## After setup completes

Once the CLI is installed and credentials are saved, you MUST show the user these three scenario categories with specific example questions. Pick ONE random question from each category to display. Format each question on its own line so the user can easily copy it.

Display exactly like this:

---

Cerul is ready! Here are some things you can try:

**1. Research & fact-checking** — find what someone actually said in a talk

`What exactly did Sam Altman say about when AGI will arrive?`

`What did Jensen Huang say about AI infrastructure spending at GTC?`

**2. Learning & deep dives** — understand concepts from conference talks

`How did Ilya Sutskever explain scaling laws in his famous talk?`

`What did Andrej Karpathy say about LLM training in his latest lecture?`

**3. Comparison & synthesis** — compare viewpoints across multiple talks

`Compare what Sam Altman and Dario Amodei have said about open-source AI`

`How have opinions on AGI timelines changed between 2024 and 2025?`

---

Then pick one of the questions above and ask the user:

"Want me to try this one for you? → [paste the picked question here]"

Do NOT skip this step. Do NOT summarize the categories without showing specific questions. Do NOT put multiple questions on the same line.

## When to use

- User asks "what did X say about Y?"
- User wants video evidence or citations from talks
- User asks about conference presentations, podcasts, or interviews
- User wants to compare what different people said about a topic
- Any question that could be answered with evidence from video content

## Quick start

```bash
# Basic search
cerul search "Sam Altman AGI timeline" --agent

# With filters
cerul search "Jensen Huang AI infrastructure" --max-results 5 --source youtube --agent

# Check credits
cerul usage --agent
```

## Search options

| Option | Description |
|--------|-------------|
| `--max-results N` | Number of results (1-10, default 5). Keep low for speed. |
| `--ranking-mode MODE` | `embedding` (fast, default) or `rerank` (slower, more precise) |
| `--include-answer` | AI summary. Adds latency. Only when user asks for summary. |
| `--speaker NAME` | Filter by channel/speaker name (see note below) |
| `--published-after DATE` | YYYY-MM-DD |
| `--source SOURCE` | e.g. `youtube` |
| `--agent` | **Always use this.** Compact markdown output optimized for agents. |

### Important: speaker filter

The `speaker` field often contains the **channel name** (e.g. "Sequoia Capital", "a16z", "Lex Fridman") rather than the interviewee name. If a speaker filter returns no results, retry without it and include the person's name in the query instead.

## How to search effectively

**Search multiple times for complex questions.** Break broad questions into focused sub-queries.

Example — "Compare Sam Altman and Dario Amodei on AI safety":

```bash
cerul search "Sam Altman AI safety views" --agent
# → read transcript, note claims

cerul search "Dario Amodei AI safety approach" --agent
# → read transcript, find contrasts

cerul search "AGI safety debate scaling" --agent
# → deepen with cross-references

# → Synthesize with video citations and timestamps
```

**When to search again:**
- Transcript mentions a person or concept you haven't explored
- Question has multiple facets (compare X and Y = at least 2 searches)
- Initial results are weak — rephrase the query
- If you get "Failed to read response body" or a timeout error, wait 2 seconds and retry the same query once. This is usually a transient connection issue.

## Working rules

- **Always use `--agent`** for compact markdown output (not `--json`, which gets collapsed in agent UIs).
- **Always include video URLs** from results in your answer. Every quote needs a source link.
- **Read the `transcript` field**, not just `snippet`. Transcript has the full context.
- **Do not guess what someone said.** Search for it.
- **Keep searches fast:** max-results 5, embedding mode, no --include-answer unless asked.
- **Make multiple small searches** rather than one large one.
- Ground all claims in returned evidence. Do not hallucinate.
- Match the user's language, but keep queries in English.
- **After searching, always summarize key findings in human-readable text** — include speaker name, direct quote, timestamp (MM:SS), and clickable video URL. Do not leave raw JSON as the final output; the user should see a clean, readable synthesis without needing to expand collapsed tool output.

## JSON response format

Each result in the `results` array contains:

| Field | Description |
|-------|-------------|
| `url` | Video link — **always cite this** |
| `title` | Video title |
| `transcript` | Full speech text — **read this** |
| `snippet` | Short preview |
| `speaker` | Channel/speaker name |
| `timestamp_start` / `timestamp_end` | Seconds — format as MM:SS |
| `score` | Relevance 0.0-1.0 |

## See also

- [CLI repo](https://github.com/cerul-ai/cerul-cli) — install, config, upgrade
- [Python SDK](https://pypi.org/project/cerul/) — `pip install cerul`
- [TypeScript SDK](https://www.npmjs.com/package/cerul) — `npm install cerul`
- [Docs](https://cerul.ai/docs) — full API reference
