import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type Phrase,
	type SegmentInfo,
	concatSegments,
	OUT_DIR,
	parseScript,
	processPhrase,
	renderSegment,
	setBgVideoPath,
} from "./demo.ts";
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

async function applyFisheyeTransition(inputPath: string, outputPath: string): Promise<void> {
	const inputInfo = Bun.spawnSync([
		process.cwd() + "/bin/ffmpeg/ffprobe",
		"-v", "error",
		"-select_streams", "v:0",
		"-show_entries", "stream=r_frame_rate,nb_frames",
		"-of", "csv=p=0",
		inputPath,
	]);
	const [fpsStr, nbFramesStr] = inputInfo.stdout.toString().trim().split(",");
	const fps = Number.parseInt(fpsStr!.split("/")[0]!, 10);
	const totalFrames = Number.parseInt(nbFramesStr!, 10) || Math.ceil(Number.parseFloat(
		Bun.spawnSync([
			process.cwd() + "/bin/ffmpeg/ffprobe",
			"-v", "error",
			"-show_entries", "format=duration",
			"-of", "default=noprint_wrappers=1:nokey=1",
			inputPath,
		]).stdout.toString().trim()
	) * fps);

	const transitionFrames = Math.floor(0.2 * fps);
	const splitOut = Array.from({ length: transitionFrames + 1 }, (_, i) => `[v${i}]`).join("");
	const splitLine = `[0:v]split=${transitionFrames + 1}${splitOut}`;

	const fishParts: string[] = [splitLine];
	const overlayChain: string[] = [];

	for (let i = 0; i < transitionFrames; i++) {
		const k1 = -(0.5 * (1 - i / transitionFrames));
		const inLabel = `w${i}`;
		const outLabel = `f${i}`;
		const prevLabel = i === 0 ? "base" : `f${i - 1}`;
		fishParts.push(
			`[v${i}]select=eq(n\\,${i}),setpts=PTS-STARTPTS,lenscorrection=cx=0.5:cy=0.25:k1=${k1.toFixed(3)}:k2=0[${inLabel}]`
		);
		overlayChain.push(
			`[${prevLabel}][${inLabel}]overlay=0:0:enable='eq(n\\,${i})'[${outLabel}]`
		);
	}

	const filterGraph = [
		...fishParts,
		`[v${transitionFrames}]null[base]`,
		...overlayChain,
		`[f${transitionFrames - 1}]split=2[tmix_src][tail_src]`,
		`[tmix_src]select=lt(n\\,${transitionFrames}),setpts=PTS-STARTPTS[tmix_in]`,
		`[tmix_in]tmix=frames=3[tmix_out]`,
		`[tail_src]select=gte(n\\,${transitionFrames}),setpts=PTS-STARTPTS[tail_out]`,
		`[tmix_out][tail_out]concat=n=2:v=1:a=0[vid]`,
		`[0:a][1:a]amix=inputs=2:duration=first:weights=1 0.6[aud]`,
	].join(";\n");

	const proc = Bun.spawn([
		process.cwd() + "/bin/ffmpeg/ffmpeg",
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-i",
		inputPath,
		"-i",
		WHOOSH_PATH,
		"-filter_complex",
		filterGraph,
		"-map",
		"[vid]",
		"-map",
		"[aud]",
		"-c:v",
		"libx264",
		"-preset",
		"ultrafast",
		"-crf",
		"28",
		"-c:a",
		"libmp3lame",
		"-b:a",
		"192k",
		"-r:v",
		"60",
		outputPath,
	]);

	const [stderr, code] = await Promise.all([
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0) {
		console.error("  Fisheye transition error:", stderr);
		throw new Error(`Fisheye transition failed (exit ${code})`);
	}
}

export interface WorkflowOptions {
	demo?: boolean;
	context?: string;
	parts?: number;
	outputDir?: string;
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
			opts.outputDir = args[++i]!;
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

	const outDir = options.outputDir ?? OUT_DIR;
	if (!existsSync(outDir)) {
		mkdirSync(outDir, { recursive: true });
	}

	const segments: SegmentInfo[] = [];

	if (options.demo) {
		let allCached = true;
	for (let i = 0; i < phrases.length; i++) {
			const phrase = phrases[i]!;
			const label = phrase.agent === "pause" ? "pause" : phrase.agent;
			const videoPath = join(outDir, `${i}_${label}.mp4`);
			const audioPath = join(outDir, `${i}_${label}.wav`);
			const assPath =
				phrase.agent === "pause" ? null : join(outDir, `${i}_${label}.ass`);

			if (!(existsSync(videoPath) && existsSync(audioPath)) || (assPath && !existsSync(assPath))) {
				allCached = false;
				break;
			}

			const durProc = Bun.spawn([
				process.cwd() + "/bin/ffmpeg/ffprobe",
				"-v",
				"error",
				"-show_entries",
				"format=duration",
				"-of",
				"default=noprint_wrappers=1:nokey=1",
				audioPath,
			]);
			const durOut = await new Response(durProc.stdout).text();
			const duration = Number.parseFloat(durOut.trim());

			const iconPath = join(
				import.meta.dirname,
				"..",
				"icons",
				`${phrase.agent.charAt(0).toUpperCase() + phrase.agent.slice(1)}.png`
			);

			segments.push({
				agent: phrase.agent,
				audioPath,
				duration,
				assPath,
				iconPath,
				videoPath,
				scaleExpr: null,
			});
		}

		if (allCached) {
			console.log(`  Using ${segments.length} cached segments\n`);
		} else {
			console.log("  Cached segments not found, generating...\n");
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
		}
	} else {
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
		const partPath = join(
			outDir,
			`part_${String(partNum).padStart(2, "0")}.mp4`
		);

		console.log(`\n  Part ${partNum}/${partGroups.length}...`);

		if (pi === 0 && group[0]) {
			const firstPath = join(outDir, "00_intro.mp4");
			console.log("  Applying fisheye intro...");
			await applyFisheyeTransition(group[0]!.videoPath, firstPath);
			group[0]!.videoPath = firstPath;
			group[0]!.audioPath = "";
		}

		const firstSeg = group.find((s) => s.assPath !== null);
		if (firstSeg) {
			const assContent = readFileSync(firstSeg.assPath!, "utf-8");
			const fadeDuration = Math.min(1, firstSeg.duration * 0.3);
			const partLabel =
				partGroups.length > 1 ? `Part ${partNum}` : options.context ?? "Demo";

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