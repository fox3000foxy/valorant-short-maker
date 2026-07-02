import "dotenv/config";
import { AgentChat } from "./agent-chat.ts";
import { PERSONA as RAZE } from "./lore/raze.ts";
import { PERSONA as JETT } from "./lore/jett.ts";
import { PERSONA as PHOENIX } from "./lore/phoenix.ts";

async function main() {
	console.log("=== Valorant Agent Chat Demo ===\n");

	const raze = new AgentChat(RAZE);
	const jett = new AgentChat(JETT);
	const phoenix = new AgentChat(PHOENIX);

	const contexts = [
		"Another agent questions your judgment on the battlefield.",
		"The team is losing morale after three consecutive defeats.",
		"You see an enemy agent using your own abilities against your team.",
		"A rookie agent asks you for advice before their first real mission.",
		"An ally is pinned down by heavy fire and needs an opening.",
	];

	for (const [name, chat] of [
		["Raze", raze],
		["Jett", jett],
		["Phoenix", phoenix],
	] as const) {
		console.log(`=== ${name} ===\n`);
		for (const ctx of contexts) {
			const line = await chat.genLine(ctx);
			console.log(`  > ${ctx}`);
			console.log(`  ${line}\n`);
		}
	}
}

main().catch(console.error);
