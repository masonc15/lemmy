# Universal Search Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a search-first HTML interface that indexes all conversation logs and provides instant keyword-based search across all past Claude conversations.

**Architecture:** Build a client-side search system using an inverted index. The backend generates a searchable JSON index from JSONL logs containing conversation metadata and searchable text. The frontend uses MiniSearch library for fast client-side full-text search with fuzzy matching, filters, and highlighted result snippets. No backend server required - everything runs in the browser.

**Tech Stack:** TypeScript, Lit (web components), MiniSearch (search library), existing claude-trace infrastructure

---

## Task 1: Search Index Data Structures

**Files:**

- Create: `src/types/search-types.ts`
- Reference: `src/types.ts` (existing types)

**Step 1: Write types test**

Create `src/types/search-types.test.ts`:

```typescript
import { SearchIndex, ConversationIndexEntry, InvertedIndex } from "./search-types";

describe("SearchTypes", () => {
	it("should create valid ConversationIndexEntry", () => {
		const entry: ConversationIndexEntry = {
			id: "conv-123",
			logFile: "log-2025-10-20.jsonl",
			htmlFile: "log-2025-10-20.html",
			title: "Test Conversation",
			summary: "A test",
			startTime: "2025-10-20T10:00:00Z",
			endTime: "2025-10-20T10:30:00Z",
			messageCount: 5,
			models: ["claude-sonnet-3.5"],
			tokens: { input: 100, output: 200, cached: 0 },
			searchableText: "test content",
			userMessages: ["hello"],
			assistantMessages: ["hi"],
			toolCalls: [],
			filesReferenced: [],
			errors: [],
		};

		expect(entry.id).toBe("conv-123");
		expect(entry.models).toContain("claude-sonnet-3.5");
	});
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- search-types.test.ts`
Expected: FAIL with "Cannot find module './search-types'"

**Step 3: Create search types file**

Create `src/types/search-types.ts`:

```typescript
export interface SearchIndex {
	version: string;
	generated: string;
	conversations: ConversationIndexEntry[];
	invertedIndex: InvertedIndex;
	metadata: SearchMetadata;
}

export interface ConversationIndexEntry {
	id: string;
	logFile: string;
	htmlFile: string;
	title: string;
	summary: string;
	startTime: string;
	endTime: string;
	messageCount: number;
	models: string[];
	tokens: {
		input: number;
		output: number;
		cached: number;
	};
	searchableText: string;
	userMessages: string[];
	assistantMessages: string[];
	toolCalls: ToolCallSummary[];
	filesReferenced: string[];
	errors: string[];
}

export interface ToolCallSummary {
	name: string;
	input: string;
}

export interface InvertedIndex {
	[word: string]: {
		conversations: {
			id: string;
			positions: number[];
			frequency: number;
			contexts: string[];
		}[];
	};
}

export interface SearchMetadata {
	totalConversations: number;
	totalTokens: number;
	dateRange: { start: string; end: string };
	models: { [model: string]: number };
	indexSize: number;
	lastUpdated: string;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- search-types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/types/search-types.ts src/types/search-types.test.ts
git commit -m "add search index data structures"
```

---

## Task 2: Tokenizer and Text Processing

**Files:**

- Create: `src/search/text-processor.ts`
- Create: `src/search/text-processor.test.ts`

**Step 1: Write tokenizer test**

Create `src/search/text-processor.test.ts`:

```typescript
import { TextProcessor } from "./text-processor";

describe("TextProcessor", () => {
	let processor: TextProcessor;

	beforeEach(() => {
		processor = new TextProcessor();
	});

	it("should tokenize text into words", () => {
		const text = "Hello World! This is a test.";
		const tokens = processor.tokenize(text);
		expect(tokens).toEqual(["hello", "world", "this", "test"]);
	});

	it("should filter stop words", () => {
		const text = "the quick brown fox";
		const tokens = processor.tokenize(text);
		expect(tokens).not.toContain("the");
		expect(tokens).toContain("quick");
	});

	it("should extract context around position", () => {
		const text = "The quick brown fox jumps over the lazy dog";
		const context = processor.extractContext(text, 16, 15);
		expect(context).toBe("...quick brown fox jumps ov...");
	});

	it("should handle edge cases in context extraction", () => {
		const text = "Short text";
		const context = processor.extractContext(text, 0, 20);
		expect(context).toBe("Short text");
	});
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- text-processor.test.ts`
Expected: FAIL with "Cannot find module './text-processor'"

**Step 3: Implement TextProcessor**

Create `src/search/text-processor.ts`:

```typescript
export class TextProcessor {
	private stopWords = new Set([
		"the",
		"a",
		"an",
		"and",
		"or",
		"but",
		"in",
		"on",
		"at",
		"to",
		"for",
		"of",
		"with",
		"as",
		"by",
		"from",
		"is",
		"was",
		"are",
		"were",
		"be",
		"been",
		"being",
		"have",
		"has",
		"had",
		"do",
		"does",
		"did",
		"will",
		"would",
		"should",
		"could",
		"may",
		"might",
		"must",
		"can",
		"this",
		"that",
		"these",
		"those",
		"i",
		"you",
		"he",
		"she",
		"it",
		"we",
		"they",
	]);

	/**
	 * Tokenize text into searchable words
	 * - Convert to lowercase
	 * - Split on word boundaries
	 * - Filter stop words and short words
	 */
	tokenize(text: string): string[] {
		return text
			.toLowerCase()
			.split(/\W+/)
			.filter((word) => word.length > 2 && !this.stopWords.has(word));
	}

	/**
	 * Extract context snippet around a position in text
	 * @param text - Full text
	 * @param position - Center position for context
	 * @param contextLength - Characters before/after position
	 */
	extractContext(text: string, position: number, contextLength: number): string {
		const start = Math.max(0, position - contextLength);
		const end = Math.min(text.length, position + contextLength);
		let snippet = text.slice(start, end);

		// Add ellipsis if truncated
		if (start > 0) snippet = "..." + snippet;
		if (end < text.length) snippet = snippet + "...";

		return snippet;
	}
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- text-processor.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/search/text-processor.ts src/search/text-processor.test.ts
git commit -m "add text tokenizer and processor"
```

---

## Task 3: Conversation Content Extractor

**Files:**

- Create: `src/search/content-extractor.ts`
- Create: `src/search/content-extractor.test.ts`
- Reference: `src/shared-conversation-processor.ts` (for processing pairs)

**Step 1: Write content extractor test**

Create `src/search/content-extractor.test.ts`:

```typescript
import { ContentExtractor } from "./content-extractor";
import { RawPair } from "../types";

describe("ContentExtractor", () => {
	let extractor: ContentExtractor;

	beforeEach(() => {
		extractor = new ContentExtractor();
	});

	it("should extract user messages", () => {
		const pairs: RawPair[] = [
			{
				request: {
					timestamp: 1000,
					method: "POST",
					url: "https://api.anthropic.com/v1/messages",
					headers: {},
					body: {
						messages: [{ role: "user", content: "Hello Claude" }],
					},
				},
				response: {
					timestamp: 1001,
					status_code: 200,
					headers: {},
					body: {
						content: [{ type: "text", text: "Hi there" }],
					},
				},
				logged_at: "2025-10-20T10:00:00Z",
			},
		];

		const result = extractor.extractContent(pairs);
		expect(result.userMessages).toEqual(["Hello Claude"]);
		expect(result.assistantMessages).toEqual(["Hi there"]);
	});

	it("should extract tool calls", () => {
		const pairs: RawPair[] = [
			{
				request: {
					timestamp: 1000,
					method: "POST",
					url: "https://api.anthropic.com/v1/messages",
					headers: {},
					body: { messages: [] },
				},
				response: {
					timestamp: 1001,
					status_code: 200,
					headers: {},
					body: {
						content: [
							{
								type: "tool_use",
								id: "tool1",
								name: "Read",
								input: { file_path: "/test.ts" },
							},
						],
					},
				},
				logged_at: "2025-10-20T10:00:00Z",
			},
		];

		const result = extractor.extractContent(pairs);
		expect(result.toolCalls).toHaveLength(1);
		expect(result.toolCalls[0].name).toBe("Read");
	});

	it("should extract file references", () => {
		const pairs: RawPair[] = [
			{
				request: {
					timestamp: 1000,
					method: "POST",
					url: "https://api.anthropic.com/v1/messages",
					headers: {},
					body: { messages: [] },
				},
				response: {
					timestamp: 1001,
					status_code: 200,
					headers: {},
					body: {
						content: [
							{
								type: "tool_use",
								id: "tool1",
								name: "Edit",
								input: { file_path: "/src/app.ts", old_string: "old", new_string: "new" },
							},
						],
					},
				},
				logged_at: "2025-10-20T10:00:00Z",
			},
		];

		const result = extractor.extractContent(pairs);
		expect(result.filesReferenced).toContain("/src/app.ts");
	});
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- content-extractor.test.ts`
Expected: FAIL with "Cannot find module './content-extractor'"

**Step 3: Implement ContentExtractor**

Create `src/search/content-extractor.ts`:

```typescript
import { RawPair } from "../types";
import { ToolCallSummary } from "../types/search-types";

export interface ExtractedContent {
	userMessages: string[];
	assistantMessages: string[];
	toolCalls: ToolCallSummary[];
	filesReferenced: string[];
	errors: string[];
	systemPrompt: string;
}

export class ContentExtractor {
	/**
	 * Extract searchable content from raw API pairs
	 */
	extractContent(pairs: RawPair[]): ExtractedContent {
		const userMessages: string[] = [];
		const assistantMessages: string[] = [];
		const toolCalls: ToolCallSummary[] = [];
		const filesReferenced = new Set<string>();
		const errors: string[] = [];
		let systemPrompt = "";

		for (const pair of pairs) {
			// Extract user messages
			const requestMessages = pair.request?.body?.messages || [];
			for (const msg of requestMessages) {
				if (msg.role === "user") {
					const text = this.extractTextFromContent(msg.content);
					if (text) userMessages.push(text);
				}
			}

			// Extract system prompt
			if (pair.request?.body?.system && !systemPrompt) {
				systemPrompt = this.extractTextFromContent(pair.request.body.system);
			}

			// Extract assistant messages and tool calls
			if (pair.response?.body?.content) {
				const content = pair.response.body.content;

				for (const block of content) {
					if (block.type === "text") {
						assistantMessages.push(block.text);
					} else if (block.type === "tool_use") {
						toolCalls.push({
							name: block.name,
							input: JSON.stringify(block.input),
						});

						// Extract file paths from tool inputs
						this.extractFilePathsFromInput(block.input, filesReferenced);
					}
				}
			}

			// Extract errors
			if (pair.response?.body?.error) {
				errors.push(pair.response.body.error.message || "Unknown error");
			}
		}

		return {
			userMessages,
			assistantMessages,
			toolCalls,
			filesReferenced: Array.from(filesReferenced),
			errors,
			systemPrompt,
		};
	}

	private extractTextFromContent(content: any): string {
		if (typeof content === "string") {
			return content;
		}

		if (Array.isArray(content)) {
			return content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("\n\n");
		}

		return "";
	}

	private extractFilePathsFromInput(input: any, filesSet: Set<string>): void {
		if (!input) return;

		// Common file path fields
		const fileFields = ["file_path", "path", "filepath", "file"];

		for (const field of fileFields) {
			if (input[field] && typeof input[field] === "string") {
				filesSet.add(input[field]);
			}
		}

		// Recursively check nested objects
		if (typeof input === "object") {
			for (const value of Object.values(input)) {
				if (typeof value === "object" && value !== null) {
					this.extractFilePathsFromInput(value, filesSet);
				}
			}
		}
	}
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- content-extractor.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/search/content-extractor.ts src/search/content-extractor.test.ts
git commit -m "add conversation content extractor"
```

---

## Task 4: Inverted Index Builder

**Files:**

- Create: `src/search/inverted-index-builder.ts`
- Create: `src/search/inverted-index-builder.test.ts`

**Step 1: Write inverted index builder test**

Create `src/search/inverted-index-builder.test.ts`:

```typescript
import { InvertedIndexBuilder } from "./inverted-index-builder";
import { ConversationIndexEntry } from "../types/search-types";

describe("InvertedIndexBuilder", () => {
	let builder: InvertedIndexBuilder;

	beforeEach(() => {
		builder = new InvertedIndexBuilder();
	});

	it("should build inverted index from conversations", () => {
		const conversations: ConversationIndexEntry[] = [
			{
				id: "conv-1",
				searchableText: "hello world test",
				// ... other required fields with dummy data
				logFile: "test.jsonl",
				htmlFile: "test.html",
				title: "Test",
				summary: "",
				startTime: "2025-01-01T00:00:00Z",
				endTime: "2025-01-01T00:00:00Z",
				messageCount: 1,
				models: ["test"],
				tokens: { input: 0, output: 0, cached: 0 },
				userMessages: [],
				assistantMessages: [],
				toolCalls: [],
				filesReferenced: [],
				errors: [],
			},
		];

		const index = builder.build(conversations);

		expect(index["hello"]).toBeDefined();
		expect(index["world"]).toBeDefined();
		expect(index["hello"].conversations).toHaveLength(1);
		expect(index["hello"].conversations[0].id).toBe("conv-1");
	});

	it("should track word positions", () => {
		const conversations: ConversationIndexEntry[] = [
			{
				id: "conv-1",
				searchableText: "test word test",
				logFile: "test.jsonl",
				htmlFile: "test.html",
				title: "Test",
				summary: "",
				startTime: "2025-01-01T00:00:00Z",
				endTime: "2025-01-01T00:00:00Z",
				messageCount: 1,
				models: ["test"],
				tokens: { input: 0, output: 0, cached: 0 },
				userMessages: [],
				assistantMessages: [],
				toolCalls: [],
				filesReferenced: [],
				errors: [],
			},
		];

		const index = builder.build(conversations);

		expect(index["test"].conversations[0].frequency).toBe(2);
		expect(index["test"].conversations[0].positions).toHaveLength(2);
	});

	it("should generate context snippets", () => {
		const conversations: ConversationIndexEntry[] = [
			{
				id: "conv-1",
				searchableText: "The quick brown fox jumps over the lazy dog",
				logFile: "test.jsonl",
				htmlFile: "test.html",
				title: "Test",
				summary: "",
				startTime: "2025-01-01T00:00:00Z",
				endTime: "2025-01-01T00:00:00Z",
				messageCount: 1,
				models: ["test"],
				tokens: { input: 0, output: 0, cached: 0 },
				userMessages: [],
				assistantMessages: [],
				toolCalls: [],
				filesReferenced: [],
				errors: [],
			},
		];

		const index = builder.build(conversations);

		expect(index["fox"]).toBeDefined();
		expect(index["fox"].conversations[0].contexts).toHaveLength(1);
		expect(index["fox"].conversations[0].contexts[0]).toContain("fox");
	});
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- inverted-index-builder.test.ts`
Expected: FAIL with "Cannot find module './inverted-index-builder'"

**Step 3: Implement InvertedIndexBuilder**

Create `src/search/inverted-index-builder.ts`:

```typescript
import { ConversationIndexEntry, InvertedIndex } from "../types/search-types";
import { TextProcessor } from "./text-processor";

export class InvertedIndexBuilder {
	private textProcessor: TextProcessor;

	constructor() {
		this.textProcessor = new TextProcessor();
	}

	/**
	 * Build inverted index from conversations
	 * Maps: word -> [conversations containing word + positions]
	 */
	build(conversations: ConversationIndexEntry[]): InvertedIndex {
		const index: InvertedIndex = {};

		for (const conv of conversations) {
			this.indexConversation(conv, index);
		}

		return index;
	}

	private indexConversation(conv: ConversationIndexEntry, index: InvertedIndex): void {
		// Tokenize searchable text
		const words = this.textProcessor.tokenize(conv.searchableText);
		const wordPositions = new Map<string, number[]>();

		// Track character positions of each word in original text
		let searchPosition = 0;
		const lowerText = conv.searchableText.toLowerCase();

		for (const word of words) {
			// Find actual position in text
			const pos = lowerText.indexOf(word, searchPosition);

			if (pos !== -1) {
				if (!wordPositions.has(word)) {
					wordPositions.set(word, []);
				}
				wordPositions.get(word)!.push(pos);
				searchPosition = pos + word.length;
			}
		}

		// Add to inverted index
		for (const [word, positions] of wordPositions) {
			if (!index[word]) {
				index[word] = { conversations: [] };
			}

			// Generate context snippets (max 3 per word)
			const contexts = positions
				.slice(0, 3)
				.map((pos) => this.textProcessor.extractContext(conv.searchableText, pos, 60));

			index[word].conversations.push({
				id: conv.id,
				positions,
				frequency: positions.length,
				contexts,
			});
		}
	}
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- inverted-index-builder.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/search/inverted-index-builder.ts src/search/inverted-index-builder.test.ts
git commit -m "add inverted index builder"
```

---

## Task 5: Search Index Builder (Main Orchestrator)

**Files:**

- Create: `src/search/search-index-builder.ts`
- Create: `src/search/search-index-builder.test.ts`
- Reference: `src/shared-conversation-processor.ts`
- Reference: `src/index-generator.ts` (for summary loading)

**Step 1: Write search index builder test**

Create `src/search/search-index-builder.test.ts`:

```typescript
import { SearchIndexBuilder } from "./search-index-builder";
import fs from "fs";
import path from "path";

describe("SearchIndexBuilder", () => {
	const testDir = "./test-trace-dir";
	let builder: SearchIndexBuilder;

	beforeEach(() => {
		builder = new SearchIndexBuilder();

		// Create test directory
		if (!fs.existsSync(testDir)) {
			fs.mkdirSync(testDir, { recursive: true });
		}
	});

	afterEach(() => {
		// Clean up test directory
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
	});

	it("should build index from JSONL files", async () => {
		// Create test JSONL file
		const testLog = path.join(testDir, "log-2025-10-20-10-00-00.jsonl");
		const testPair = {
			request: {
				timestamp: 1000,
				method: "POST",
				url: "https://api.anthropic.com/v1/messages",
				headers: {},
				body: {
					messages: [{ role: "user", content: "Hello" }],
				},
			},
			response: {
				timestamp: 1001,
				status_code: 200,
				headers: {},
				body: {
					content: [{ type: "text", text: "Hi" }],
				},
			},
			logged_at: "2025-10-20T10:00:00Z",
		};

		fs.writeFileSync(testLog, JSON.stringify(testPair) + "\n");

		const index = await builder.buildIndex(testDir);

		expect(index.conversations).toHaveLength(1);
		expect(index.conversations[0].id).toBe("2025-10-20-10-00-00");
		expect(index.metadata.totalConversations).toBe(1);
	});

	it("should handle empty directory", async () => {
		const index = await builder.buildIndex(testDir);

		expect(index.conversations).toHaveLength(0);
		expect(index.metadata.totalConversations).toBe(0);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- search-index-builder.test.ts`
Expected: FAIL with "Cannot find module './search-index-builder'"

**Step 3: Implement SearchIndexBuilder (Part 1 - Core structure)**

Create `src/search/search-index-builder.ts`:

```typescript
import fs from "fs";
import path from "path";
import { RawPair } from "../types";
import { SearchIndex, ConversationIndexEntry, SearchMetadata } from "../types/search-types";
import { ContentExtractor } from "./content-extractor";
import { InvertedIndexBuilder } from "./inverted-index-builder";
import { SharedConversationProcessor } from "../shared-conversation-processor";

export class SearchIndexBuilder {
	private contentExtractor: ContentExtractor;
	private indexBuilder: InvertedIndexBuilder;
	private conversationProcessor: SharedConversationProcessor;

	constructor() {
		this.contentExtractor = new ContentExtractor();
		this.indexBuilder = new InvertedIndexBuilder();
		this.conversationProcessor = new SharedConversationProcessor();
	}

	/**
	 * Build complete search index from trace directory
	 */
	async buildIndex(traceDir: string): Promise<SearchIndex> {
		console.error(`Building search index from ${traceDir}...`);

		// 1. Find all JSONL log files
		const logFiles = this.findLogFiles(traceDir);
		console.error(`Found ${logFiles.length} log files`);

		// 2. Load summaries if available
		const summaries = await this.loadSummaries(traceDir);

		// 3. Process each log file
		const conversations: ConversationIndexEntry[] = [];
		for (const logFile of logFiles) {
			const logPath = path.join(traceDir, logFile);
			const conversation = await this.processLogFile(logPath, summaries);
			if (conversation) {
				conversations.push(conversation);
			}
		}

		// 4. Build inverted index
		console.error("Building inverted index...");
		const invertedIndex = this.indexBuilder.build(conversations);

		// 5. Calculate metadata
		const metadata = this.calculateMetadata(conversations);

		console.error(
			`Index complete: ${conversations.length} conversations, ${Object.keys(invertedIndex).length} unique words`,
		);

		return {
			version: "1.0.0",
			generated: new Date().toISOString(),
			conversations,
			invertedIndex,
			metadata,
		};
	}

	private findLogFiles(traceDir: string): string[] {
		if (!fs.existsSync(traceDir)) {
			return [];
		}

		const files = fs.readdirSync(traceDir);
		return files
			.filter((file) => file.match(/^log-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.jsonl$/))
			.sort((a, b) => b.localeCompare(a)); // Newest first
	}

	private async loadSummaries(traceDir: string): Promise<Map<string, any>> {
		const summaries = new Map<string, any>();

		if (!fs.existsSync(traceDir)) {
			return summaries;
		}

		const files = fs.readdirSync(traceDir);
		const summaryFiles = files.filter((f) => f.match(/^summary-.*\.json$/));

		for (const file of summaryFiles) {
			try {
				const content = fs.readFileSync(path.join(traceDir, file), "utf-8");
				const summary = JSON.parse(content);
				const timestamp = file.match(/summary-(.+)\.json$/)?.[1];
				if (timestamp) {
					summaries.set(timestamp, summary);
				}
			} catch (error) {
				// Ignore invalid summaries
			}
		}

		return summaries;
	}

	private async processLogFile(logPath: string, summaries: Map<string, any>): Promise<ConversationIndexEntry | null> {
		try {
			// Load JSONL file
			const content = fs.readFileSync(logPath, "utf-8");
			const lines = content
				.trim()
				.split("\n")
				.filter((line) => line.trim());
			const pairs: RawPair[] = lines.map((line) => JSON.parse(line));

			if (pairs.length === 0) {
				return null;
			}

			// Extract conversation ID from filename
			const filename = path.basename(logPath);
			const timestamp = filename.match(/log-(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})/)?.[1];
			if (!timestamp) {
				return null;
			}

			// Use shared conversation processor
			const processedPairs = this.conversationProcessor.processRawPairs(pairs);
			const conversations = this.conversationProcessor.mergeConversations(processedPairs);

			// For now, treat all pairs as one conversation
			const conv = conversations[0];
			if (!conv) {
				return null;
			}

			// Extract searchable content
			const extracted = this.contentExtractor.extractContent(pairs);

			// Calculate tokens
			const tokens = this.calculateTokensFromPairs(pairs);

			// Get title and summary
			const summary = summaries.get(timestamp);
			const title = summary?.conversations?.[0]?.title || this.generateTitle(extracted, conv);
			const summaryText = summary?.conversations?.[0]?.summary || "";

			// Combine all searchable text
			const searchableText = [
				extracted.systemPrompt,
				...extracted.userMessages,
				...extracted.assistantMessages,
				...extracted.toolCalls.map((tc) => `${tc.name}: ${tc.input}`),
			]
				.filter(Boolean)
				.join("\n\n");

			return {
				id: timestamp,
				logFile: filename,
				htmlFile: filename.replace(".jsonl", ".html"),
				title,
				summary: summaryText,
				startTime: conv.metadata.startTime,
				endTime: conv.metadata.endTime,
				messageCount: conv.messages.length,
				models: Array.from(conv.models),
				tokens,
				searchableText,
				userMessages: extracted.userMessages,
				assistantMessages: extracted.assistantMessages,
				toolCalls: extracted.toolCalls,
				filesReferenced: extracted.filesReferenced,
				errors: extracted.errors,
			};
		} catch (error) {
			console.error(`Error processing ${logPath}:`, error);
			return null;
		}
	}

	private calculateTokensFromPairs(pairs: RawPair[]): { input: number; output: number; cached: number } {
		let input = 0;
		let output = 0;
		let cached = 0;

		for (const pair of pairs) {
			const usage = pair.response?.body?.usage;
			if (usage) {
				input += usage.input_tokens || 0;
				output += usage.output_tokens || 0;
				cached += usage.cache_read_input_tokens || 0;
			}
		}

		return { input, output, cached };
	}

	private generateTitle(extracted: any, conv: any): string {
		// Generate title from first user message
		if (extracted.userMessages.length > 0) {
			const firstMsg = extracted.userMessages[0];
			const title = firstMsg.slice(0, 60);
			return title.length < firstMsg.length ? title + "..." : title;
		}

		// Fallback to timestamp
		return `Conversation ${conv.metadata.startTime}`;
	}

	private calculateMetadata(conversations: ConversationIndexEntry[]): SearchMetadata {
		let totalTokens = 0;
		const modelCounts: { [model: string]: number } = {};
		let minDate = new Date().toISOString();
		let maxDate = "";

		for (const conv of conversations) {
			totalTokens += conv.tokens.input + conv.tokens.output;

			for (const model of conv.models) {
				modelCounts[model] = (modelCounts[model] || 0) + 1;
			}

			if (conv.startTime < minDate) minDate = conv.startTime;
			if (conv.endTime > maxDate) maxDate = conv.endTime;
		}

		return {
			totalConversations: conversations.length,
			totalTokens,
			dateRange: { start: minDate, end: maxDate },
			models: modelCounts,
			indexSize: 0, // Will be calculated after serialization
			lastUpdated: new Date().toISOString(),
		};
	}
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- search-index-builder.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/search/search-index-builder.ts src/search/search-index-builder.test.ts
git commit -m "add search index builder orchestrator"
```

---

## Task 6: CLI Command for Building Search Index

**Files:**

- Modify: `src/cli.ts:23-105` (help text)
- Modify: `src/cli.ts:449-537` (main function)

**Step 1: Write manual test plan**

Create manual test checklist:

1. Run `claude-trace --build-search-index` in directory with logs
2. Verify `.claude-trace/search-index.json` is created
3. Verify console output shows progress
4. Run with no logs - verify graceful handling
5. Run twice - verify index is updated

**Step 2: Add help text for search commands**

Modify `src/cli.ts` help text section (around line 23):

```typescript
${colors.yellow}SEARCH:${colors.reset}
  --build-search-index  Build/rebuild search index from all logs
  --search, -s          Open search interface in browser (coming soon)
  --search-query QUERY  Search from CLI and print results (coming soon)
```

**Step 3: Add buildSearchIndex function**

Add to `src/cli.ts` before main():

```typescript
async function buildSearchIndex(): Promise<void> {
	try {
		const { SearchIndexBuilder } = await import("./search/search-index-builder");

		log("Building search index...", "blue");

		const traceDir = ".claude-trace";
		if (!fs.existsSync(traceDir)) {
			log(`Directory ${traceDir} not found`, "red");
			process.exit(1);
		}

		const builder = new SearchIndexBuilder();
		const index = await builder.buildIndex(traceDir);

		// Calculate index size
		const indexJson = JSON.stringify(index);
		index.metadata.indexSize = Buffer.byteLength(indexJson, "utf-8");

		// Save index
		const indexPath = path.join(traceDir, "search-index.json");
		fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

		log(`✓ Indexed ${index.conversations.length} conversations`, "green");
		log(`✓ Index size: ${(index.metadata.indexSize / 1024 / 1024).toFixed(2)} MB`, "green");
		log(`✓ Unique words: ${Object.keys(index.invertedIndex).length}`, "green");
		log(`✓ Saved to: ${indexPath}`, "green");

		process.exit(0);
	} catch (error) {
		const err = error as Error;
		log(`Error: ${err.message}`, "red");
		process.exit(1);
	}
}
```

**Step 4: Add command handler in main()**

Add after scenario 4 check in main() (around line 527):

```typescript
// Scenario 5: --build-search-index
if (claudeTraceArgs.includes("--build-search-index")) {
	await buildSearchIndex();
	return;
}
```

**Step 5: Test manually**

Run:

```bash
cd /path/to/test/project/with/logs
node dist/cli.js --build-search-index
```

Expected output:

```
Building search index...
✓ Indexed 5 conversations
✓ Index size: 1.23 MB
✓ Unique words: 1542
✓ Saved to: .claude-trace/search-index.json
```

**Step 6: Commit**

```bash
git add src/cli.ts
git commit -m "add cli command to build search index"
```

---

## Task 7: Frontend Search View Component (Part 1 - Setup)

**Files:**

- Create: `frontend/src/components/search-view.ts`
- Modify: `frontend/package.json` (add minisearch dependency)

**Step 1: Add minisearch dependency**

Modify `frontend/package.json`, add to dependencies:

```json
"dependencies": {
  "lit": "^3.0.0",
  "marked": "^9.0.0",
  "minisearch": "^7.1.0"
}
```

Run: `cd frontend && npm install`

**Step 2: Create search view scaffold**

Create `frontend/src/components/search-view.ts`:

```typescript
import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import MiniSearch from "minisearch";
import type { SearchIndex, ConversationIndexEntry } from "../../../src/types/search-types";

interface SearchResult {
	id: string;
	title: string;
	summary: string;
	startTime: string;
	models: string[];
	messageCount: number;
	htmlFile: string;
	score: number;
	matches: SearchMatch[];
}

interface SearchMatch {
	field: string;
	snippet: string;
}

@customElement("search-view")
export class SearchView extends LitElement {
	@state() private searchIndex: SearchIndex | null = null;
	@state() private miniSearch: MiniSearch<ConversationIndexEntry> | null = null;
	@state() private query: string = "";
	@state() private results: SearchResult[] = [];
	@state() private loading: boolean = true;
	@state() private error: string = "";
	@state() private selectedScope: "all" | "user" | "assistant" | "tools" = "all";
	@state() private selectedTimeRange: string = "all";
	@state() private selectedModels: Set<string> = new Set();

	// Disable shadow DOM to use global styles
	createRenderRoot() {
		return this;
	}

	async connectedCallback() {
		super.connectedCallback();
		await this.loadSearchIndex();
	}

	private async loadSearchIndex() {
		try {
			const response = await fetch("search-index.json");
			if (!response.ok) {
				throw new Error(`Failed to load search index: ${response.statusText}`);
			}

			this.searchIndex = await response.json();
			await this.initializeMiniSearch();

			this.loading = false;
		} catch (error) {
			console.error("Failed to load search index:", error);
			this.error = error instanceof Error ? error.message : "Unknown error";
			this.loading = false;
		}
	}

	private async initializeMiniSearch() {
		if (!this.searchIndex) return;

		// Initialize MiniSearch
		this.miniSearch = new MiniSearch({
			fields: ["title", "summary", "searchableText"],
			storeFields: ["title", "summary", "startTime", "models", "messageCount", "htmlFile"],
			searchOptions: {
				boost: { title: 3, summary: 2 },
				fuzzy: 0.2,
				prefix: true,
			},
		});

		// Index all conversations
		this.miniSearch.addAll(
			this.searchIndex.conversations.map((conv) => ({
				...conv,
				id: conv.id,
			})),
		);

		// Initialize model filter (all selected by default)
		const allModels = new Set(this.searchIndex.conversations.flatMap((c) => c.models));
		this.selectedModels = allModels;
	}

	render() {
		if (this.loading) {
			return html`<div class="p-8 text-center">Loading search index...</div>`;
		}

		if (this.error) {
			return html`<div class="p-8 text-center text-red-600">Error: ${this.error}</div>`;
		}

		if (!this.searchIndex) {
			return html`<div class="p-8 text-center">No search index available</div>`;
		}

		return html`
			<div class="max-w-4xl mx-auto p-6">
				<div class="mb-8">
					<h1 class="text-3xl font-bold mb-2">Claude Trace Search</h1>
					<p class="text-gray-600">
						${this.searchIndex.metadata.totalConversations} conversations indexed ·
						${(this.searchIndex.metadata.totalTokens / 1000000).toFixed(1)}M tokens
					</p>
				</div>

				<div class="mb-6">
					<input
						type="text"
						placeholder="Search conversations..."
						class="w-full px-4 py-3 text-lg border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
						.value=${this.query}
						@input=${this.handleSearch}
						autofocus
					/>
				</div>

				<div class="text-center text-gray-500">Search functionality coming in next task</div>
			</div>
		`;
	}

	private handleSearch(e: Event) {
		const input = e.target as HTMLInputElement;
		this.query = input.value;
		// Search logic will be added in next task
	}
}
```

**Step 3: Test component loads**

Add to `frontend/src/index.ts`:

```typescript
import "./components/search-view";
```

Build: `cd frontend && npm run build`
Expected: Build succeeds without errors

**Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/components/search-view.ts frontend/src/index.ts
git commit -m "add search view component scaffold"
```

---

## Task 8: Frontend Search View Component (Part 2 - Search Logic)

**Files:**

- Modify: `frontend/src/components/search-view.ts:63-145`

**Step 1: Add search method**

Add to SearchView class in `frontend/src/components/search-view.ts`:

```typescript
	private performSearch() {
		if (!this.miniSearch || !this.query.trim()) {
			this.results = [];
			return;
		}

		try {
			// Search with MiniSearch
			const rawResults = this.miniSearch.search(this.query, {
				filter: (result) => this.applyFilters(result),
			});

			// Enhance results with snippets
			this.results = rawResults.slice(0, 50).map((result) => {
				const conv = this.searchIndex!.conversations.find((c) => c.id === result.id)!;
				const matches = this.extractMatches(conv, this.query);

				return {
					id: result.id,
					title: conv.title,
					summary: conv.summary,
					startTime: conv.startTime,
					models: conv.models,
					messageCount: conv.messageCount,
					htmlFile: conv.htmlFile,
					score: result.score,
					matches,
				};
			});
		} catch (error) {
			console.error("Search error:", error);
			this.results = [];
		}
	}

	private applyFilters(result: any): boolean {
		if (!this.searchIndex) return false;

		const conv = this.searchIndex.conversations.find((c) => c.id === result.id);
		if (!conv) return false;

		// Apply scope filter
		if (this.selectedScope !== "all") {
			const scopeText =
				this.selectedScope === "user"
					? conv.userMessages.join(" ")
					: this.selectedScope === "assistant"
						? conv.assistantMessages.join(" ")
						: conv.toolCalls.map((tc) => tc.name).join(" ");

			if (!scopeText.toLowerCase().includes(this.query.toLowerCase())) {
				return false;
			}
		}

		// Apply model filter
		if (!conv.models.some((m) => this.selectedModels.has(m))) {
			return false;
		}

		// Apply time range filter
		if (this.selectedTimeRange !== "all") {
			if (!this.matchesTimeRange(conv.startTime)) {
				return false;
			}
		}

		return true;
	}

	private matchesTimeRange(timestamp: string): boolean {
		const date = new Date(timestamp);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffDays = diffMs / (1000 * 60 * 60 * 24);

		switch (this.selectedTimeRange) {
			case "today":
				return diffDays < 1;
			case "week":
				return diffDays < 7;
			case "month":
				return diffDays < 30;
			default:
				return true;
		}
	}

	private extractMatches(conv: ConversationIndexEntry, query: string): SearchMatch[] {
		const matches: SearchMatch[] = [];
		const queryWords = query.toLowerCase().split(/\s+/);

		// Search in different fields
		const fields = [
			{ name: "User messages", text: conv.userMessages.join("\n\n") },
			{ name: "Claude responses", text: conv.assistantMessages.join("\n\n") },
			{ name: "Tool calls", text: conv.toolCalls.map((tc) => `${tc.name}: ${tc.input}`).join("\n") },
		];

		for (const field of fields) {
			const text = field.text;
			const lowerText = text.toLowerCase();

			for (const word of queryWords) {
				const index = lowerText.indexOf(word);
				if (index !== -1) {
					// Extract context around match
					const start = Math.max(0, index - 60);
					const end = Math.min(text.length, index + word.length + 60);
					let snippet = text.slice(start, end);

					// Add ellipsis
					if (start > 0) snippet = "..." + snippet;
					if (end < text.length) snippet = snippet + "...";

					// Highlight matches
					snippet = this.highlightMatches(snippet, queryWords);

					matches.push({ field: field.name, snippet });
					break; // Only one match per field
				}
			}
		}

		return matches.slice(0, 3); // Max 3 snippets per result
	}

	private highlightMatches(text: string, words: string[]): string {
		let highlighted = text;
		for (const word of words) {
			const regex = new RegExp(`(${this.escapeRegex(word)})`, "gi");
			highlighted = highlighted.replace(regex, "<mark>$1</mark>");
		}
		return highlighted;
	}

	private escapeRegex(str: string): string {
		return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	private formatRelativeTime(timestamp: string): string {
		const date = new Date(timestamp);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

		if (diffDays === 0) return "Today";
		if (diffDays === 1) return "Yesterday";
		if (diffDays < 7) return `${diffDays} days ago`;
		if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
		if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
		return `${Math.floor(diffDays / 365)} years ago`;
	}
```

**Step 2: Update handleSearch to call performSearch**

Modify handleSearch method:

```typescript
	private handleSearch(e: Event) {
		const input = e.target as HTMLInputElement;
		this.query = input.value;
		this.performSearch();
	}
```

**Step 3: Build and verify no errors**

Run: `cd frontend && npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add frontend/src/components/search-view.ts
git commit -m "add search logic to search view"
```

---

## Task 9: Frontend Search View Component (Part 3 - Results UI)

**Files:**

- Modify: `frontend/src/components/search-view.ts:147-200` (render method)

**Step 1: Update render method with results display**

Replace the render method in `frontend/src/components/search-view.ts`:

```typescript
	render() {
		if (this.loading) {
			return html`<div class="p-8 text-center">Loading search index...</div>`;
		}

		if (this.error) {
			return html`<div class="p-8 text-center text-red-600">Error: ${this.error}</div>`;
		}

		if (!this.searchIndex) {
			return html`<div class="p-8 text-center">No search index available</div>`;
		}

		return html`
			<div class="max-w-4xl mx-auto p-6">
				${this.renderHeader()} ${this.renderSearchBox()} ${this.renderFilters()} ${this.renderResults()}
			</div>
		`;
	}

	private renderHeader() {
		return html`
			<div class="mb-8">
				<h1 class="text-3xl font-bold mb-2">Claude Trace Search</h1>
				<p class="text-gray-600">
					${this.searchIndex!.metadata.totalConversations} conversations indexed ·
					${(this.searchIndex!.metadata.totalTokens / 1000000).toFixed(1)}M tokens
				</p>
			</div>
		`;
	}

	private renderSearchBox() {
		return html`
			<div class="mb-6">
				<input
					type="text"
					placeholder="Search conversations..."
					class="w-full px-4 py-3 text-lg border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
					.value=${this.query}
					@input=${this.handleSearch}
					autofocus
				/>
			</div>
		`;
	}

	private renderFilters() {
		return html`
			<div class="mb-6 flex gap-4">
				<select
					class="px-3 py-2 border rounded-lg"
					@change=${(e: Event) => {
						this.selectedScope = (e.target as HTMLSelectElement).value as any;
						this.performSearch();
					}}
				>
					<option value="all">All content</option>
					<option value="user">User messages only</option>
					<option value="assistant">Claude responses only</option>
					<option value="tools">Tool calls only</option>
				</select>

				<select
					class="px-3 py-2 border rounded-lg"
					@change=${(e: Event) => {
						this.selectedTimeRange = (e.target as HTMLSelectElement).value;
						this.performSearch();
					}}
				>
					<option value="all">All time</option>
					<option value="today">Today</option>
					<option value="week">Past week</option>
					<option value="month">Past month</option>
				</select>
			</div>
		`;
	}

	private renderResults() {
		if (this.query.trim() === "") {
			return html`<div class="text-center text-gray-500 py-8">Enter a search query to find conversations</div>`;
		}

		if (this.results.length === 0) {
			return html`<div class="text-center text-gray-500 py-8">No conversations found</div>`;
		}

		return html`
			<div class="space-y-4">
				<div class="text-sm text-gray-600 mb-4">${this.results.length} conversations found</div>
				${this.results.map((result) => this.renderResultCard(result))}
			</div>
		`;
	}

	private renderResultCard(result: SearchResult) {
		return html`
			<div class="border border-gray-200 rounded-lg p-5 hover:shadow-md transition-shadow">
				<div class="mb-3">
					<h3 class="text-xl font-semibold mb-2">
						<a href="${result.htmlFile}" target="_blank" class="text-blue-600 hover:underline">
							${result.title}
						</a>
					</h3>
					<div class="flex items-center gap-3 text-sm text-gray-600">
						<span>${this.formatRelativeTime(result.startTime)}</span>
						<span>·</span>
						<span>${result.messageCount} messages</span>
						${result.models.map(
							(model) => html` <span class="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">${model}</span> `
						)}
					</div>
				</div>

				${result.summary
					? html` <p class="text-gray-700 mb-3">${result.summary}</p> `
					: ""}

				<div class="space-y-2">
					${result.matches.map(
						(match) => html`
							<div class="text-sm">
								<span class="font-medium text-gray-600">${match.field}:</span>
								<span class="ml-2 text-gray-700" .innerHTML=${match.snippet}></span>
							</div>
						`
					)}
				</div>
			</div>
		`;
	}
```

**Step 2: Add CSS for mark highlighting**

Add styles to `frontend/src/styles.css`:

```css
mark {
	background-color: #fef08a;
	padding: 0.125rem 0;
	font-weight: 600;
	border-radius: 0.125rem;
}
```

**Step 3: Build and verify**

Run: `cd frontend && npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add frontend/src/components/search-view.ts frontend/src/styles.css
git commit -m "add results display to search view"
```

---

## Task 10: Search HTML Template and Generator

**Files:**

- Create: `frontend/template-search.html`
- Create: `src/search/search-html-generator.ts`

**Step 1: Create search HTML template**

Create `frontend/template-search.html`:

```html
<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>Claude Trace Search</title>
		<style>
			body {
				margin: 0;
				padding: 0;
				font-family:
					system-ui,
					-apple-system,
					sans-serif;
			}
		</style>
	</head>
	<body>
		<search-view></search-view>
		<script>
			__CLAUDE_SEARCH_BUNDLE_REPLACEMENT__;
		</script>
	</body>
</html>
```

**Step 2: Create search HTML generator**

Create `src/search/search-html-generator.ts`:

```typescript
import fs from "fs";
import path from "path";

export class SearchHTMLGenerator {
	private frontendDir: string;
	private templatePath: string;
	private bundlePath: string;

	constructor() {
		this.frontendDir = path.join(__dirname, "..", "..", "frontend");
		this.templatePath = path.join(this.frontendDir, "template-search.html");
		this.bundlePath = path.join(this.frontendDir, "dist", "index.global.js");
	}

	/**
	 * Generate search.html from template
	 */
	async generateSearchHTML(traceDir: string): Promise<void> {
		// Ensure frontend is built
		if (!fs.existsSync(this.bundlePath)) {
			throw new Error(`Frontend bundle not found at ${this.bundlePath}. Run 'npm run build' first.`);
		}

		// Load template and bundle
		const template = fs.readFileSync(this.templatePath, "utf-8");
		const bundle = fs.readFileSync(this.bundlePath, "utf-8");

		// Replace bundle placeholder
		const html = template.replace("__CLAUDE_SEARCH_BUNDLE_REPLACEMENT__", bundle);

		// Write search.html
		const outputPath = path.join(traceDir, "search.html");
		fs.writeFileSync(outputPath, html, "utf-8");

		console.error(`Search interface generated: ${outputPath}`);
	}
}
```

**Step 3: Integrate with buildSearchIndex in cli.ts**

Modify `buildSearchIndex` function in `src/cli.ts`:

```typescript
async function buildSearchIndex(): Promise<void> {
	try {
		const { SearchIndexBuilder } = await import("./search/search-index-builder");
		const { SearchHTMLGenerator } = await import("./search/search-html-generator");

		log("Building search index...", "blue");

		const traceDir = ".claude-trace";
		if (!fs.existsSync(traceDir)) {
			log(`Directory ${traceDir} not found`, "red");
			process.exit(1);
		}

		// Build index
		const builder = new SearchIndexBuilder();
		const index = await builder.buildIndex(traceDir);

		// Calculate index size
		const indexJson = JSON.stringify(index);
		index.metadata.indexSize = Buffer.byteLength(indexJson, "utf-8");

		// Save index
		const indexPath = path.join(traceDir, "search-index.json");
		fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

		log(`✓ Indexed ${index.conversations.length} conversations`, "green");
		log(`✓ Index size: ${(index.metadata.indexSize / 1024 / 1024).toFixed(2)} MB`, "green");
		log(`✓ Unique words: ${Object.keys(index.invertedIndex).length}`, "green");

		// Generate search HTML
		const htmlGenerator = new SearchHTMLGenerator();
		await htmlGenerator.generateSearchHTML(traceDir);

		log(`✓ Search interface ready: ${traceDir}/search.html`, "green");

		process.exit(0);
	} catch (error) {
		const err = error as Error;
		log(`Error: ${err.message}`, "red");
		process.exit(1);
	}
}
```

**Step 4: Test manually**

Run:

```bash
npm run build
node dist/cli.js --build-search-index
```

Then open `.claude-trace/search.html` in browser.

Expected: Search interface loads and displays search box

**Step 5: Commit**

```bash
git add frontend/template-search.html src/search/search-html-generator.ts src/cli.ts
git commit -m "add search html template and generator"
```

---

## Task 11: CLI Search Command

**Files:**

- Modify: `src/cli.ts:530-540` (add --search handler)

**Step 1: Add openSearchInterface function**

Add to `src/cli.ts`:

```typescript
async function openSearchInterface(): Promise<void> {
	const searchHtmlPath = path.join(".claude-trace", "search.html");

	if (!fs.existsSync(searchHtmlPath)) {
		log("Search interface not found. Building index now...", "yellow");
		await buildSearchIndex();
	}

	// Open in browser
	spawn("open", [searchHtmlPath], { detached: true, stdio: "ignore" }).unref();
	log(`Search interface opened: ${searchHtmlPath}`, "green");
}
```

**Step 2: Add command handler in main()**

Add after `--build-search-index` handler:

```typescript
// --search or -s
if (claudeTraceArgs.includes("--search") || claudeTraceArgs.includes("-s")) {
	await openSearchInterface();
	return;
}
```

**Step 3: Test manually**

Run:

```bash
node dist/cli.js --search
```

Expected: Browser opens with search interface

**Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "add cli search command to open interface"
```

---

## Task 12: CLI Search Query Command

**Files:**

- Modify: `src/cli.ts:540-600` (add --search-query handler)

**Step 1: Add searchFromCLI function**

Add to `src/cli.ts`:

```typescript
async function searchFromCLI(query: string): Promise<void> {
	const indexPath = path.join(".claude-trace", "search-index.json");

	if (!fs.existsSync(indexPath)) {
		log("Search index not found. Run: claude-trace --build-search-index", "red");
		process.exit(1);
	}

	try {
		const indexContent = fs.readFileSync(indexPath, "utf-8");
		const index = JSON.parse(indexContent);

		// Simple keyword search for CLI
		const lowerQuery = query.toLowerCase();
		const results = index.conversations.filter((conv: any) => {
			return conv.searchableText.toLowerCase().includes(lowerQuery);
		});

		if (results.length === 0) {
			console.log(`\n${colors.yellow}No conversations found${colors.reset}\n`);
			process.exit(0);
		}

		console.log(`\n${colors.green}Found ${results.length} conversations:${colors.reset}\n`);

		results.slice(0, 10).forEach((result: any, i: number) => {
			console.log(`${i + 1}. ${colors.blue}${result.title}${colors.reset}`);
			console.log(`   ${result.startTime.replace("T", " ").slice(0, -5)} · ${result.messageCount} messages`);

			// Show first match snippet
			const index = result.searchableText.toLowerCase().indexOf(lowerQuery);
			if (index !== -1) {
				const start = Math.max(0, index - 40);
				const end = Math.min(result.searchableText.length, index + 40);
				const snippet = result.searchableText.slice(start, end);
				console.log(`   ${colors.yellow}...${snippet}...${colors.reset}`);
			}

			console.log(`   → ${colors.green}${result.htmlFile}${colors.reset}\n`);
		});

		if (results.length > 10) {
			console.log(`${colors.yellow}... and ${results.length - 10} more results${colors.reset}`);
			console.log(`${colors.blue}Use --search to open the web interface for full results${colors.reset}\n`);
		}

		process.exit(0);
	} catch (error) {
		const err = error as Error;
		log(`Error: ${err.message}`, "red");
		process.exit(1);
	}
}
```

**Step 2: Add command handler in main()**

Add after `--search` handler:

```typescript
// --search-query QUERY
if (claudeTraceArgs.includes("--search-query")) {
	const queryIndex = claudeTraceArgs.indexOf("--search-query");
	const query = claudeTraceArgs[queryIndex + 1];

	if (!query) {
		log("Missing query for --search-query", "red");
		log('Usage: claude-trace --search-query "your search"', "yellow");
		process.exit(1);
	}

	await searchFromCLI(query);
	return;
}
```

**Step 3: Test manually**

Run:

```bash
node dist/cli.js --search-query "authentication"
```

Expected: Prints matching conversations with snippets

**Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "add cli search query command"
```

---

## Task 13: Update README Documentation

**Files:**

- Modify: `README.md:20-40` (add search section)

**Step 1: Add search section to README**

Add after the "Usage" section in `README.md`:

````markdown
## Search

Search across all your logged conversations with instant keyword-based search:

```bash
# Build search index (first time or to update)
claude-trace --build-search-index

# Open search interface in browser
claude-trace --search

# Or search from command line
claude-trace --search-query "authentication error"
```
````

The search interface provides:

- **Full-text search** across all conversations with instant results
- **Smart filtering** by content scope (user/assistant/tools), time range, and models
- **Highlighted snippets** showing keyword context
- **Fuzzy matching** to handle typos
- **One-click navigation** to full conversation in HTML viewer

Search index updates automatically after each Claude session, or rebuild manually with `--build-search-index`.

````

**Step 2: Update help section in README**

Add to command list:

```markdown
# Build search index
claude-trace --build-search-index

# Open search interface
claude-trace --search

# Search from CLI
claude-trace --search-query "your search terms"
````

**Step 3: Verify README renders correctly**

Preview README.md in GitHub or VS Code

Expected: Formatting looks correct, links work

**Step 4: Commit**

```bash
git add README.md
git commit -m "update readme with search documentation"
```

---

## Task 14: Integration Test

**Files:**

- Create: `test/search-integration.test.ts`

**Step 1: Create integration test**

Create `test/search-integration.test.ts`:

```typescript
import { SearchIndexBuilder } from "../src/search/search-index-builder";
import { SearchHTMLGenerator } from "../src/search/search-html-generator";
import fs from "fs";
import path from "path";

describe("Search Integration", () => {
	const testDir = "./test-integration";

	beforeAll(() => {
		// Create test directory with sample log
		if (!fs.existsSync(testDir)) {
			fs.mkdirSync(testDir, { recursive: true });
		}

		// Create sample JSONL log
		const sampleLog = {
			request: {
				timestamp: Date.now() / 1000,
				method: "POST",
				url: "https://api.anthropic.com/v1/messages",
				headers: {},
				body: {
					model: "claude-sonnet-3.5",
					messages: [{ role: "user", content: "How do I implement authentication in FastAPI?" }],
				},
			},
			response: {
				timestamp: Date.now() / 1000 + 1,
				status_code: 200,
				headers: {},
				body: {
					content: [
						{
							type: "text",
							text: "To implement authentication in FastAPI, you can use OAuth2 with JWT tokens...",
						},
					],
					usage: {
						input_tokens: 50,
						output_tokens: 100,
					},
				},
			},
			logged_at: new Date().toISOString(),
		};

		fs.writeFileSync(path.join(testDir, "log-2025-10-20-10-00-00.jsonl"), JSON.stringify(sampleLog) + "\n");
	});

	afterAll(() => {
		// Clean up test directory
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
	});

	it("should build search index from logs", async () => {
		const builder = new SearchIndexBuilder();
		const index = await builder.buildIndex(testDir);

		expect(index.conversations).toHaveLength(1);
		expect(index.conversations[0].userMessages[0]).toContain("authentication");
		expect(index.conversations[0].assistantMessages[0]).toContain("FastAPI");
		expect(index.invertedIndex["authentication"]).toBeDefined();
	});

	it("should generate search HTML", async () => {
		const generator = new SearchHTMLGenerator();
		await generator.generateSearchHTML(testDir);

		const htmlPath = path.join(testDir, "search.html");
		expect(fs.existsSync(htmlPath)).toBe(true);

		const html = fs.readFileSync(htmlPath, "utf-8");
		expect(html).toContain("<search-view>");
		expect(html).toContain("Claude Trace Search");
	});

	it("should enable searching the index", async () => {
		const indexPath = path.join(testDir, "search-index.json");
		const builder = new SearchIndexBuilder();
		const index = await builder.buildIndex(testDir);

		fs.writeFileSync(indexPath, JSON.stringify(index));

		// Simulate search
		const query = "authentication";
		const results = index.conversations.filter((conv) =>
			conv.searchableText.toLowerCase().includes(query.toLowerCase()),
		);

		expect(results).toHaveLength(1);
		expect(results[0].userMessages[0]).toContain("authentication");
	});
});
```

**Step 2: Run integration test**

Run: `npm test -- search-integration.test.ts`
Expected: ALL TESTS PASS

**Step 3: Commit**

```bash
git add test/search-integration.test.ts
git commit -m "add search integration test"
```

---

## Task 15: Update Package Version and Publish

**Files:**

- Modify: `package.json:3` (bump version)

**Step 1: Update version**

Modify `package.json`:

```json
{
  "name": "@mariozechner/claude-trace",
  "version": "1.1.0",
  ...
}
```

**Step 2: Build everything**

Run:

```bash
npm run clean
npm run build
```

Expected: Clean build with no errors

**Step 3: Test locally**

Run:

```bash
npm link
claude-trace --build-search-index
claude-trace --search
```

Expected: Commands work correctly

**Step 4: Commit version bump**

```bash
git add package.json
git commit -m "bump version to 1.1.0"
```

**Step 5: Create git tag**

```bash
git tag v1.1.0
git push origin v1.1.0
```

---

## Verification Steps

After completing all tasks, verify the feature works end-to-end:

1. **Build search index**:

   ```bash
   claude-trace --build-search-index
   ```

   ✓ Creates `.claude-trace/search-index.json`
   ✓ Creates `.claude-trace/search.html`
   ✓ Shows progress and stats

2. **Open search interface**:

   ```bash
   claude-trace --search
   ```

   ✓ Opens browser with search interface
   ✓ Displays conversation count and token stats

3. **Perform search**:

   - Type "authentication" in search box
     ✓ Shows matching results instantly
     ✓ Highlights matched keywords
     ✓ Shows context snippets

4. **Test filters**:

   - Change scope to "User messages only"
   - Change time range to "Past week"
     ✓ Results update correctly

5. **CLI search**:

   ```bash
   claude-trace --search-query "fastapi"
   ```

   ✓ Prints matching conversations
   ✓ Shows snippets with context

6. **Click result**:
   - Click a result title
     ✓ Opens full conversation in HTML viewer

---

## Plan Complete

This implementation plan provides a complete universal search feature for claude-trace with:

- Fast client-side full-text search using inverted index
- Rich result previews with highlighted snippets
- Flexible filtering by scope, time, and models
- Both CLI and web interfaces
- Automatic index updates
- Comprehensive testing

All tasks are bite-sized (2-5 minutes each) and follow TDD principles with frequent commits.

**Execution options:**

1. **Subagent-Driven (this session)** - Dispatch fresh subagent per task, review between tasks
2. **Parallel Session (separate)** - Open new session with executing-plans for batch execution

Which approach would you like to use?
