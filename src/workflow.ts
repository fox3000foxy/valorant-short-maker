import Groq from "groq-sdk";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import {
	BG_MUSIC_PATH,
	type Phrase,
	type SegmentInfo,
	applyFisheyeTransition,
	concatSegments,
	expandPhrases,
	parseScript,
	processPhrase,
	renderSegment,
	setBgVideoPath,
	setOutDir,
} from "./core.ts";
import { ALL_PERSONAS } from "./lore/index.ts";
import { ALL_RELATIONS } from "./lore/relations.ts";

const BG_CLIPS = [
	"clip_000.mp4",
	"clip_001.mp4",
	"clip_002.mp4",
	"clip_003.mp4",
	"clip_004_new_audio.mp4",
	"clip_005_new_audio.mp4",
];

function pickRandomBgVideo(): string {
	const clip = BG_CLIPS[Math.floor(Math.random() * BG_CLIPS.length)]!;
	return join(import.meta.dirname, "..", "bg-video", clip);
}

const ALL_AGENT_NAMES = Object.keys(ALL_PERSONAS);

const DEFAULT_CONTEXTS = [
	"casual argument during a mission debrief",
	"trash-talking the enemy team before a round",
	"complaining about the mission briefing being too early",
	"who gets the last cup of coffee at the safe house",
	"arguing over who has the best ultimate ability",
	"giving each other nicknames and they don't stick",
	"someone accidentally triggered the alarm, blame game",
];

function generateSessionId(): string {
	return randomBytes(8).toString("hex");
}

function compactPersona(agent: string, sceneAgents: string[]): string {
	const p = ALL_PERSONAS[agent]!;
	const relations = ALL_RELATIONS[agent] ?? {};
	const relevantRels = sceneAgents
		.filter((a) => a !== agent && relations[a])
		.map((a) => `  - ${a}: ${relations[a]}`);
	const voice = p.systemPrompt.split("\n").filter(Boolean).slice(0, 4).join(" ");
	const facts = p.lore.slice(0, 8).join(" ");
	let out = `${agent.toUpperCase()}: ${voice}`;
	out += `\n  Facts: ${facts}`;
	if (relevantRels.length > 0) out += `\n  Relations:\n${relevantRels.join("\n")}`;
	return out;
}

async function generateScript(context: string, agentNames: string[], sessionDir: string): Promise<Phrase[]> {
	console.log("  Generating script with LLM...");

	const shuffled = agentNames.toSorted(() => Math.random() - 0.5);
	const actors = shuffled.slice(0, Math.min(3 + Math.floor(Math.random() * 2), shuffled.length));
	const promptsDir = join(sessionDir, "prompts");
	mkdirSync(promptsDir, { recursive: true });

	const characters = actors.map((a) => compactPersona(a, actors)).join("\n\n---\n\n");

	const inlinePauseExamples = [
		"  killjoy: No one yet[0.3]but I've got a plan.",
		"  fade: I need coffee to face my fears[0.3]not a briefing.",
		"  chamber: This is embarrassing.[0.3]Radiant indeed.",
	].join("\n");

	const systemPrompt = [
		"You write humorous dialogue for Valorant agents.",
		"",
		"Characters:",
		characters,
		"",
		"Rules:",
		"- Output EXACTLY 25 lines.",
		"- Format: AgentName: dialogue text (e.g. Breach: I built my arms from scrap.).",
		"- Use the exact agent names as shown above.",
		"- HUMOR is top priority — witty, sarcastic, playful.",
		"- Each character speaks in their unique voice.",
		"- Rotate through all characters evenly (no monologues).",
		"- Short, punchy lines for video shorts.",
		"- No stage directions, no descriptions, no formatting.",
		"- Reply in English.",
		"- No semicolons or ellipses. A few commas are okay for subtitle flow but keep them natural.",
		"",
		"PAUSES (CRITICAL — natural speech flow):",
		"  - Add [0.3] INSIDE a character's line for a natural beat mid-speech (circle stays visible):",
		inlinePauseExamples,
		"  - Write pause: 0.3 or pause: 1.0 as its OWN LINE for a full beat between speakers (circle hides).",
		"  - Always include INLINE pauses [0.3] in at least 3-4 lines per script for natural cadence.",
		"  - Keep inline pauses minimal: ONE per line at most, placed at a natural speech break.",
	].join("\n");

	const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });
	const res = await groq.chat.completions.create({
		model: "llama-3.3-70b-versatile",
		messages: [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: `Scene: ${context}\n\nGenerate 25 lines.` },
		],
		max_tokens: 800,
	});

	const raw = res.choices[0]?.message.content ?? "";
	writeFileSync(join(promptsDir, "llm_raw.txt"), raw);

	const history: { agent: string; text: string }[] = [];
	for (const line of raw.split("\n")) {
		const t = line.trim();
		if (!t || t.startsWith("#")) continue;
		const m = t.match(/^(\w[\w-]*):\s*(.+)/);
		if (m) {
			const agent = m[1]!.toLowerCase();
			const text = m[2]!.trim();
			if (text) {
				if (agent === "pause") {
					const dur = Number.parseFloat(text);
					if (dur > 0) history.push({ agent: "pause", text: String(dur) });
				} else if (ALL_PERSONAS[agent]) {
					history.push({ agent, text });
				}
			}
		}
	}

	const finalScript = history.map((h) => `${h.agent}: ${h.text}`).join("\n");
	writeFileSync(join(promptsDir, "final_script.txt"), finalScript + "\n");
	writeFileSync(
		join(promptsDir, "context.txt"),
		[
			`Context: ${context}`,
			`Agents: ${actors.join(", ")}`,
			`Total lines: ${history.length}`,
			`Generated: ${new Date().toISOString()}`,
		].join("\n") + "\n",
	);

	const phrases = expandPhrases(
		history.map((h) => {
			if (h.agent === "pause") {
				return { agent: "pause", text: h.text, duration: Number.parseFloat(h.text) || 1.0 };
			}
			return { agent: h.agent, text: h.text };
		}),
	);

	console.log(`  Generated ${history.length} lines across ${actors.length} agents\n`);
	for (const h of history) {
		console.log(`    ${h.agent}: ${h.text}`);
	}
	console.log("");
	return phrases;
}

function saveScript(phrases: Phrase[], path: string) {
	const lines = phrases.map((p) => {
		if (p.agent === "pause") {
			return `pause: ${p.duration!.toFixed(1)}`;
		}
		return `${p.agent}: ${p.text}`;
	});
	writeFileSync(path, lines.join("\n") + "\n");
}

export interface WorkflowOptions {
	demo?: boolean;
	context?: string;
	agents?: string[];
	parts?: number;
	output?: string;
}

const DEFAULT_PARTS = 1;

function now(): string {
	return ((Date.now() / 1000) % 60).toFixed(1) + "s";
}

function parseFlags(): WorkflowOptions {
	const args = Bun.argv.slice(2);
	const opts: WorkflowOptions = {};
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--demo") {
			opts.demo = true;
		} else if (args[i] === "--context" && i + 1 < args.length) {
			opts.context = args[++i]!;
		} else if (args[i] === "--agents" && i + 1 < args.length) {
			opts.agents = args[++i]!.split(",").map((a) => a.trim().toLowerCase());
		} else if (args[i] === "--parts" && i + 1 < args.length) {
			opts.parts = Number.parseInt(args[++i]!, 10);
		} else if (args[i] === "--output" && i + 1 < args.length) {
			opts.output = args[++i]!;
		}
	}
	return opts;
}

export async function run(options: WorkflowOptions): Promise<string[]> {
	const wallStart = Date.now();
	const parts = options.parts ?? DEFAULT_PARTS;

	let phrases: Phrase[];

	const baseDir = options.output ?? join(import.meta.dirname, "..", "workflow_outputs");
	const sessionId = generateSessionId();
	const sessionDir = join(baseDir, sessionId);
	const assetsDir = join(sessionDir, "assets");

	mkdirSync(assetsDir, { recursive: true });
	setOutDir(assetsDir);

	if (options.demo) {
		phrases = parseScript();
		console.log("=== Workflow (demo) ===\n");
	} else {
		const t0 = Date.now();
		const agentNames = options.agents?.length
			? options.agents
			: (() => {
					const shuffled = ALL_AGENT_NAMES.toSorted(() => Math.random() - 0.5);
					return shuffled.slice(0, 3 + Math.floor(Math.random() * 2));
				})();

		const invalid = agentNames.filter((a) => !ALL_PERSONAS[a]);
		if (invalid.length > 0) {
			console.error(`  Unknown agents: ${invalid.join(", ")}`);
			console.error(`  Available: ${ALL_AGENT_NAMES.join(", ")}`);
			throw new Error("Invalid agent names");
		}

		const context = options.context ?? DEFAULT_CONTEXTS[Math.floor(Math.random() * DEFAULT_CONTEXTS.length)]!;

		console.log("=== Workflow (generate) ===\n");
		console.log(`  Agents: ${agentNames.join(", ")}`);
		console.log(`  Context: ${context}\n`);
		setBgVideoPath(pickRandomBgVideo());
		phrases = await generateScript(context, agentNames, sessionDir);
		console.log(`  [${now()}] Script generated (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
	}

	saveScript(phrases, join(sessionDir, "script.txt"));

	const C_TTS = Math.min(2, cpus().length);
	const C = cpus().length;
	const segments: SegmentInfo[] = [];

	const t1 = Date.now();
	console.log("  Generating segments...\n");
	for (let i = 0; i < phrases.length; i += C_TTS) {
		const batch = phrases.slice(i, i + C_TTS);
		const results = await Promise.all(
			batch.map((p, j) => processPhrase(p, i + j))
		);
		segments.push(...results);
	}
	console.log(`  [${now()}] TTS + ASS done (${((Date.now() - t1) / 1000).toFixed(1)}s)`);

	const t2 = Date.now();
	let acc = 0;
	const offsets = segments.map((s) => {
		const off = acc;
		acc += s.duration;
		return off;
	});
	for (let i = 0; i < segments.length; i += C) {
		const batchSegs = segments.slice(i, i + C);
		const batchOffs = offsets.slice(i, i + C);
		await Promise.all(
			batchSegs.map((info, j) => {
				console.log(
					`  Rendering ${info.agent} (${info.duration.toFixed(2)}s)...`
				);
				return renderSegment(info, batchOffs[j]!);
			})
		);
	}
	console.log(`  [${now()}] Rendering done (${((Date.now() - t2) / 1000).toFixed(1)}s)`);

	const totalDur = segments.reduce((s, seg) => s + seg.duration, 0);
	console.log(`\n  Total: ${totalDur.toFixed(1)}s (${segments.length} segments)`);

	const segsPerPart = Math.max(1, Math.ceil(segments.length / parts));
	const partGroups: SegmentInfo[][] = [];
	for (let i = 0; i < segments.length; i += segsPerPart) {
		partGroups.push(segments.slice(i, i + segsPerPart));
	}

	const outputPaths: string[] = [];

	for (let pi = 0; pi < partGroups.length; pi++) {
		const group = partGroups[pi]!;
		const partNum = pi + 1;
		const partPath =
			partGroups.length === 1
				? join(sessionDir, "output.mp4")
				: join(sessionDir, `output_part${partNum}.mp4`);

		console.log(`\n  Part ${partNum}/${partGroups.length}...`);

		if (pi === 0 && group[0]) {
			const t3 = Date.now();
			const firstPath = join(assetsDir, "00_intro.mp4");
			console.log("  Applying fisheye intro...");
			await applyFisheyeTransition(group[0]!.videoPath, firstPath);
			group[0]!.videoPath = firstPath;
			console.log(`  [${now()}] Fisheye done (${((Date.now() - t3) / 1000).toFixed(1)}s)`);
		}

		const firstSeg = group.find((s) => s.assPath !== null);
		if (firstSeg) {
			const assContent = readFileSync(firstSeg.assPath!, "utf-8");
			const fadeDuration = Math.min(1, firstSeg.duration * 0.3);
			const partLabel = options.context ?? "Demo";

			const totalSec = Math.round(firstSeg.duration * 100) / 100;
			const cs = Math.round((totalSec % 1) * 100);
			const s = Math.floor(totalSec % 60);
			const m = Math.floor((totalSec / 60) % 60);
			const h = Math.floor(totalSec / 3600);
			const endTime = `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
			const partLine = `Dialogue: 1,0:00:00.00,${endTime},PartNum,,0,0,0,,{\\fad(0,${Math.round(fadeDuration * 1000)})}${partLabel}`;

			const styleLine =
				"Style: PartNum, Montserrat, 120, &H00FFFFFF, &H00000000, 1, 0, 1, 4, 0, 2, 100, 100, 100, 1";

			const styleMatch = assContent.match(/^\[V4\+ Styles\]\s*\n(Format:[^\n]*\n)((?:Style:[^\n]*\n)*)/m);
			let modified: string;
			if (styleMatch) {
				const beforeStyle = assContent.slice(0, styleMatch.index! + styleMatch[0].length);
				const afterStyle = assContent.slice(styleMatch.index! + styleMatch[0].length);
				modified = beforeStyle + styleLine + "\n" + afterStyle;
			} else {
				modified = assContent;
			}

			const eventsMatch = modified.match(/^\[Events\]\s*\n(Format:[^\n]*\n)/m);
			if (eventsMatch) {
				const insertPos = eventsMatch.index! + eventsMatch[0].length;
				modified = modified.slice(0, insertPos) + partLine + "\n" + modified.slice(insertPos);
			}

			writeFileSync(firstSeg.assPath!, modified + "\n");
		}

		const t4 = Date.now();
		await concatSegments(group, partPath, BG_MUSIC_PATH);
		console.log(`  [${now()}] Concat + mux done (${((Date.now() - t4) / 1000).toFixed(1)}s)`);
		outputPaths.push(partPath);
	}

	console.log(`  [${now()}] Total wall time: ${((Date.now() - wallStart) / 1000).toFixed(1)}s`);

	for (const path of outputPaths) {
		console.log(`  ${path}`);
	}

	return outputPaths;
}

const FLAGS = parseFlags();
if (import.meta.main) {
	run(FLAGS).catch(console.error);
}
