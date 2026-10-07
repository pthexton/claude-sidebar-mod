#!/bin/bash
# statusLine command for sessions running the sidebar mod.
#
# Claude Code hands the status line facts mods can't read (fast_mode, the
# prompt cache's real TTL, expiry and recache size, added dirs). This saves
# that JSON per session, where the mod reads it, and prints nothing, so no
# status line is drawn under the prompt.
#
#   ~/.claude/state/statusline/<session_id>.json   (written atomically)

FEED_DIR="$HOME/.claude/state/statusline"

input=$(cat)
sid=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
[ -z "$sid" ] && exit 0
case "$sid" in */*|.*) exit 0 ;; esac

mkdir -p "$FEED_DIR"
printf '%s' "$input" > "$FEED_DIR/$sid.json.tmp" && mv "$FEED_DIR/$sid.json.tmp" "$FEED_DIR/$sid.json"

# Ended sessions leave their file behind; drop week-old ones now and then.
if [ $((RANDOM % 50)) -eq 0 ]; then
  find "$FEED_DIR" -name '*.json' -mtime +7 -delete 2>/dev/null
fi

exit 0
