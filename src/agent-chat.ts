import Groq from "groq-sdk";
import { ALL_RELATIONS } from "./lore/relations.ts";

export interface AgentPersona {
	agent: string;
	systemPrompt: string;
	lore: string[];
	wikiLore?: string;
}

export interface ChatMessage {
	role: "user" | "assistant";
	content: string;
}

export class AgentChat {
	private _groq: Groq;
	private _persona: AgentPersona;
	private _allLore: string;
	private _allRelations: string;
	private _systemCache = "";

	constructor(persona: AgentPersona, selectedAgents?: string[]) {
		const apiKey = process.env.GROQ_API_KEY;
		if (!apiKey) {
			throw new Error("GROQ_API_KEY not set in environment");
		}
		this._groq = new Groq({ apiKey });
		this._persona = persona;
		this._allLore = persona.lore.join("\n");

		const agentRelations = ALL_RELATIONS[persona.agent];
		if (agentRelations && selectedAgents) {
			const relevant = selectedAgents
				.filter((a) => a !== persona.agent && agentRelations[a])
				.map((a) => `  ${a}: ${agentRelations[a]}`);
			this._allRelations =
				relevant.length > 0
					? "Relations with other agents:\n" + relevant.join("\n")
					: "";
		} else {
			this._allRelations = "";
		}
	}

	private buildSystem(): string {
		if (this._systemCache) return this._systemCache;
		const parts: string[] = [
			this._persona.systemPrompt,
			"",
			"Agent lore:",
			this._allLore,
		];
		if (this._allRelations) parts.push("", this._allRelations);
		if (this._persona.wikiLore)
			parts.push("", "Background:", this._persona.wikiLore);
		parts.push(
			"",
			"Rules:",
			`- You are ${this._persona.agent} in a conversation with other Valorant agents.`,
			"- Respond with a SINGLE line of dialogue — your turn.",
			"- Be humorous and in character.",
			"- Output ONLY the spoken dialogue — no names, colons, stage directions, or formatting.",
			"- One or two short sentences at most.",
			"- Reply in English."
		);
		this._systemCache = parts.join("\n");
		return this._systemCache;
	}

	async genDialogueLine(conversation: ChatMessage[]): Promise<string> {
		const messages: {
			role: "system" | "user" | "assistant";
			content: string;
		}[] = [
			{ role: "system", content: this.buildSystem() },
			...conversation,
			{ role: "user", content: `${this._persona.agent} speaks.` },
		];

		const res = await this._groq.chat.completions.create({
			model: "llama-3.3-70b-versatile",
			messages,
			max_tokens: 120,
		});

		return res.choices[0]?.message.content ?? "";
	}
}
