import Groq from "groq-sdk";

export interface AgentPersona {
	agent: string;
	systemPrompt: string;
	lore: string[];
}

export class AgentChat {
	private _groq: Groq;
	private _persona: AgentPersona;
	private _allLore: string;

	constructor(persona: AgentPersona) {
		const apiKey = process.env.GROQ_API_KEY;
		if (!apiKey) {
			throw new Error("GROQ_API_KEY not set in environment");
		}
		this._groq = new Groq({ apiKey });
		this._persona = persona;
		this._allLore = persona.lore.join("\n");
	}

	async genLine(sceneContext: string): Promise<string> {
		const res = await this._groq.chat.completions.create({
			model: "llama-3.3-70b-versatile",
			messages: [
				{
					role: "system",
					content: [
						this._persona.systemPrompt,
						"",
						"Agent lore:",
						this._allLore,
						"",
						"Rules:",
						"- Output ONLY the spoken dialogue, nothing else.",
						"- No stage directions, no actions in asterisks or parentheses, no descriptions.",
						"- No character names, no colons, no formatting.",
						"- Just the raw words the character would say out loud.",
						"- One or two sentences maximum. Short and natural.",
						"- Reply in English, regardless of the input language.",
						"- You may optionally add pauses like [0.5] between phrases for pacing (e.g. 'Watch this [0.3] I got them right where I want them.').",
					].join("\n"),
				},
				{ role: "user", content: sceneContext },
			],
			// biome-ignore lint/style/useNamingConvention: Groq SDK uses snake_case
			max_tokens: 120,
		});
		return res.choices[0]?.message.content ?? "";
	}
}
