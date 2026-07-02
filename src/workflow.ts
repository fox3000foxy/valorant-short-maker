import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type Phrase,
	type SegmentInfo,
	concatSegments,
	FPS,
	OUT_DIR,
	parseScript,
	processPhrase,
	renderSegment,
} from "./demo.ts";

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

async function generateTitleCard(
	context: string,
	partNum: number,
	totalParts: number,
	outputPath: string
): Promise<void> {
	const duration = 2;
	const label = totalParts > 1 ? `Part ${partNum}/${totalParts}` : "";
	const filters: string[] = [];

	if (context) {
		const safe = context.replace(/'/g, "'\\\\\\'");
		filters.push(
			"drawtext=" +
			`text='${safe}':` +
			"fontcolor=white:fontsize=64:" +
			"x=(w-text_w)/2:y=(h/2)-80:" +
			"fontfile=/usr/share/fonts/truetype/msttcorefonts/Montserrat.ttf"
		);
	}

	if (label) {
		filters.push(
			"drawtext=" +
			`text='${label}':` +
			"fontcolor=white:fontsize=48:" +
			"x=(w-text_w)/2:y=(h/2)+20:" +
			"fontfile=/usr/share/fonts/truetype/msttcorefonts/Montserrat.ttf"
		);
	}

	const filterGraph = filters.length ? filters.join(",") : "null";

	const proc = Bun.spawn([
		process.cwd() + "/bin/ffmpeg/ffmpeg",
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-f",
		"lavfi",
		"-i",
		`color=c=black:s=1080x1920:r=${FPS}:d=${duration}`,
		"-filter_complex",
		filterGraph,
		"-c:v",
		"libx264",
		"-preset",
		"fast",
		"-crf",
		"23",
		outputPath,
	]);

	const [stderr, code] = await Promise.all([
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0) {
		console.error("  Title card error:", stderr);
		throw new Error(`Title card failed (exit ${code})`);
	}
}

export async function run(options: WorkflowOptions): Promise<string[]> {
	const parts = options.parts ?? DEFAULT_PARTS;

	let phrases: Phrase[];

	if (options.demo) {
		phrases = parseScript();
		console.log("=== Workflow (demo) ===\n");
	} else if (options.context) {
		console.log("=== Workflow (generate) ===\n");
		throw new Error("Generation mode not implemented yet");
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

			if (!(existsSync(videoPath) && existsSync(audioPath))) {
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

			const assPath =
				phrase.agent === "pause" ? null : join(outDir, `${i}_${label}.ass`);

			segments.push({
				agent: phrase.agent,
				audioPath,
				duration,
				assPath,
				iconPath: "",
				videoPath,
				scaleExpr: null,
			});
		}

		if (allCached) {
			console.log(`  Using ${segments.length} cached segments\n`);
		} else {
			console.log("  Cached segments not found, generating...\n");
			for (let i = 0; i < phrases.length; i++) {
				const info = await processPhrase(phrases[i]!, i);
				segments.push(info);
			}
			for (const info of segments) {
				console.log(
					`  Rendering ${info.agent} (${info.duration.toFixed(2)}s)...`
				);
				await renderSegment(info);
			}
		}
	}

	const segsPerPart = Math.max(1, Math.ceil(segments.length / parts));
	const partGroups: SegmentInfo[][] = [];
	for (let i = 0; i < segments.length; i += segsPerPart) {
		partGroups.push(segments.slice(i, i + segsPerPart));
	}

	const outputPaths: string[] = [];
	const tmpDir = mkdtempSync(join(tmpdir(), "workflow-"));

	for (let pi = 0; pi < partGroups.length; pi++) {
		const group = partGroups[pi]!;
		const partNum = pi + 1;
		const partPath = join(
			outDir,
			`part_${String(partNum).padStart(2, "0")}.mp4`
		);

		console.log(`\n  Part ${partNum}/${partGroups.length}...`);

		const titleCardPath = join(tmpDir, `title_${partNum}.mp4`);
		await generateTitleCard(
			options.context ?? "Demo",
			partNum,
			partGroups.length,
			titleCardPath
		);

		const allSegments: SegmentInfo[] = [
			{
				agent: "title",
				audioPath: "",
				duration: 2,
				assPath: null,
				iconPath: "",
				videoPath: titleCardPath,
				scaleExpr: null,
			},
			...group,
		];

		const silencePath = join(tmpDir, `silence_${partNum}.wav`);
		const silenceProc = Bun.spawn([
			process.cwd() + "/bin/ffmpeg/ffmpeg",
			"-y",
			"-hide_banner",
			"-loglevel",
			"error",
			"-f",
			"lavfi",
			"-i",
			"anullsrc=r=22050:cl=mono",
			"-t",
			"2",
			silencePath,
		]);
		await silenceProc.exited;

		const adjustedSegments = allSegments.map((seg, si) => {
			if (si === 0) {
				return { ...seg, audioPath: silencePath };
			}
			return seg;
		});

		await concatSegments(adjustedSegments, partPath);
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
