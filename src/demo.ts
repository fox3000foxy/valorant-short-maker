import { ValorantTTS } from "./tts.ts";
import { ValorantSubtitle, type ChunkCaptions } from "./subtitle.ts";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Buffer } from "node:buffer";

interface Phrase {
	agent: string;
	text: string;
	duration?: number;
}

function parseScript(): Phrase[] {
	const raw = readFileSync(
		join(import.meta.dirname, "..", "script.txt"),
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

const PHRASES = parseScript();

const OUT_DIR = join(import.meta.dirname, "..", "outputs");
if (!existsSync(OUT_DIR)) {
	mkdirSync(OUT_DIR, { recursive: true });
}
const FONT_NAME = "Montserrat";
const FONT_SIZE = 100;
const INPUT_SIZE = 484;
const CIRCLE_SIZE = 400;
const CIRCLE_BASE_SCALE = CIRCLE_SIZE / INPUT_SIZE;
const CIRCLE_CENTER_Y = 500;
const FPS = 25;
const MAX_ZOOM_VARIATION = 0.2;

interface SegmentInfo {
	agent: string;
	audioPath: string;
	duration: number;
	assPath: string | null;
	iconPath: string;
	videoPath: string;
	scaleExpr: string | null;
}

async function getAudioDuration(path: string): Promise<number> {
	const proc = Bun.spawn([
		"ffprobe",
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

async function computeScaleExpr(
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

	let expr = `${(CIRCLE_BASE_SCALE * (1 + smoothed[totalFrames - 1]! * MAX_ZOOM_VARIATION)).toFixed(6)}`;
	for (let idx = totalFrames - 2; idx >= 0; idx--) {
		const val = (
			CIRCLE_BASE_SCALE *
			(1 + smoothed[idx]! * MAX_ZOOM_VARIATION)
		).toFixed(6);
		expr = `if(eq(n\\,${idx})\\,${val}\\,${expr})`;
	}
	return expr;
}

async function processPhrase(
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
		console.log(
			`[${index + 1}/${PHRASES.length}] pause ${duration.toFixed(1)}s`
		);
		const proc = Bun.spawn([
			"ffmpeg",
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

	console.log(`[${index + 1}/${PHRASES.length}] TTS ${phrase.agent}...`);
	const tts = new ValorantTTS(phrase.agent, phrase.text);
	await tts.generate(audioPath);

	const duration = await getAudioDuration(audioPath);
	console.log(`  ${duration.toFixed(2)}s`);

	const sub = new ValorantSubtitle(phrase.agent, {
		fontName: FONT_NAME,
		fontSize: FONT_SIZE,
	});
	const colors = await sub.getColors();

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

async function renderSegment(info: SegmentInfo): Promise<void> {
	const totalFrames = Math.ceil(info.duration * FPS);

	let filterGraph: string;
	if (info.scaleExpr === null) {
		filterGraph = "[0:v]null[vid]";
	} else {
		const scaleExpr = info.scaleExpr;
		const circleFilter =
			"[1:v]format=rgba," +
			`loop=loop=${totalFrames - 1}:size=1:start=0,` +
			`scale='trunc(iw*${scaleExpr}/2)*2':'trunc(ih*${scaleExpr}/2)*2':eval=frame,` +
			"setpts=PTS-STARTPTS[circle]";
		const assPart = info.assPath
			? `[base]ass=${info.assPath}[vid]`
			: "[base]null[vid]";
		filterGraph =
			`${circleFilter};` +
			`[0:v][circle]overlay=(W-w)/2:${CIRCLE_CENTER_Y}-h/2:format=auto[base];` +
			assPart;
	}

	const inputs = [
		"-f",
		"lavfi",
		"-i",
		`color=c=black:s=1080x1920:r=${FPS}:d=${info.duration}`,
	];
	if (info.scaleExpr !== null) {
		inputs.push("-i", info.iconPath);
	}

	const proc = Bun.spawn([
		"ffmpeg",
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		...inputs,
		"-filter_complex",
		filterGraph,
		"-map",
		"[vid]",
		"-c:v",
		"libx264",
		"-preset",
		"fast",
		"-crf",
		"23",
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

	for (const info of segments) {
		console.log(`  Rendering ${info.agent} (${info.duration.toFixed(2)}s)...`);
		await renderSegment(info);
	}

	console.log("\nMuxing final video with audio...");

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
	const filterGraph =
		`${filterParts.join("")}concat=n=${segCount}:v=1:a=1[vid][aud];` +
		"[aud]volume=0.4[aud_out]";

	const outputPath = join(OUT_DIR, "demo.mp4");
	const proc = Bun.spawn([
		"ffmpeg",
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
		console.error("  Mux error:", stderr);
		throw new Error(`Mux failed (exit ${_exitCode})`);
	}

	console.log(`\nDone: ${outputPath}`);
}

main().catch(console.error);
