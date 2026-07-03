import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import {
	type Phrase,
	type SegmentInfo,
	parseScript,
	concatSegments,
	processPhrase,
	renderSegment,
	applyFisheyeTransition,
	setBgVideoPath,
	setOutDir,
} from "./core.ts";
import { AgentChat } from "./agent-chat.ts";
import { PERSONA as Omen } from "./lore/omen.ts";
import { PERSONA as JETT } from "./lore/jett.ts";
import { PERSONA as PHOENIX } from "./lore/phoenix.ts";

const WHOOSH_PATH = join(import.meta.dirname, "..", "sounds", "whoosh.mp3");

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

const AGENTS = [
	["Omen", Omen],
	["Jett", JETT],
	["Phoenix", PHOENIX],
] as const;

function generateSessionId(): string {
	return randomBytes(8).toString("hex");
}

async function generateScript(context: string): Promise<Phrase[]> {
	console.log("  Generating script with LLM...");
	const actors = AGENTS.toSorted(() => Math.random() - 0.5).slice(0, 3 + Math.floor(Math.random() * 2));
	const phrases: Phrase[] = [];

	for (const [_, persona] of actors) {
		const chat = new AgentChat(persona);
		const line = await chat.genLine(context);
		if (line.trim()) {
			phrases.push({ agent: persona.agent, text: line.trim() });
			if (Math.random() < 0.4) {
				const pauseDur = (0.3 + Math.random() * 0.7).toFixed(1);
				phrases.push({ agent: "pause", text: pauseDur, duration: Number.parseFloat(pauseDur) });
			}
		}
	}

	if (phrases.length === 0) {
		throw new Error("LLM generated no dialogue");
	}

	console.log(`  Generated ${phrases.length} lines\n`);
	for (const p of phrases) {
		if (p.agent === "pause") {
			console.log(`    pause ${p.duration!.toFixed(1)}s`);
		} else {
			console.log(`    ${p.agent}: ${p.text}`);
		}
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
	parts?: number;
	output?: string;
}

const DEFAULT_PARTS = 1;

function parseFlags(): WorkflowOptions {
	const args = Bun.argv.slice(2);
	const opts: WorkflowOptions = {};
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--demo") {
			opts.demo = true;
		} else if (args[i] === "--context" && i + 1 < args.length) {
			opts.context = args[++i]!;
		} else if (args[i] === "--parts" && i + 1 < args.length) {
			opts.parts = Number.parseInt(args[++i]!, 10);
		} else if (args[i] === "--output" && i + 1 < args.length) {
			opts.output = args[++i]!;
		}
	}
	return opts;
}

export async function run(options: WorkflowOptions): Promise<string[]> {
	const parts = options.parts ?? DEFAULT_PARTS;

	let phrases: Phrase[];

	if (options.demo) {
		phrases = parseScript();
		console.log("=== Workflow (demo) ===\n");
	} else if (options.context) {
		console.log("=== Workflow (generate) ===\n");
		setBgVideoPath(pickRandomBgVideo());
		phrases = await generateScript(options.context);
	} else {
		throw new Error("Use --demo or --context <topic>");
	}

	const baseDir = options.output ?? join(import.meta.dirname, "..", "workflow_outputs");
	const sessionId = generateSessionId();
	const sessionDir = join(baseDir, sessionId);
	const assetsDir = join(sessionDir, "assets");

	mkdirSync(assetsDir, { recursive: true });
	setOutDir(assetsDir);

	saveScript(phrases, join(sessionDir, "script.txt"));

	const segments: SegmentInfo[] = [];

	console.log("  Generating segments...\n");
	segments.length = 0;
	for (let i = 0; i < phrases.length; i++) {
		const info = await processPhrase(phrases[i]!, i);
		segments.push(info);
	}
	let bgOffset = 0;
	for (const info of segments) {
		console.log(
			`  Rendering ${info.agent} (${info.duration.toFixed(2)}s)...`
		);
		await renderSegment(info, bgOffset);
		bgOffset += info.duration;
	}

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
		const partPath = join(sessionDir, "output.mp4");

		console.log(`\n  Part ${partNum}/${partGroups.length}...`);

		if (pi === 0 && group[0]) {
			const firstPath = join(assetsDir, "00_intro.mp4");
			console.log("  Applying fisheye intro...");
			await applyFisheyeTransition(group[0]!.videoPath, firstPath);
			group[0]!.videoPath = firstPath;
			group[0]!.audioPath = "";
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

		await concatSegments(group, partPath);
		outputPaths.push(partPath);
	}

	for (const path of outputPaths) {
		console.log(`  ${path}`);
	}

	return outputPaths;
}

const FLAGS = parseFlags();
if (import.meta.main) {
	run(FLAGS).catch(console.error);
}
