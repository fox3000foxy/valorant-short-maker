import { pipeline } from "@xenova/transformers";
import Groq from "groq-sdk";

// biome-ignore lint/suspicious/noExplicitAny: transformers types are too complex
let embedder: any = null;

async function getEmbedder() {
	if (!embedder) {
		embedder = await pipeline("feature-extraction", "Xenova/bge-small-en-v1.5");
	}
	return embedder;
}

async function embed(text: string): Promise<number[]> {
	const model = await getEmbedder();
	const out = await model(text, { pooling: "mean", normalize: true });
	return Array.from(out.data);
}

interface LoreEntry {
	id: string;
	agent: string;
	text: string;
	vec: number[];
}

const STORE: LoreEntry[] = [];

function cosineSimilarity(vectorA: number[], vectorB: number[]): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < vectorA.length; i++) {
		dot += vectorA[i]! * vectorB[i]!;
		normA += vectorA[i]! ** 2;
		normB += vectorB[i]! ** 2;
	}
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function retrieve(
	agent: string,
	query: string,
	topK = 3
): Promise<string[]> {
	const queryVec = await embed(query);
	return STORE.filter((entry) => entry.agent === agent)
		.map((entry) => ({ entry, score: cosineSimilarity(queryVec, entry.vec) }))
		.sort((left, right) => right.score - left.score)
		.slice(0, topK)
		.map((item) => item.entry.text);
}

export interface AgentPersona {
	agent: string;
	systemPrompt: string;
}

export class AgentChat {
	private _groq: Groq;
	private _persona: AgentPersona;

	constructor(persona: AgentPersona) {
		const apiKey = process.env.GROQ_API_KEY;
		if (!apiKey) {
			throw new Error("GROQ_API_KEY not set in environment");
		}
		this._groq = new Groq({ apiKey });
		this._persona = persona;
	}

	static async addLore(agent: string, text: string) {
		const vec = await embed(text);
		STORE.push({ id: crypto.randomUUID(), agent, text, vec });
	}

	static async addLoreBatch(agent: string, texts: string[]) {
		for (const text of texts) {
			await AgentChat.addLore(agent, text);
		}
	}

	async genLine(sceneContext: string): Promise<string> {
		const lore = await retrieve(this._persona.agent, sceneContext);
		const res = await this._groq.chat.completions.create({
			model: "llama-3.3-70b-versatile",
			messages: [
				{
					role: "system",
					content: `${this._persona.systemPrompt}\n\nRelevant lore:\n${lore.join("\n")}`,
				},
				{ role: "user", content: sceneContext },
			],
			// biome-ignore lint/style/useNamingConvention: Groq SDK uses snake_case
			max_tokens: 150,
		});
		return res.choices[0]?.message.content ?? "";
	}
}
