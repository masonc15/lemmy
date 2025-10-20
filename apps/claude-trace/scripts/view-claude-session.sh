#!/bin/bash
# Quickly view any Claude Code session in HTML

if [ -z "$1" ]; then
    echo "Usage: $0 <session-id-or-path>"
    echo ""
    echo "Examples:"
    echo "  $0 39a75743-1e72-40bb-abdc-fa2fedd36389"
    echo "  $0 ~/.claude/projects/39a75743-1e72-40bb-abdc-fa2fedd36389.jsonl"
    exit 1
fi

# If argument is a session ID, construct full path
if [[ ! "$1" =~ \.jsonl$ ]]; then
    SESSION_ID="$1"

    # Find matching file in any project directory
    MATCHES=($(find "$HOME/.claude/projects" -name "${SESSION_ID}.jsonl" -type f 2>/dev/null))

    if [ ${#MATCHES[@]} -eq 0 ]; then
        echo "Error: No log file found for session ID: $SESSION_ID"
        exit 1
    elif [ ${#MATCHES[@]} -gt 1 ]; then
        echo "Error: Multiple log files found:"
        printf '  %s\n' "${MATCHES[@]}"
        exit 1
    fi

    LOG_FILE="${MATCHES[0]}"
else
    LOG_FILE="$1"
fi

# Convert and open
claude-trace --from-claude-code --generate-html "$LOG_FILE"
