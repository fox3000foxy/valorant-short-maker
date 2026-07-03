import Groq from "groq-sdk";
import { ALL_RELATIONS } from "./lore/relations.ts";

export interface AgentPersona {
	agent: string;
	systemPrompt: string;
	lore: string[];
	wikiLore?: string;
}

export interface DialogueLine {
	agent: string;
	text: string;
}

export class AgentChat {
	private _groq: Groq;
	private _persona: AgentPersona;
	private _allLore: string;
	private _allRelations: string;
	private _lastPrompt: string = "";

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

	async genDialogueLine(sceneContext: string, history: DialogueLine[]): Promise<string> {
		const systemParts: string[] = [
			this._persona.systemPrompt,
			"",
			"Agent lore:",
			this._allLore,
		];
		if (this._allRelations) {
			systemParts.push("", this._allRelations);
		}
		if (this._persona.wikiLore) {
			systemParts.push("", "Background:", this._persona.wikiLore);
		}
		systemParts.push(
			"",
			"Rules:",
			`- You are ${this._persona.agent} in a conversation with other Valorant agents.`,
			"- Respond with a SINGLE line of dialogue — your turn in the conversation.",
			"- Be humorous and in character.",
			"- Output ONLY the spoken dialogue — no character names, no colons, no stage directions.",
			"- Just the raw words. No prefixes, no labels, no formatting.",
			"- Short and natural. One or two sentences at most.",
			"- Reply in English.",
		);

		const systemContent = systemParts.join("\n");
		this._lastPrompt = systemContent + "\n\n" + `Scene: ${sceneContext}`;

		const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
			{ role: "system", content: systemContent },
			{ role: "user", content: `Scene: ${sceneContext}` },
		];

		for (const h of history) {
			messages.push({ role: "assistant", content: h.text });
			messages.push({ role: "user", content: "Continue." });
		}

		messages.push({
			role: "user",
			content: history.length === 0
				? `Start the conversation as ${this._persona.agent}.`
				: `${this._persona.agent} responds.`,
		});

		const res = await this._groq.chat.completions.create({
			model: "llama-3.3-70b-versatile",
			messages,
			// biome-ignore lint/style/useNamingConvention: Groq SDK uses snake_case
			max_tokens: 120,
		});

		return res.choices[0]?.message.content ?? "";
	}
}
