# Claude Code Log Converter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable claude-trace HTML viewer to display Claude Code native session logs from `~/.claude/projects/*.jsonl`

**Architecture:** Create a converter that transforms Claude Code's message-based log format into claude-trace's request/response pair format, then leverage the existing HTML generator unchanged.

**Tech Stack:** TypeScript, Node.js, existing claude-trace infrastructure (HTMLGenerator, SharedConversationProcessor)

---

## Format Analysis Summary

### Claude Code Native Format

```jsonl
{"type":"file-history-snapshot", "messageId":"...", "snapshot":{...}}
{"type":"user", "uuid":"abc", "parentUuid":null, "message":{role:"user",content:"..."}, "sessionId":"...", "cwd":"...", "gitBranch":"...", "timestamp":"..."}
{"type":"assistant", "uuid":"def", "parentUuid":"abc", "message":{model:"...",id:"msg_...",content:[...],usage:{...}}, "requestId":"req_...", "timestamp":"..."}
```

### claude-trace Format

```jsonl
{"request":{timestamp:123,method:"POST",url:"...",headers:{...},body:{model:"...",messages:[...]}}, "response":{timestamp:124,status_code:200,headers:{...},body:{...}}, "logged_at":"..."}
```

### Key Differences

1. **Structure**: Messages vs Request/Response pairs
2. **Linking**: `parentUuid` vs sequential pairing
3. **Metadata**: Session context vs HTTP context
4. **Assistant format**: Already in API response format ✓
5. **User format**: Needs API request reconstruction

---

## Task 1: Create Claude Code Log Converter Module

**Files:**

- Create: `src/claude-code-log-converter.ts`
- Test: `src/claude-code-log-converter.test.ts` (optional for now)

**Step 1: Define Claude Code log entry types**

Create TypeScript interfaces for Claude Code log format:

```typescript
// src/claude-code-log-converter.ts
import { RawPair } from "./types";

/**
 * Claude Code native log entry types
 */
export interface ClaudeCodeBaseEntry {
	uuid: string;
	timestamp: string;
	parentUuid: string | null;
	sessionId: string;
	cwd?: string;
	gitBranch?: string;
	version?: string;
	isSidechain?: boolean;
	userType?: string;
}

export interface ClaudeCodeUserEntry extends ClaudeCodeBaseEntry {
	type: "user";
	message: {
		role: "user";
		content: string | any[];
	};
}

export interface ClaudeCodeAssistantEntry extends ClaudeCodeBaseEntry {
	type: "assistant";
	message: {
		model: string;
		id: string;
		type: "message";
		role: "assistant";
		content: any[];
		stop_reason: string | null;
		stop_sequence: string | null;
		usage: {
			input_tokens: number;
			cache_creation_input_tokens?: number;
			cache_read_input_tokens?: number;
			cache_creation?: {
				ephemeral_5m_input_tokens: number;
				ephemeral_1h_input_tokens: number;
			};
			output_tokens: number;
			service_tier?: string;
		};
	};
	requestId: string;
}

export interface ClaudeCodeSystemEntry extends ClaudeCodeBaseEntry {
	type: "system";
	message: any;
}

export interface ClaudeCodeFileSnapshotEntry {
	type: "file-history-snapshot";
	messageId: string;
	snapshot: any;
	isSnapshotUpdate: boolean;
}

export type ClaudeCodeLogEntry =
	| ClaudeCodeUserEntry
	| ClaudeCodeAssistantEntry
	| ClaudeCodeSystemEntry
	| ClaudeCodeFileSnapshotEntry;
```

**Step 2: Create converter class skeleton**

```typescript
export class ClaudeCodeLogConverter {
	private entries: ClaudeCodeLogEntry[] = [];
	private userEntries: ClaudeCodeUserEntry[] = [];
	private assistantEntries: ClaudeCodeAssistantEntry[] = [];

	/**
	 * Convert Claude Code JSONL log to claude-trace RawPair format
	 */
	public convertToRawPairs(jsonlContent: string): RawPair[] {
		this.parseEntries(jsonlContent);
		this.filterRelevantEntries();
		return this.buildRawPairs();
	}

	private parseEntries(jsonlContent: string): void {
		// TODO: Parse JSONL line by line
	}

	private filterRelevantEntries(): void {
		// TODO: Filter to user and assistant entries only
	}

	private buildRawPairs(): RawPair[] {
		// TODO: Pair user messages with assistant responses
		return [];
	}
}
```

**Step 3: Implement JSONL parsing**

```typescript
private parseEntries(jsonlContent: string): void {
    const lines = jsonlContent
        .trim()
        .split('\n')
        .filter(line => line.trim());

    for (const line of lines) {
        try {
            const entry = JSON.parse(line) as ClaudeCodeLogEntry;
            this.entries.push(entry);
        } catch (error) {
            console.warn(`Failed to parse JSONL line: ${error}`);
            // Skip malformed lines
        }
    }
}
```

**Step 4: Implement entry filtering**

```typescript
private filterRelevantEntries(): void {
    for (const entry of this.entries) {
        if (entry.type === 'user') {
            this.userEntries.push(entry as ClaudeCodeUserEntry);
        } else if (entry.type === 'assistant') {
            this.assistantEntries.push(entry as ClaudeCodeAssistantEntry);
        }
        // Skip 'file-history-snapshot' and 'system' entries
    }
}
```

**Step 5: Implement message pairing logic**

```typescript
private buildRawPairs(): RawPair[] {
    const pairs: RawPair[] = [];

    // Build a map of assistant responses by their parentUuid
    const assistantByParent = new Map<string, ClaudeCodeAssistantEntry>();
    for (const assistant of this.assistantEntries) {
        if (assistant.parentUuid) {
            assistantByParent.set(assistant.parentUuid, assistant);
        }
    }

    // Match each user message with its assistant response
    for (const user of this.userEntries) {
        const assistant = assistantByParent.get(user.uuid);

        if (assistant) {
            const pair = this.createRawPair(user, assistant);
            pairs.push(pair);
        } else {
            // Orphaned user message (no response yet)
            const pair = this.createOrphanedPair(user);
            pairs.push(pair);
        }
    }

    // Sort by timestamp
    return pairs.sort((a, b) => a.request.timestamp - b.request.timestamp);
}
```

**Step 6: Implement request reconstruction**

```typescript
private createRawPair(
    user: ClaudeCodeUserEntry,
    assistant: ClaudeCodeAssistantEntry
): RawPair {
    // Reconstruct API request format from user entry
    const request = {
        timestamp: new Date(user.timestamp).getTime() / 1000,
        method: "POST",
        url: "https://api.anthropic.com/v1/messages",
        headers: {
            "content-type": "application/json",
            "anthropic-version": "2023-06-01",
            // We don't have the original headers, use reasonable defaults
        },
        body: {
            model: assistant.message.model, // Get model from response
            max_tokens: 8192, // Default, actual value unknown
            messages: [
                {
                    role: user.message.role,
                    content: user.message.content
                }
            ]
            // Note: We're missing system prompt and full message history
            // The SharedConversationProcessor will handle building full conversations
        }
    };

    // Extract response format (already in correct format!)
    const response = {
        timestamp: new Date(assistant.timestamp).getTime() / 1000,
        status_code: 200,
        headers: {
            "content-type": "application/json",
            "request-id": assistant.requestId
        },
        body: assistant.message
    };

    return {
        request,
        response,
        logged_at: assistant.timestamp
    };
}
```

**Step 7: Handle orphaned messages**

```typescript
private createOrphanedPair(user: ClaudeCodeUserEntry): RawPair {
    const request = {
        timestamp: new Date(user.timestamp).getTime() / 1000,
        method: "POST",
        url: "https://api.anthropic.com/v1/messages",
        headers: {
            "content-type": "application/json",
        },
        body: {
            model: "unknown",
            messages: [
                {
                    role: user.message.role,
                    content: user.message.content
                }
            ]
        }
    };

    return {
        request,
        response: null,
        logged_at: user.timestamp,
        note: "Orphaned request (no response recorded)"
    };
}
```

---

## Task 2: Integrate with CLI

**Files:**

- Modify: `src/cli.ts`

**Step 1: Add new CLI flag for Claude Code logs**

In the help text section (around line 30), add:

```typescript
  --from-claude-code     Convert Claude Code native log to HTML
```

In the examples section (around line 61), add:

```typescript
  # Generate HTML from Claude Code session log
  claude-trace --from-claude-code --generate-html ~/.claude/projects/SESSION_ID.jsonl
```

**Step 2: Add flag parsing logic**

Around line 472 (where other flags are parsed), add:

```typescript
// Check for from-claude-code flag
const fromClaudeCode = claudeTraceArgs.includes("--from-claude-code");
```

**Step 3: Modify HTML generation flow**

In the `generateHTMLFromCLI` function (line 411), add conversion logic:

```typescript
async function generateHTMLFromCLI(
	inputFile: string,
	outputFile?: string,
	includeAllRequests: boolean = false,
	openInBrowser: boolean = false,
	fromClaudeCode: boolean = false, // NEW PARAMETER
): Promise<void> {
	try {
		let finalInputFile = inputFile;

		// NEW: Convert Claude Code log to claude-trace format if needed
		if (fromClaudeCode) {
			log(`Converting Claude Code log format...`, "blue");
			const { ClaudeCodeLogConverter } = await import("./claude-code-log-converter");
			const converter = new ClaudeCodeLogConverter();

			// Read Claude Code JSONL
			const claudeCodeContent = fs.readFileSync(inputFile, "utf-8");

			// Convert to RawPair format
			const rawPairs = converter.convertToRawPairs(claudeCodeContent);

			// Write to temporary claude-trace format file
			const tempFile = inputFile.replace(".jsonl", ".claude-trace-temp.jsonl");
			const jsonlContent = rawPairs.map((pair) => JSON.stringify(pair)).join("\n");
			fs.writeFileSync(tempFile, jsonlContent);

			finalInputFile = tempFile;
			log(`Converted ${rawPairs.length} message pairs`, "green");
		}

		const htmlGenerator = new HTMLGenerator();
		const finalOutputFile = await htmlGenerator.generateHTMLFromJSONL(finalInputFile, outputFile, includeAllRequests);

		// Clean up temp file
		if (fromClaudeCode && finalInputFile !== inputFile) {
			fs.unlinkSync(finalInputFile);
		}

		if (openInBrowser) {
			spawn("open", [finalOutputFile], { detached: true, stdio: "ignore" }).unref();
			log(`Opening ${finalOutputFile} in browser`, "green");
		}

		process.exit(0);
	} catch (error) {
		const err = error as Error;
		log(`Error: ${err.message}`, "red");
		process.exit(1);
	}
}
```

**Step 4: Pass flag to generateHTMLFromCLI**

Around line 519, update the function call:

```typescript
await generateHTMLFromCLI(inputFile, outputFile, includeAllRequests, openInBrowser, fromClaudeCode);
```

---

## Task 3: Handle Multi-Turn Conversations

**Challenge:** Claude Code logs individual messages but claude-trace expects the full conversation context in each request.

**Solution:** The current implementation creates pairs with single messages. The `SharedConversationProcessor` will merge them into full conversations when rendering.

**Files:**

- Modify: `src/claude-code-log-converter.ts`

**Step 1: Add conversation context reconstruction**

Add a new method to build full message history:

```typescript
private buildConversationHistory(user: ClaudeCodeUserEntry): any[] {
    const messages: any[] = [];
    let current: ClaudeCodeLogEntry | undefined = user;

    // Walk backwards through parentUuid chain to build context
    while (current && 'parentUuid' in current && current.parentUuid) {
        const parent = this.entries.find(e =>
            'uuid' in e && e.uuid === current!.parentUuid
        );

        if (!parent) break;

        if (parent.type === 'user' || parent.type === 'assistant') {
            // Prepend to messages array (we're walking backwards)
            messages.unshift({
                role: parent.type === 'user' ? 'user' : 'assistant',
                content: parent.message.content || parent.message.role
            });
        }

        current = parent;
    }

    // Add the current message
    messages.push({
        role: user.message.role,
        content: user.message.content
    });

    return messages;
}
```

**Step 2: Update createRawPair to use full history**

Modify the `createRawPair` method:

```typescript
private createRawPair(
    user: ClaudeCodeUserEntry,
    assistant: ClaudeCodeAssistantEntry
): RawPair {
    const request = {
        timestamp: new Date(user.timestamp).getTime() / 1000,
        method: "POST",
        url: "https://api.anthropic.com/v1/messages",
        headers: {
            "content-type": "application/json",
            "anthropic-version": "2023-06-01",
        },
        body: {
            model: assistant.message.model,
            max_tokens: 8192,
            messages: this.buildConversationHistory(user) // CHANGED: Full history
        }
    };

    const response = {
        timestamp: new Date(assistant.timestamp).getTime() / 1000,
        status_code: 200,
        headers: {
            "content-type": "application/json",
            "request-id": assistant.requestId
        },
        body: assistant.message
    };

    return {
        request,
        response,
        logged_at: assistant.timestamp
    };
}
```

---

## Task 4: Add System Prompt Extraction

**Files:**

- Modify: `src/claude-code-log-converter.ts`

**Step 1: Extract system prompt from session-start messages**

Claude Code logs often contain system prompts in the first user message or via hooks. Add extraction logic:

```typescript
private extractSystemPrompt(messages: any[]): string | undefined {
    // Look for session-start-hook or other system content in first message
    if (messages.length > 0 && messages[0].role === 'user') {
        const content = messages[0].content;

        if (typeof content === 'string') {
            // Check for session-start-hook marker
            const match = content.match(/<session-start-hook>([\s\S]*?)<\/session-start-hook>/);
            if (match && match[1]) {
                return match[1].trim();
            }
        }
    }

    return undefined;
}
```

**Step 2: Add system field to request body**

Update `createRawPair`:

```typescript
const messages = this.buildConversationHistory(user);
const system = this.extractSystemPrompt(messages);

const request = {
	timestamp: new Date(user.timestamp).getTime() / 1000,
	method: "POST",
	url: "https://api.anthropic.com/v1/messages",
	headers: {
		"content-type": "application/json",
		"anthropic-version": "2023-06-01",
	},
	body: {
		model: assistant.message.model,
		max_tokens: 8192,
		messages: messages,
		...(system ? { system } : {}), // Add system if present
	},
};
```

---

## Task 5: Testing and Validation

**Files:**

- Test: Manual testing with real Claude Code logs

**Step 1: Test with provided log file**

```bash
# Build the project
npm run build

# Convert and view Claude Code log
node dist/cli.js --from-claude-code --generate-html \
  /Users/colin/.claude/projects/-Users-colin-repos-promnesia/39a75743-1e72-40bb-abdc-fa2fedd36389.jsonl

# Check output HTML displays correctly
```

**Expected:** HTML viewer shows conversations with proper formatting, thinking blocks visible, tool use displayed correctly.

**Step 2: Compare with native claude-trace output**

```bash
# Generate HTML from both formats
node dist/cli.js --generate-html log-2025-10-07-06-06-01.jsonl native-output.html
node dist/cli.js --from-claude-code --generate-html ~/.claude/projects/SESSION.jsonl converted-output.html

# Verify both display similarly in browser
```

**Step 3: Test edge cases**

- Empty log files
- Logs with only user messages (no responses)
- Logs with file-history-snapshot entries
- Logs from different Claude Code versions

**Step 4: Commit**

```bash
git add src/claude-code-log-converter.ts src/cli.ts docs/plans/
git commit -m "add claude code log converter for html viewer"
```

---

## Task 6: Add Convenience Script

**Files:**

- Create: `scripts/view-claude-session.sh`

**Step 1: Create helper script**

```bash
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
    LOG_FILE="$HOME/.claude/projects/-Users-$(whoami)-*-${SESSION_ID}.jsonl"

    # Find matching file
    MATCHES=($(ls $LOG_FILE 2>/dev/null))

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
```

**Step 2: Make executable**

```bash
chmod +x scripts/view-claude-session.sh
```

**Step 3: Document usage**

Add to README.md:

````markdown
## Viewing Claude Code Sessions

claude-trace can now display native Claude Code session logs from `~/.claude/projects/`:

```bash
# By session ID
./scripts/view-claude-session.sh 39a75743-1e72-40bb-abdc-fa2fedd36389

# By full path
claude-trace --from-claude-code --generate-html ~/.claude/projects/SESSION.jsonl
```
````

**Step 4: Commit**

```bash
git add scripts/view-claude-session.sh README.md
git commit -m "add convenience script for viewing claude sessions"
```

---

## Known Limitations

1. **HTTP Metadata Loss**: Claude Code logs don't contain original HTTP headers, so we use reasonable defaults
2. **Single Message Context**: Each pair initially shows single message, but SharedConversationProcessor merges them into full conversations
3. **System Prompts**: May not perfectly extract all system context from hooks
4. **Timing**: Request/response timestamps approximate from message timestamps

## Future Enhancements

1. Better system prompt extraction from Claude Code hooks
2. Preserve session metadata (cwd, git branch) in HTML display
3. Support for streaming response visualization
4. Detect and merge split thinking blocks
5. Add `--watch` mode to auto-refresh when Claude Code session updates

---

## Verification Checklist

- [ ] Converter parses Claude Code JSONL without errors
- [ ] User/Assistant messages correctly paired via parentUuid
- [ ] File-history-snapshot entries are filtered out
- [ ] HTML viewer displays conversations with thinking blocks
- [ ] Tool use content is visible and properly formatted
- [ ] Multi-turn conversations show full context
- [ ] Orphaned messages (no response) are handled gracefully
- [ ] CLI flag `--from-claude-code` works as documented
- [ ] Convenience script finds and converts sessions by ID
- [ ] Large logs (289+ lines) process without memory issues
