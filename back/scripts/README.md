# DOTCADE demo recording

These scripts keep recorded media under the ignored `artifacts/` directory. Start the backend and frontend before recording.

```sh
# Terminal 1
npm --prefix back run dev

# Terminal 2
npm --prefix front run dev -- --host 127.0.0.1

# Record the office feature segments used by the story edit.
DOTCADE_URL=http://127.0.0.1:5173/ \
DOTCADE_RECORD=1 DOTCADE_INTEGRATION_READY=1 \
node back/scripts/record_feature_tour.mjs

# Record one continuous meeting -> HITL pause/reload/resume -> game -> 20-agent feedback run.
DOTCADE_URL=http://127.0.0.1:5173/ \
node back/scripts/record_sim_complete.mjs

# Assemble the Korean studio story. Override tool paths on non-Homebrew systems.
FFMPEG_BIN=ffmpeg FFPROBE_BIN=ffprobe RSVG_BIN=rsvg-convert \
node back/scripts/assemble_feature_highlights_v2.mjs
```

The continuous recorder drives the real meeting UI to submit team-lead guidance, pause on a durable checkpoint, reload the page, verify the same five-agent context and cursor, and resume from a higher revision. It only succeeds after that HITL proof plus all 20 reports, the summary, and the persisted game-pack feedback are present. Use `DOTCADE_HITL_GUIDANCE` to override the recorded instruction. Use `DOTCADE_RECORD_NAME` while recording and the same `DOTCADE_FULL_RUN_NAME` while assembling to keep multiple takes.
