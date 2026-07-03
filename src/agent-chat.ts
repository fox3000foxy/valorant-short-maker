import Groq from "groq-sdk";
import { ALL_RELATIONS } from "./lore/relations.ts";

export interface AgentPersona {
	agent: string;
	systemPrompt: string;
	lore: string[];
	wikiLore?: string;
}

export class AgentChat {
	private _groq: Groq;
	private _persona: AgentPersona;
	private _allLore: string;
	private _allRelations: string;
	private _lastPrompt: string = "";
	private _sessionDir: string = "";

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
			this._allRelations = relevant.length > 0
				? "Relations with other agents:\n" + relevant.join("\n")
				: "";
		} else {
			this._allRelations = "";
		}
	}

	get lastPrompt(): string {
		return this._lastPrompt;
	}

	setSessionDir(dir: string) {
		this._sessionDir = dir;
	}

	async genLine(sceneContext: string): Promise<string> {
		const parts: string[] = [
			this._persona.systemPrompt,
			"",
			"Agent lore:",
			this._allLore,
		];
		if (this._allRelations) {
			parts.push("", this._allRelations);
		}
		if (this._persona.wikiLore) {
			parts.push("", "Background:", this._persona.wikiLore);
		}
		parts.push(
			"",
			"Rules:",
			"- Output ONLY the spoken dialogue, nothing else.",
			"- No stage directions, no actions in asterisks or parentheses, no descriptions.",
			"- No character names, no colons, no formatting.",
			"- Just the raw words the character would say out loud.",
			"- One or two sentences maximum. Short and natural.",
			"- Reply in English, regardless of the input language.",
			"- You may optionally add pauses like [0.5] between phrases for pacing (e.g. 'Watch this [0.3] I got them right where I want them.').",
		);

		this._lastPrompt = parts.join("\n");

		const res = await this._groq.chat.completions.create({
			model: "llama-3.3-70b-versatile",
			messages: [
				{
					role: "system",
					content: this._lastPrompt,
				},
				{ role: "user", content: sceneContext },
			],
			// biome-ignore lint/style/useNamingConvention: Groq SDK uses snake_case
			max_tokens: 120,
		});

		return res.choices[0]?.message.content ?? "";
	}
}
