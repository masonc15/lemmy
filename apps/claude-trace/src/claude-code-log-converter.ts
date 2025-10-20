// src/claude-code-log-converter.ts
import { RawPair } from "./types";

/**
 * Anthropic API content block types
 */
export interface TextContent {
	type: "text";
	text: string;
}

export interface ThinkingContent {
	type: "thinking";
	thinking: string;
}

export interface ToolUseContent {
	type: "tool_use";
	id: string;
	name: string;
	input: Record<string, unknown>;
}

export interface ToolResultContent {
	type: "tool_result";
	tool_use_id: string;
	content: string;
}

export type ContentBlock = TextContent | ThinkingContent | ToolUseContent | ToolResultContent;

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
		content: string | ContentBlock[];
	};
}

export interface ClaudeCodeAssistantEntry extends ClaudeCodeBaseEntry {
	type: "assistant";
	message: {
		model: string;
		id: string;
		type: "message";
		role: "assistant";
		content: ContentBlock[];
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
	message: unknown;
}

export interface ClaudeCodeFileSnapshotEntry {
	type: "file-history-snapshot";
	messageId: string;
	snapshot: unknown;
	isSnapshotUpdate: boolean;
}

export type ClaudeCodeLogEntry =
	| ClaudeCodeUserEntry
	| ClaudeCodeAssistantEntry
	| ClaudeCodeSystemEntry
	| ClaudeCodeFileSnapshotEntry;

export class ClaudeCodeLogConverter {
	private entries: ClaudeCodeLogEntry[] = [];
	private userEntries: ClaudeCodeUserEntry[] = [];
	private assistantEntries: ClaudeCodeAssistantEntry[] = [];

	/**
	 * Convert Claude Code JSONL log to claude-trace RawPair format
	 */
	public convertToRawPairs(jsonlContent: string): RawPair[] {
		// Reset state to prevent data leaking between calls
		this.entries = [];
		this.userEntries = [];
		this.assistantEntries = [];

		this.parseEntries(jsonlContent);
		this.filterRelevantEntries();
		return this.buildRawPairs();
	}

	private parseEntries(jsonlContent: string): void {
		const lines = jsonlContent
			.trim()
			.split("\n")
			.filter((line) => line.trim());

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

	private filterRelevantEntries(): void {
		for (const entry of this.entries) {
			if (entry.type === "user") {
				this.userEntries.push(entry as ClaudeCodeUserEntry);
			} else if (entry.type === "assistant") {
				this.assistantEntries.push(entry as ClaudeCodeAssistantEntry);
			}
			// Skip 'file-history-snapshot' and 'system' entries
		}
	}

	private buildRawPairs(): RawPair[] {
		const pairs: RawPair[] = [];

		// Build a map of all entries by uuid for O(1) lookup
		const entryByUuid = new Map<string, ClaudeCodeLogEntry>();
		for (const entry of this.entries) {
			if ("uuid" in entry) {
				entryByUuid.set(entry.uuid, entry);
			}
		}

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
				const pair = this.createRawPair(user, assistant, entryByUuid);
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

	private buildConversationHistory(
		user: ClaudeCodeUserEntry,
		entryByUuid: Map<string, ClaudeCodeLogEntry>,
	): Array<{ role: "user" | "assistant"; content: string | ContentBlock[] }> {
		const messages: Array<{ role: "user" | "assistant"; content: string | ContentBlock[] }> = [];
		let current: ClaudeCodeLogEntry | undefined = user;
		const visited = new Set<string>();

		// Walk backwards through parentUuid chain to build context
		while (current && "parentUuid" in current && current.parentUuid) {
			const parentUuid: string = current.parentUuid;

			// Detect cycles to prevent infinite loops
			if (visited.has(parentUuid)) {
				console.warn(`Cycle detected in parentUuid chain at ${parentUuid}`);
				break;
			}
			visited.add(parentUuid);

			const parent: ClaudeCodeLogEntry | undefined = entryByUuid.get(parentUuid);

			if (!parent) break;

			if (parent.type === "user" || parent.type === "assistant") {
				// Prepend to messages array (we're walking backwards)
				messages.unshift({
					role: parent.type === "user" ? "user" : "assistant",
					content: parent.message.content,
				});
			}

			current = parent;
		}

		// Add the current message
		messages.push({
			role: user.message.role,
			content: user.message.content,
		});

		return messages;
	}

	private extractSystemPrompt(
		messages: Array<{ role: "user" | "assistant"; content: string | ContentBlock[] }>,
	): string | undefined {
		// Look for session-start-hook or other system content in first message
		if (messages.length > 0) {
			const firstMessage = messages[0];
			if (firstMessage.role === "user") {
				const content = firstMessage.content;

				if (typeof content === "string") {
					// Check for session-start-hook marker
					const match = content.match(/<session-start-hook>([\s\S]*?)<\/session-start-hook>/);
					if (match && match[1]) {
						return match[1].trim();
					}
				}
			}
		}

		return undefined;
	}

	private createRawPair(
		user: ClaudeCodeUserEntry,
		assistant: ClaudeCodeAssistantEntry,
		entryByUuid: Map<string, ClaudeCodeLogEntry>,
	): RawPair {
		const messages = this.buildConversationHistory(user, entryByUuid);
		const system = this.extractSystemPrompt(messages);

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
				messages: messages,
				...(system ? { system } : {}), // Add system if present
				// Note: We're missing system prompt and full message history
				// The SharedConversationProcessor will handle building full conversations
			},
		};

		// Extract response format (already in correct format!)
		const response = {
			timestamp: new Date(assistant.timestamp).getTime() / 1000,
			status_code: 200,
			headers: {
				"content-type": "application/json",
				"request-id": assistant.requestId,
			},
			body: assistant.message,
		};

		return {
			request,
			response,
			logged_at: assistant.timestamp,
		};
	}

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
						content: user.message.content,
					},
				],
			},
		};

		return {
			request,
			response: null,
			logged_at: user.timestamp,
			note: "Orphaned request (no response recorded)",
		};
	}
}
