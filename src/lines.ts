import "dotenv/config";
import { AgentChat } from "./agent-chat.ts";
import { PERSONA as RAZE, LORE as RAZE_LORE } from "./lore/raze.ts";
import { PERSONA as JETT, LORE as JETT_LORE } from "./lore/jett.ts";
import { PERSONA as PHOENIX, LORE as PHOENIX_LORE } from "./lore/phoenix.ts";

async function main() {
	console.log("=== Loading lore... ===\n");
	await AgentChat.addLoreBatch("raze", RAZE_LORE);
	await AgentChat.addLoreBatch("jett", JETT_LORE);
	await AgentChat.addLoreBatch("phoenix", PHOENIX_LORE);

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

	console.log("=== Raze ===\n");
	for (const ctx of contexts) {
		const line = await raze.genLine(ctx);
		console.log(`  > ${ctx}`);
		console.log(`  ${line}\n`);
	}

	console.log("=== Jett ===\n");
	for (const ctx of contexts) {
		const line = await jett.genLine(ctx);
		console.log(`  > ${ctx}`);
		console.log(`  ${line}\n`);
	}

	console.log("=== Phoenix ===\n");
	for (const ctx of contexts) {
		const line = await phoenix.genLine(ctx);
		console.log(`  > ${ctx}`);
		console.log(`  ${line}\n`);
	}
}

main().catch(console.error);
