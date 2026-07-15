import { $ } from "bun";
import Groq from "groq-sdk";
import { cpus } from "node:os";
import { join } from "node:path";
import {
	BG_MUSIC_PATH,
	concatSegments,
	createIntroTransition,
	expandPhrases,
	generateIntroVideo,
	parseScript,
	processPhrase,
	renderSegment,
	setBgVideoPath,
	setOutDir,
	WHOOSH_PATH,
	type Phrase,
	type SegmentInfo,
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
	"deciding who has to write the after-action report",
	"heated debate about the best entry fragger on the team",
	"blaming the controller for not smoking the right choke point",
	"arguing about whether to save or force buy next round",
	"disagreement over who should carry the spike",
	"discussing who is the worst shot in the squad",
	"fighting over the last healing pack during a firefight",
	"complaining about the enemy team camping every corner",
	"arguing about the best sniper position on the map",
	"someone stole the kill and everyone heard about it",
	"the team tries to settle a score with a knife round",
	"debating whether to rotate early or hold the site",
	"arguing about whose fault it was that the spike got defused",
	"discussing the most embarrassing death of the match",
	"the initiator pushed alone and died, now everyone is mad",
	"arguing about the best skin collection in the armory",
	"debating which map is the worst to play on",
	"someone used their ultimate at the worst possible moment",
	"arguing over who gets to play duelist this match",
	"blaming the sentinel for not watching the flank",
	"discussing whether wallhacks are just game sense",
	"complaining about matchmaking putting them with noobs",
	"someone keeps peeking the same angle and dying",
	"debating the best crosshair settings in the game",
	"arguing about sensitivity settings being too high or low",
	"discussing which agent has the most annoying voice lines",
	"trying to convince a teammate to switch agents",
	"arguing over who died first and cost them the round",
	"someone is spam pinging and everyone is annoyed",
	"discussing whether to rush B or go for a slow execute",
	"debating the optimal time to use the operator",
	"complaining about the spike being dropped in a bad spot",
	"arguing about whose turn it is to play smokes",
	"discussing whether the game is rigged or they just suck",
	"someone is bottom fragging and talking the most trash",
	"arguing about the best way to clear a corner",
	"debating whether to eco or force buy second round",
	"complaining about the enemy team having a Smurf",
	"discussing which side is easier to defend on the current map",
	"arguing about the worst teammate they have ever played with",
	"someone keeps stepping on the team's traps and setting them off",
	"debating who should be the team captain for the next match",
	"arguing about the best pistol round strategy",
	"discussing which ultimate combo is the most overpowered",
	"someone flashed the entire team and nobody is happy",
	"arguing about whether to save the ultimate or use it",
	"the duelist is baiting the team and everyone is calling it out",
	"debating whether the other team is actually good or just lucky",
	"arguing about who gets to open the next loot box",
	"discussing the best spray pattern for the vandal",
	"someone keeps reloading after every single kill",
	"arguing about the most toxic player on the server",
	"debating the best way to retake a site with numbers disadvantage",
	"complaining about the game audio being bugged again",
	"discussing which agent has the best lore backstory",
	"arguing about who is responsible for buying the team loadout",
	"debating whether to take the fight or retreat and regroup",
	"someone is baiting abilities and everyone is frustrated",
	"arguing about the best sidearm to buy in early rounds",
	"discussing whether the team should play default or execute",
	"someone cooked a grenade too long and killed themselves",
	"arguing about who gets bragging rights for the match MVP",
	"debating the most efficient way to clear a site",
	"complaining about the round timer being too short",
	"discussing the most underrated agent in the current meta",
	"arguing about the best knife animation in the game",
	"someone walked right past a hiding enemy and didn't see them",
	"debating whether to stack a site or spread out",
	"arguing about who has to play sentinel every match",
	"discussing the most annoying sound effect in the game",
	"someone tried to 1v5 clutch and died immediately",
	"arguing about the best way to spend the team's money",
	"debating whether the match was thrown or the enemy was better",
	"complaining about having too many controllers on the team",
	"discussing which map should be removed from the rotation",
	"someone is lurking too much and the team feels abandoned",
	"arguing about the best dance emote in the game",
	"debating whether the team should go for the ace or plant the spike",
	"someone keeps peeking mid and getting picked",
	"arguing about who is the most overrated player in their rank",
	"discussing the best agent composition for the current map",
	"someone threw a molly on the spike defuse and saved the round",
	"arguing about the hardest rank to climb out of",
	"debating whether to double peek or trade one at a time",
	"complaining about the replay system not being good enough",
	"discussing which agent needs a nerf the most",
	"someone blamed their lag for every single death",
	"arguing about the most satisfying way to win a round",
];

function generateSessionId(): string {
	return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function compactPersona(agent: string, sceneAgents: string[]): string {
	const p = ALL_PERSONAS[agent]!;
	const relations = ALL_RELATIONS[agent] ?? {};
	const relevantRels = sceneAgents
		.filter((a) => a !== agent && relations[a])
		.map((a) => `  - ${a}: ${relations[a]}`);
	const voice = p.systemPrompt
		.split("\n")
		.filter(Boolean)
		.slice(0, 4)
		.join(" ");
	const facts = p.lore.slice(0, 8).join(" ");
	let out = `${agent.toUpperCase()}: ${voice}`;
	out += `\n  Facts: ${facts}`;
	if (relevantRels.length > 0)
		out += `\n  Relations:\n${relevantRels.join("\n")}`;
	return out;
}

async function generateScript(
	context: string,
	agentNames: string[],
	sessionDir: string
): Promise<Phrase[]> {
	console.log("  Generating script with LLM...");

	const shuffled = agentNames.toSorted(() => Math.random() - 0.5);
	const actors = shuffled.slice(
		0,
		Math.min(3 + Math.floor(Math.random() * 2), shuffled.length)
	);
	const promptsDir = join(sessionDir, "prompts");
	await $`mkdir -p ${promptsDir}`;

	const characters = actors
		.map((a) => compactPersona(a, actors))
		.join("\n\n---\n\n");

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
	await Bun.write(join(promptsDir, "llm_raw.txt"), raw);

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
	await Bun.write(join(promptsDir, "final_script.txt"), finalScript + "\n");
	await Bun.write(
		join(promptsDir, "context.txt"),
		[
			`Context: ${context}`,
			`Agents: ${actors.join(", ")}`,
			`Total lines: ${history.length}`,
			`Generated: ${new Date().toISOString()}`,
		].join("\n") + "\n"
	);

	const phrases = expandPhrases(
		history.map((h) => {
			if (h.agent === "pause") {
				return {
					agent: "pause",
					text: h.text,
					duration: Number.parseFloat(h.text) || 1.0,
				};
			}
			return { agent: h.agent, text: h.text };
		})
	);

	console.log(
		`  Generated ${history.length} lines across ${actors.length} agents\n`
	);
	for (const h of history) {
		console.log(`    ${h.agent}: ${h.text}`);
	}
	console.log("");
	return phrases;
}

async function saveScript(phrases: Phrase[], path: string) {
	const lines = phrases.map((p) => {
		if (p.agent === "pause") {
			return `pause: ${p.duration!.toFixed(1)}`;
		}
		return `${p.agent}: ${p.text}`;
	});
	await Bun.write(path, lines.join("\n") + "\n");
}

export interface WorkflowOptions {
	demo?: boolean;
	scriptPath?: string;
	context?: string;
	agents?: string[];
	parts?: number;
	output?: string;
	upload?: boolean;
	uploadIgOnly?: boolean;
	uploadYtOnly?: boolean;
}

const DEFAULT_PARTS = 1;

function now(): string {
	return ((Date.now() / 1000) % 60).toFixed(1) + "s";
}

async function parseScriptFile(path: string): Promise<Phrase[]> {
	const raw = await Bun.file(path).text();
	return raw
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const sep = line.indexOf(":");
			if (sep === -1) throw new Error(`Invalid script line: ${line}`);
			const agent = line.slice(0, sep).trim().toLowerCase();
			const text = line.slice(sep + 1).trim();
			if (agent === "pause") {
				return { agent, text, duration: Number.parseFloat(text) || 1.0 };
			}
			return { agent, text };
		});
}

interface UploadMeta {
	ytTitle: string;
	ytDescription: string;
	igCaption: string;
}

async function generateUploadMeta(
	context: string,
	phrases: Phrase[]
): Promise<UploadMeta> {
	const scriptText = phrases
		.filter((p) => p.agent !== "pause")
		.map((p) => `${p.agent}: ${p.text}`)
		.join("\n");

	const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });
	const res = await groq.chat.completions.create({
		model: "llama-3.3-70b-versatile",
		messages: [
			{
				role: "system",
				content: [
					"Generate upload metadata for a Valorant short video.",
					"Respond in JSON with exactly three fields:",
					'  - "ytTitle": YouTube title (max 60 chars, catchy)',
					'  - "ytDescription": YouTube description (1-2 sentences with hashtags)',
					'  - "igCaption": Instagram caption (short, with emoji and hashtags)',
					"Reply with ONLY the JSON object, no markdown.",
				].join("\n"),
			},
			{
				role: "user",
				content: `Context: ${context}\n\nScript:\n${scriptText}`,
			},
		],
		max_tokens: 200,
		temperature: 0.7,
	});

	const raw = res.choices[0]?.message.content ?? "{}";
	const meta: UploadMeta = JSON.parse(raw);
	return {
		ytTitle: meta.ytTitle ?? "Valorant Short",
		ytDescription: meta.ytDescription ?? "#valorant #gaming #shorts",
		igCaption: meta.igCaption ?? "#valorant #gaming",
	};
}

async function uploadVideos(
	videoPath: string,
	options: WorkflowOptions,
	meta?: UploadMeta
): Promise<void> {
	const uploadScript = join(
		import.meta.dirname,
		"..",
		"uploaders",
		"upload.py"
	);
	const venvPython = join(import.meta.dirname, "..", ".venv", "bin", "python3");
	const { exitCode } = await $`test -f ${venvPython}`.nothrow();
	const pythonBin = exitCode === 0 ? venvPython : "python3";

	console.log("\n=== Uploading ===");
	console.log(`  Title: ${meta?.ytTitle ?? "Valorant Short"}`);

	const extraArgs = options.uploadIgOnly
		? ["--ig-only"]
		: options.uploadYtOnly
			? ["--yt-only"]
			: [];

	const { exitCode: uploadExit } =
		await $`${pythonBin} ${uploadScript} --video ${videoPath} --title ${meta?.ytTitle ?? "Valorant Short"} --description ${meta?.ytDescription ?? "#valorant #gaming #shorts"} --caption ${meta?.igCaption ?? "#valorant #gaming"} ${extraArgs}`.nothrow();

	if (uploadExit === 0) {
		console.log("=== Upload complete ===\n");
	} else {
		console.error(`=== Upload failed (exit code ${uploadExit}) ===`);
	}
}

function parseFlags(): WorkflowOptions {
	const args = Bun.argv.slice(2);
	const opts: WorkflowOptions = {};
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--demo") {
			opts.demo = true;
		} else if (args[i] === "--script" && i + 1 < args.length) {
			opts.scriptPath = args[++i]!;
		} else if (args[i] === "--context" && i + 1 < args.length) {
			opts.context = args[++i]!;
		} else if (args[i] === "--agents" && i + 1 < args.length) {
			opts.agents = args[++i]!.split(",").map((a) => a.trim().toLowerCase());
		} else if (args[i] === "--parts" && i + 1 < args.length) {
			opts.parts = Number.parseInt(args[++i]!, 10);
		} else if (args[i] === "--output" && i + 1 < args.length) {
			opts.output = args[++i]!;
		} else if (args[i] === "--upload") {
			opts.upload = true;
		} else if (args[i] === "--upload-ig-only") {
			opts.upload = true;
			opts.uploadYtOnly = false;
			opts.uploadIgOnly = true;
		} else if (args[i] === "--upload-yt-only") {
			opts.upload = true;
			opts.uploadIgOnly = false;
			opts.uploadYtOnly = true;
		}
	}
	return opts;
}

export async function run(options: WorkflowOptions): Promise<string[]> {
	const wallStart = Date.now();
	const parts = options.parts ?? DEFAULT_PARTS;

	const context = options.demo
		? "agents trash-talking each other during a heated match"
		: (options.context ??
			DEFAULT_CONTEXTS[Math.floor(Math.random() * DEFAULT_CONTEXTS.length)]!);

	let phrases: Phrase[];

	const baseDir =
		options.output ?? join(import.meta.dirname, "..", "workflow_outputs");
	const sessionId = generateSessionId();
	const sessionDir = join(baseDir, sessionId);
	const assetsDir = join(sessionDir, "assets");

	await $`mkdir -p ${assetsDir}`;
	setOutDir(assetsDir);

	let uploadMeta: UploadMeta | undefined;

	if (options.demo) {
		phrases = await parseScript();
		console.log("=== Workflow (demo) ===\n");
		if (options.upload) {
			uploadMeta = await generateUploadMeta("demo", phrases);
			await Bun.write(
				join(sessionDir, "upload_meta.json"),
				JSON.stringify(uploadMeta, null, 2) + "\n"
			);
		}
	} else if (options.scriptPath) {
		const ctx = options.context ?? "custom script";
		phrases = await parseScriptFile(options.scriptPath);
		console.log(`=== Workflow (script: ${options.scriptPath}) ===\n`);
		console.log(`  Context: ${ctx}\n`);
		setBgVideoPath(pickRandomBgVideo());
		if (options.upload) {
			uploadMeta = await generateUploadMeta(ctx, phrases);
			await Bun.write(
				join(sessionDir, "upload_meta.json"),
				JSON.stringify(uploadMeta, null, 2) + "\n"
			);
		}
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

		console.log("=== Workflow (generate) ===\n");
		console.log(`  Agents: ${agentNames.join(", ")}`);
		console.log(`  Context: ${context}\n`);
		setBgVideoPath(pickRandomBgVideo());
		phrases = await generateScript(context, agentNames, sessionDir);
		console.log(
			`  [${now()}] Script generated (${((Date.now() - t0) / 1000).toFixed(1)}s)`
		);

		if (options.upload) {
			uploadMeta = await generateUploadMeta(context, phrases);
			await Bun.write(
				join(sessionDir, "upload_meta.json"),
				JSON.stringify(uploadMeta, null, 2) + "\n"
			);
			console.log(`  [${now()}] Upload metadata generated`);
		}
	}

	await saveScript(phrases, join(sessionDir, "script.txt"));

	const CTts = Math.min(2, cpus().length);
	const C = cpus().length;
	const segments: SegmentInfo[] = [];

	const t1 = Date.now();
	console.log("  Generating segments...\n");
	for (let i = 0; i < phrases.length; i += CTts) {
		const batch = phrases.slice(i, i + CTts);
		const results = await Promise.all(
			batch.map((p, j) => processPhrase(p, i + j))
		);
		segments.push(...results);
	}
	console.log(
		`  [${now()}] TTS + ASS done (${((Date.now() - t1) / 1000).toFixed(1)}s)`
	);

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
	console.log(
		`  [${now()}] Rendering done (${((Date.now() - t2) / 1000).toFixed(1)}s)`
	);

	const totalDur = segments.reduce((s, seg) => s + seg.duration, 0);
	console.log(
		`\n  Total: ${totalDur.toFixed(1)}s (${segments.length} segments)`
	);

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

		if (pi === 0) {
			const t3 = Date.now();
			const introPath = join(assetsDir, "00_intro.mp4");
			const combinedPath = join(assetsDir, "00_combined.mp4");
			const partLabel = context ?? "Demo";
			const allAgentNames = options.agents ?? Object.keys(ALL_PERSONAS);
			console.log("  Generating intro...");
			await generateIntroVideo(partLabel, allAgentNames, introPath);

			if (group.length > 0) {
				console.log("  Creating slide transition...");
				await createIntroTransition(
					introPath,
					group[0]!.videoPath,
					WHOOSH_PATH,
					combinedPath
				);
				const combinedDur = 3 + group[0]!.duration - 0.3;
				group[0] = {
					agent: "intro+" + group[0]!.agent,
					audioPath: combinedPath,
					duration: combinedDur,
					assPath: group[0]!.assPath,
					iconPath: group[0]!.iconPath,
					videoPath: combinedPath,
					scaleExpr: group[0]!.scaleExpr,
				};
			} else {
				group.unshift({
					agent: "intro",
					audioPath: introPath,
					duration: 3,
					assPath: null,
					iconPath: "",
					videoPath: introPath,
					scaleExpr: null,
				});
			}
			console.log(
				`  [${now()}] Intro done (${((Date.now() - t3) / 1000).toFixed(1)}s)`
			);
		}

		const firstSeg = group.find((s) => s.assPath !== null);
		if (firstSeg) {
			const assContent = await Bun.file(firstSeg.assPath!).text();
			const fadeDuration = Math.min(1, firstSeg.duration * 0.3);
			const partLabel = context ?? "Demo";

			const totalSec = Math.round(firstSeg.duration * 100) / 100;
			const cs = Math.round((totalSec % 1) * 100);
			const s = Math.floor(totalSec % 60);
			const m = Math.floor((totalSec / 60) % 60);
			const h = Math.floor(totalSec / 3600);
			const endTime = `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
			const partLine = `Dialogue: 1,0:00:00.00,${endTime},PartNum,,0,0,0,,{\\fad(0,${Math.round(fadeDuration * 1000)})}${partLabel}`;

			const styleLine =
				"Style: PartNum, Montserrat, 120, &H00FFFFFF, &H00000000, 1, 0, 1, 4, 0, 2, 100, 100, 100, 1";

			const styleMatch = assContent.match(
				/^\[V4\+ Styles\]\s*\n(Format:[^\n]*\n)((?:Style:[^\n]*\n)*)/m
			);
			let modified: string;
			if (styleMatch) {
				const beforeStyle = assContent.slice(
					0,
					styleMatch.index! + styleMatch[0].length
				);
				const afterStyle = assContent.slice(
					styleMatch.index! + styleMatch[0].length
				);
				modified = beforeStyle + styleLine + "\n" + afterStyle;
			} else {
				modified = assContent;
			}

			const eventsMatch = modified.match(/^\[Events\]\s*\n(Format:[^\n]*\n)/m);
			if (eventsMatch) {
				const insertPos = eventsMatch.index! + eventsMatch[0].length;
				modified =
					modified.slice(0, insertPos) +
					partLine +
					"\n" +
					modified.slice(insertPos);
			}

			await Bun.write(firstSeg.assPath!, modified + "\n");
		}

		const t4 = Date.now();
		await concatSegments(group, partPath, BG_MUSIC_PATH);
		console.log(
			`  [${now()}] Concat + mux done (${((Date.now() - t4) / 1000).toFixed(1)}s)`
		);
		outputPaths.push(partPath);
	}

	console.log(
		`  [${now()}] Total wall time: ${((Date.now() - wallStart) / 1000).toFixed(1)}s`
	);

	for (const path of outputPaths) {
		console.log(`  ${path}`);
	}

	if (options.upload && outputPaths.length > 0) {
		await uploadVideos(outputPaths[0]!, options, uploadMeta);
	}

	return outputPaths;
}

const FLAGS = parseFlags();
if (import.meta.main) {
	run(FLAGS).catch(console.error);
}
