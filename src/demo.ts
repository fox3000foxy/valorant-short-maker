import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ValorantSubtitle, type ChunkCaptions } from "./subtitle.ts";
import { ValorantTTS } from "./tts.ts";

import * as dotenv from 'dotenv';
dotenv.config();
const useCachedFiles = process.env.CACHED_DEMO_FILES === "1";

export interface Phrase {
	agent: string;
	text: string;
	duration?: number;
}

export function parseScript(): Phrase[] {
	const raw = readFileSync(
		join(import.meta.dirname, "..", "demo_script.txt"),
		"utf-8"
	);
	return raw
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const sep = line.indexOf(":");
			if (sep === -1) {
				throw new Error(`Invalid script line: ${line}`);
			}
			const agent = line.slice(0, sep).trim().toLowerCase();
			const text = line.slice(sep + 1).trim();
			if (agent === "pause") {
				return { agent, text, duration: Number.parseFloat(text) || 1.0 };
			}
			return { agent, text };
		});
}

export const PHRASES = parseScript();

export const OUT_DIR = join(import.meta.dirname, "..", "demo_outputs");
if (!existsSync(OUT_DIR)) {
	mkdirSync(OUT_DIR, { recursive: true });
}
export const FONT_NAME = "Montserrat";
export const FONT_SIZE = 100;
export const INPUT_SIZE = 484;
export const CIRCLE_SIZE = 400;
export const CIRCLE_BASE_SCALE = CIRCLE_SIZE / INPUT_SIZE;
export const CIRCLE_CENTER_Y = 500;
export const FPS = 25;
export const MAX_ZOOM_VARIATION = 0.2;

export const BG_VIDEO_PATH = join(
	import.meta.dirname,
	"..",
	"bg-video",
	"no_voice_005.mp4",
);
export const BG_MUSIC_PATH = join(
	import.meta.dirname,
	"..",
	"bg-video",
	"background_music.mp3",
);

export interface SegmentInfo {
	agent: string;
	audioPath: string;
	duration: number;
	assPath: string | null;
	iconPath: string;
	videoPath: string;
	scaleExpr: string | null;
}

export async function getAudioDuration(path: string): Promise<number> {
	const proc = Bun.spawn([
		process.cwd() + "/bin/ffmpeg/ffprobe",
		"-v",
		"error",
		"-show_entries",
		"format=duration",
		"-of",
		"default=noprint_wrappers=1:nokey=1",
		path,
	]);
	const out = await new Response(proc.stdout).text();
	return Number.parseFloat(out.trim());
}

export async function computeScaleExpr(
	wavPath: string,
	duration: number
): Promise<string> {
	const wav = Buffer.from(await Bun.file(wavPath).arrayBuffer());
	const sampleRate = wav.readUInt32LE(24);
	const totalFrames = Math.ceil(duration * FPS);
	const frameSize = Math.floor(sampleRate / FPS);
	const envelope = new Float64Array(totalFrames);

	for (let frame = 0; frame < totalFrames; frame++) {
		let sumSq = 0;
		let frameCount = 0;
		const startByte = 44 + frame * frameSize * 2;
		const endByte = Math.min(startByte + frameSize * 2, wav.length);
		for (let byte = startByte; byte < endByte; byte += 2) {
			const sample = wav.readInt16LE(byte);
			sumSq += (sample / 32768) ** 2;
			frameCount++;
		}
		envelope[frame] = frameCount > 0 ? Math.sqrt(sumSq / frameCount) : 0;
	}

	let maxRms = 0;
	for (const val of envelope) {
		if (val > maxRms) {
			maxRms = val;
		}
	}
	if (maxRms > 0) {
		for (let frame = 0; frame < totalFrames; frame++) {
			envelope[frame]! /= maxRms;
		}
	}

	const smoothed = new Float64Array(totalFrames);
	for (let frame = 0; frame < totalFrames; frame++) {
		let sum = 0;
		let count = 0;
		for (let offset = -1; offset <= 1; offset++) {
			const idx = frame + offset;
			if (idx >= 0 && idx < totalFrames) {
				sum += envelope[idx]!;
				count++;
			}
		}
		smoothed[frame] = sum / count;
	}

	const STEP = 8;
	const numGroups = Math.ceil(totalFrames / STEP);
	const groupVals = new Float64Array(numGroups);
	for (let g = 0; g < numGroups; g++) {
		let mx = 0;
		const start = g * STEP;
		const end = Math.min(start + STEP, totalFrames);
		for (let f = start; f < end; f++) {
			if (smoothed[f]! > mx) mx = smoothed[f]!;
		}
		groupVals[g] = CIRCLE_BASE_SCALE * (1 + mx * MAX_ZOOM_VARIATION);
	}

	let expr = `${groupVals[numGroups - 1]!.toFixed(6)}`;
	for (let g = numGroups - 2; g >= 0; g--) {
		const start = g * STEP;
		const end = Math.min(start + STEP - 1, totalFrames - 1);
		expr = `if(between(n\\,${start}\\,${end})\\,${groupVals[g]!.toFixed(6)}\\,${expr})`;
	}
	return expr;
}

export async function processPhrase(
	phrase: Phrase,
	index: number
): Promise<SegmentInfo> {
	const isPause = phrase.agent === "pause";
	const label = isPause ? "pause" : phrase.agent;
	const audioPath = join(OUT_DIR, `${index}_${label}.wav`);
	const assPath = isPause ? null : join(OUT_DIR, `${index}_${label}.ass`);
	const iconPath = join(
		import.meta.dirname,
		"..",
		"icons",
		`${phrase.agent.charAt(0).toUpperCase() + phrase.agent.slice(1)}.png`
	);
	const videoPath = join(OUT_DIR, `${index}_${label}.mp4`);

	if (isPause) {
		const duration = phrase.duration ?? 1.0;
		console.log(`  pause ${duration.toFixed(1)}s`);
		const proc = Bun.spawn([
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
			String(duration),
			audioPath,
		]);
		await proc.exited;
		return {
			agent: "pause",
			audioPath,
			duration,
			assPath: null,
			iconPath,
			videoPath,
			scaleExpr: null,
		};
	}

	const cachedAudioOk = useCachedFiles && existsSync(audioPath);
	const cachedAssOk = useCachedFiles && assPath !== null && existsSync(assPath);

	if (cachedAudioOk) {
		console.log(`  TTS ${phrase.agent}... (cached)`);
	} else {
		console.log(`  TTS ${phrase.agent}...`);
		const tts = new ValorantTTS(phrase.agent, phrase.text);
		await tts.generate(audioPath);
	}

	const duration = await getAudioDuration(audioPath);
	console.log(`  ${duration.toFixed(2)}s`);

	const sub = new ValorantSubtitle(phrase.agent, {
		fontName: FONT_NAME,
		fontSize: FONT_SIZE,
	});
	const colors = await sub.getColors();

	if (cachedAssOk) {
		const scaleExpr = await computeScaleExpr(audioPath, duration);
		return {
			agent: phrase.agent,
			audioPath,
			duration,
			assPath,
			iconPath,
			videoPath,
			scaleExpr,
		};
	}

	const words = phrase.text.split(/\s+/).filter(Boolean);
	const numChunks = Math.min(3, words.length);
	const chunkSize = Math.ceil(words.length / numChunks);
	const chunks: string[][] = [];
	for (let i = 0; i < words.length; i += chunkSize) {
		chunks.push(words.slice(i, i + chunkSize));
	}

	const chunkDuration = duration / chunks.length;
	const chunkedCaptions: ChunkCaptions[] = [];
	for (let ci = 0; ci < chunks.length; ci++) {
		const chunkStart = ci * chunkDuration;
		const chunkEnd = (ci + 1) * chunkDuration;
		const chunkWords = chunks[ci]!;
		const wordDuration = chunkDuration / chunkWords.length;
		const captions = chunkWords.map((text, wi) => ({
			text,
			startTime: chunkStart + wi * wordDuration,
			endTime: chunkStart + (wi + 1) * wordDuration,
		}));
		chunkedCaptions.push({
			words: captions,
			startTime: chunkStart,
			endTime: chunkEnd,
		});
	}

	await Bun.write(assPath!, sub.generateTikTokASS(chunkedCaptions, colors));

	const scaleExpr = await computeScaleExpr(audioPath, duration);

	return {
		agent: phrase.agent,
		audioPath,
		duration,
		assPath,
		iconPath,
		videoPath,
		scaleExpr,
	};
}

export async function renderSegment(
	info: SegmentInfo,
	bgOffset = 0,
): Promise<void> {
	const totalFrames = Math.ceil(info.duration * FPS);

	const trimFilter =
		`[0:v]trim=start=${bgOffset}:duration=${info.duration},setpts=PTS-STARTPTS,scale=1080:1920[bg];` +
		`[0:a]atrim=start=${bgOffset}:duration=${info.duration},asetpts=PTS-STARTPTS[bga]`;

	const isPause = info.agent === "pause";
	const hasTTS = !isPause;

	let vidLabel = "bg";
	let circlePart = "";

	if (info.scaleExpr !== null) {
		vidLabel = "vid";
		const circleFilter =
			"[1:v]format=rgba," +
			`loop=loop=${totalFrames - 1}:size=1:start=0,` +
			`scale='trunc(iw*${info.scaleExpr}/2)*2':'trunc(ih*${info.scaleExpr}/2)*2':eval=frame,` +
			"setpts=PTS-STARTPTS[circle]";
		const assPart = info.assPath
			? `[base]ass=${info.assPath}[vid]`
			: "[base]null[vid]";
		circlePart =
			`${circleFilter};[bg][circle]overlay=(W-w)/2:${CIRCLE_CENTER_Y}-h/2:format=auto[base];${assPart}`;
	}

	let mixFilter: string;
	if (hasTTS) {
		mixFilter =
			`[2:a]volume=0.4[tts];[bga]volume=0.5[bga_v];[tts][bga_v]amix=inputs=2:duration=first[aud]`;
	} else {
		mixFilter = `[bga]volume=0.5[aud]`;
	}

	const parts = [trimFilter];
	if (circlePart) parts.push(circlePart);
	parts.push(mixFilter);
	const filterGraph = parts.join(";");

	const ffInputs: string[] = ["-i", BG_VIDEO_PATH];
	if (info.scaleExpr !== null) {
		ffInputs.push("-i", info.iconPath);
	}
	if (hasTTS) {
		ffInputs.push("-i", info.audioPath);
	}

	const proc = Bun.spawn([
		process.cwd() + "/bin/ffmpeg/ffmpeg",
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		...ffInputs,
		"-filter_complex",
		filterGraph,
		"-map",
		`[${vidLabel}]`,
		"-map",
		"[aud]",
		"-c:v",
		"libx264",
		"-preset",
		"fast",
		"-crf",
		"23",
		"-c:a",
		"libmp3lame",
		"-b:a",
		"192k",
		info.videoPath,
	]);

	const [stderr, _exitCode] = await Promise.all([
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (_exitCode !== 0) {
		console.error("  FFmpeg error:", stderr);
		throw new Error(`Render failed (exit ${_exitCode})`);
	}
}

async function main() {
	console.log("=== Demo ===\n");
	const segments: SegmentInfo[] = [];
	for (let i = 0; i < PHRASES.length; i++) {
		const info = await processPhrase(PHRASES[i]!, i);
		segments.push(info);
	}

	let bgOffset = 0;
	for (const info of segments) {
		console.log(`  Rendering ${info.agent} (${info.duration.toFixed(2)}s)...`);
		await renderSegment(info, bgOffset);
		bgOffset += info.duration;
	}

	console.log("\nMuxing final video with audio...");

	const bgMusic = existsSync(BG_MUSIC_PATH) ? BG_MUSIC_PATH : undefined;
	const outputPath = join(OUT_DIR, "demo.mp4");
	await concatSegments(segments, outputPath, bgMusic);

	console.log(`\nDone: ${outputPath}`);
}

export async function concatSegments(
	segments: SegmentInfo[],
	outputPath: string,
	bgMusicPath?: string,
): Promise<void> {
	const inputs: string[] = [];
	const filterParts: string[] = [];
	for (const seg of segments) {
		inputs.push("-i", seg.videoPath);
		inputs.push("-i", seg.audioPath);
	}
	for (let i = 0; i < segments.length; i++) {
		filterParts.push(`[${i * 2}:v]`);
		filterParts.push(`[${i * 2 + 1}:a]`);
	}

	const segCount = segments.length;
	const hasMusic = bgMusicPath !== undefined && existsSync(bgMusicPath);

	let filterGraph: string;
	if (hasMusic) {
		inputs.push("-i", bgMusicPath!);
		filterGraph =
			`${filterParts.join("")}concat=n=${segCount}:v=1:a=1[vid][aud];` +
			`[${segCount * 2}:a]volume=0.33[bgm];` +
			"[aud][bgm]amix=inputs=2:duration=first[aud_out]";
	} else {
		filterGraph = `${filterParts.join("")}concat=n=${segCount}:v=1:a=1[vid][aud_out]`;
	}

	const proc = Bun.spawn([
		process.cwd() + "/bin/ffmpeg/ffmpeg",
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		...inputs,
		"-filter_complex",
		filterGraph,
		"-map",
		"[vid]",
		"-map",
		"[aud_out]",
		"-c:v",
		"libx264",
		"-preset",
		"fast",
		"-crf",
		"23",
		"-c:a",
		"libmp3lame",
		"-b:a",
		"192k",
		"-movflags",
		"+faststart",
		outputPath,
	]);

	const [stderr, _exitCode] = await Promise.all([
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (_exitCode !== 0) {
		console.error("  Concat error:", stderr);
		throw new Error(`Concat failed (exit ${_exitCode})`);
	}
}

if (import.meta.main) {
	main().catch(console.error);
}
