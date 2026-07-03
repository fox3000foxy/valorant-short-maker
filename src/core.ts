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
	const lines = raw
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
	return expandPhrases(lines);
}

export function expandPhrases(phrases: Phrase[]): Phrase[] {
	return phrases;
}

export interface SegmentInfo {
	agent: string;
	audioPath: string;
	duration: number;
	assPath: string | null;
	iconPath: string;
	videoPath: string;
	scaleExpr: string | null;
}

function stripPauseMarkers(text: string): string {
	return text.replace(/\[\d+\.?\d*\]/g, " ").replace(/\s+/g, " ").trim();
}

export const WHOOSH_PATH = join(import.meta.dirname, "..", "sounds", "whoosh.mp3");

export let OUT_DIR = join(import.meta.dirname, "..", "demo_outputs");
if (!existsSync(OUT_DIR)) {
	mkdirSync(OUT_DIR, { recursive: true });
}

export function setOutDir(path: string) {
	OUT_DIR = path;
	if (!existsSync(OUT_DIR)) {
		mkdirSync(OUT_DIR, { recursive: true });
	}
}

export const FONT_NAME = "Montserrat";
export const FONT_SIZE = 100;
export const INPUT_SIZE = 484;
export const CIRCLE_SIZE = 400;
export const CIRCLE_BASE_SCALE = CIRCLE_SIZE / INPUT_SIZE;
export const CIRCLE_CENTER_Y = 500;
export const FPS = 60;
export const MAX_ZOOM_VARIATION = 0.2;
const EXPORT_VIDEO_PRESET = "medium";
const EXPORT_VIDEO_CRF = "30";
const EXPORT_AUDIO_BITRATE = "128k";

export let BG_VIDEO_PATH = join(
	import.meta.dirname,
	"..",
	"bg-video",
	"clip_005_new_audio.mp4",
);

export function setBgVideoPath(path: string) {
	BG_VIDEO_PATH = path;
}

export const BG_MUSIC_PATH = join(
	import.meta.dirname,
	"..",
	"bg-video",
	"background_music.mp3",
);

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

	const STEP = 1;
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

	const parts: string[] = [];
	for (let g = 0; g < numGroups; g++) {
		const start = g * STEP;
		const val = groupVals[g]!.toFixed(6);
		if (g === 0) {
			parts.push(`lt(n\\,${STEP})*${val}`);
		} else if (g === numGroups - 1) {
			parts.push(`gte(n\\,${start})*${val}`);
		} else {
			const end = Math.min(start + STEP - 1, totalFrames - 1);
			parts.push(`between(n\\,${start}\\,${end})*${val}`);
		}
	}
	const expr = parts.join("+");
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
		const ttsText = phrase.text.replace(/\//g, " ").replace(/[,;]/g, ".");
		const tts = await ValorantTTS.create(phrase.agent, ttsText);
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

	const words = stripPauseMarkers(phrase.text).split(/\s+/).filter(Boolean);
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

let _bgVideoDuration: number | null = null;

async function getBgVideoDuration(): Promise<number> {
	if (_bgVideoDuration !== null) return _bgVideoDuration;
	const p = Bun.spawn([
		process.cwd() + "/bin/ffmpeg/ffprobe",
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		BG_VIDEO_PATH,
	]);
	const out = await new Response(p.stdout).text();
	_bgVideoDuration = Number.parseFloat(out.trim());
	return _bgVideoDuration!;
}

export async function renderSegment(
	info: SegmentInfo,
	bgOffset = 0,
): Promise<void> {
	const isPause = info.agent === "pause";
	const hasTTS = !isPause;
	const totalFrames = hasTTS ? Math.ceil(info.duration * FPS) : 0;

	console.log(`  Rendering ${info.agent}...`);

	const vdur = await getBgVideoDuration();
	const seek = bgOffset % vdur;

	const bgFilter =
		`[0:v]setpts=PTS-STARTPTS,scale=1080:1920,fps=fps=60[bg];` +
		`[0:a]asetpts=PTS-STARTPTS[bga]`;

	let vidLabel = "bg";
	let circlePart = "";

	if (info.scaleExpr !== null && !isPause) {
		vidLabel = "vid";
		const circleFilter =
			"[1:v]format=rgba,fps=fps=60," +
			`loop=loop=${totalFrames - 1}:size=1:start=0,` +
			`scale='trunc(iw*(${info.scaleExpr})/2)*2':'trunc(ih*(${info.scaleExpr})/2)*2':eval=frame,` +
			"setpts=PTS-STARTPTS[circle]";
		const assPart = info.assPath
			? `[base]ass=${info.assPath}[vid]`
			: "[base]null[vid]";
		circlePart =
			`${circleFilter};[bg][circle]overlay=(W-w)/2:${CIRCLE_CENTER_Y}-h/2:format=auto[base];${assPart}`;
	}

	const audioIdx = info.scaleExpr !== null && !isPause ? 2 : 1;
	const mixFilter =
		`[${audioIdx}:a]volume=2.5[tts];[bga]volume=0.5[bga_v];[tts][bga_v]amix=inputs=2:duration=first[aud]`;

	const parts = [bgFilter];
	if (circlePart) parts.push(circlePart);
	parts.push(mixFilter);
	const filterGraph = parts.join(";");

	const ffInputs: string[] = [
		"-ss", String(seek), "-t", String(info.duration), "-i", BG_VIDEO_PATH,
	];
	if (info.scaleExpr !== null && !isPause) {
		ffInputs.push("-i", info.iconPath);
	}
	ffInputs.push("-i", info.audioPath);

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
		EXPORT_VIDEO_PRESET,
		"-crf",
		EXPORT_VIDEO_CRF,
		"-r:v",
		"60",
		"-c:a",
		"libmp3lame",
		"-b:a",
		EXPORT_AUDIO_BITRATE,
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

const BG_CLIPS_DIR = join(import.meta.dirname, "..", "bg-video");
const BG_CLIPS = [
	"clip_000.mp4", "clip_001.mp4", "clip_002.mp4", "clip_003.mp4",
	"clip_004_new_audio.mp4", "clip_005_new_audio.mp4",
];

function wrapText(text: string, maxCharsPerLine: number): string {
	const words = text.split(" ");
	const lines: string[] = [];
	let currentLine = "";

	for (const word of words) {
		const candidate = currentLine ? `${currentLine} ${word}` : word;
		if (candidate.length <= maxCharsPerLine) {
			currentLine = candidate;
		} else {
			if (currentLine) lines.push(currentLine);
			currentLine = word;
		}
	}
	if (currentLine) lines.push(currentLine);

	return lines.join("\\n");
}

export async function generateIntroVideo(context: string, agentNames: string[], outputPath: string): Promise<void> {
	const clip = BG_CLIPS[Math.floor(Math.random() * BG_CLIPS.length)]!;
	const bgPath = join(BG_CLIPS_DIR, clip);
	const esc = (s: string) => s.replace(/'/g, "'\\\\\\''").replace(/:/g, '\\\\:');
	const agents = agentNames.map(a => a.charAt(0).toUpperCase() + a.slice(1)).join(", ");
	const wrappedContext = wrapText(context, 22);

	const proc = Bun.spawn([
		process.cwd() + "/bin/ffmpeg-drawtext/ffmpeg",
		"-y", "-hide_banner", "-loglevel", "error",
		"-ss", "0", "-t", "3", "-i", bgPath,
		"-f", "lavfi", "-i", "anullsrc=r=22050:cl=mono",
		"-filter_complex",
		`[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:5[bg];` +
		`[bg]drawtext=` +
		`fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:` +
		`text='${esc(wrappedContext)}':` +
		`fontcolor=red:fontsize=72:` +
		`x=(w-text_w)/2:y=(h-text_h)/2-60:` +
		`bordercolor=white:borderw=4:` +
		`line_spacing=20,` +
		`setsar=1[fg]`,
		"-map", "[fg]", "-map", "1:a", "-shortest",
		"-c:v", "libx264", "-preset", "fast", "-crf", "23",
		"-c:a", "aac", "-b:a", "128k",
		outputPath,
	]);

	const [stderr, code] = await Promise.all([
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0) {
		console.error("  Intro ffmpeg error:", stderr);
		throw new Error(`Intro generation failed (exit ${code})`);
	}
}

export async function createIntroTransition(
	introPath: string,
	segPath: string,
	whooshPath: string,
	outputPath: string,
): Promise<void> {
	const TRANSITION_DUR = 0.3;
	const introDur = 3;
	const whooshDur = 0.57;

	const proc = Bun.spawn([
		process.cwd() + "/bin/ffmpeg/ffmpeg",
		"-y", "-hide_banner", "-loglevel", "error",
		"-i", introPath,
		"-i", segPath,
		"-i", whooshPath,
		"-filter_complex",
		`[0:v]trim=0:${introDur - TRANSITION_DUR},setpts=PTS-STARTPTS,fps=${FPS},setsar=1[intro_pre];` +
		`[0:v]trim=${introDur - TRANSITION_DUR}:${introDur},setpts=PTS-STARTPTS,fps=${FPS}[intro_tail];` +
		`[1:v]trim=0:${TRANSITION_DUR},setpts=PTS-STARTPTS,fps=${FPS}[seg_head];` +
		`[1:v]trim=${TRANSITION_DUR},setpts=PTS-STARTPTS,fps=${FPS},setsar=1[seg_rest];` +
		`[intro_tail][seg_head]xfade=transition=slideleft:duration=${TRANSITION_DUR}:offset=0[trans];` +
		`[intro_pre][trans][seg_rest]concat=n=3:v=1:a=0[vid];` +
		`[0:a]atrim=0:${introDur - TRANSITION_DUR},asetpts=PTS-STARTPTS[aud_pre];` +
		`[2:a]adelay=${(introDur - TRANSITION_DUR) * 1000}|${(introDur - TRANSITION_DUR) * 1000}[whoosh];` +
		`[1:a]atrim=${TRANSITION_DUR},asetpts=PTS-STARTPTS[aud_post];` +
		`[aud_pre][whoosh]amix=inputs=2:duration=first[aud_mid];` +
		`[aud_mid][aud_post]concat=n=2:v=0:a=1[aud]`,
		"-map", "[vid]",
		"-map", "[aud]",
		"-c:v", "libx264", "-preset", EXPORT_VIDEO_PRESET, "-crf", EXPORT_VIDEO_CRF,
		"-c:a", "libmp3lame", "-b:a", EXPORT_AUDIO_BITRATE,
		outputPath,
	]);

	const [stderr, code] = await Promise.all([
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0) {
		console.error("  Transition ffmpeg error:", stderr);
		throw new Error(`Intro transition failed (exit ${code})`);
	}
}

export async function applyFisheyeTransition(inputPath: string, outputPath: string): Promise<void> {
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
		`[0:a]volume=2[main];[1:a]volume=2[whoosh];[main][whoosh]amix=inputs=2:duration=first:weights=1 1[aud]`,
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
		EXPORT_VIDEO_PRESET,
		"-crf",
		EXPORT_VIDEO_CRF,
		"-c:a",
		"libmp3lame",
		"-b:a",
		EXPORT_AUDIO_BITRATE,
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

export async function concatSegments(
	segments: SegmentInfo[],
	outputPath: string,
	bgMusicPath?: string,
): Promise<void> {
	const segCount = segments.length;
	const hasMusic = bgMusicPath !== undefined && existsSync(bgMusicPath);

	const tmp = join(OUT_DIR, ".concat");
	mkdirSync(tmp, { recursive: true });

	const videoTemp = join(tmp, "vid.mp4");
	const videoInputs: string[] = [];
	for (let i = 0; i < segCount; i++) {
		videoInputs.push("-i", segments[i]!.videoPath);
	}
	const videoSarLabels = segments.map((_, i) => `[${i}:v:0]setsar=1[s${i}]`).join(";");
	const videoLabels = segments.map((_, i) => `[s${i}]`).join("");
	const videoGraph = `${videoSarLabels};${videoLabels}concat=n=${segCount}:v=1:a=0[vid_out]`;
	const vidProc = Bun.spawn([
		process.cwd() + "/bin/ffmpeg/ffmpeg",
		"-y", "-hide_banner", "-loglevel", "error",
		...videoInputs,
		"-filter_complex",
		videoGraph,
		"-map",
		"[vid_out]",
		"-c:v",
		"libx264",
		"-preset",
		EXPORT_VIDEO_PRESET,
		"-crf",
		EXPORT_VIDEO_CRF,
		"-pix_fmt",
		"yuv420p",
		videoTemp,
	]);
	const [vidStderr, vidExit] = await Promise.all([
		new Response(vidProc.stderr).text(),
		vidProc.exited,
	]);
	if (vidExit !== 0) {
		console.error("Concat video error:", vidStderr);
		throw new Error(`Video concat failed (exit ${vidExit})`);
	}

	const audioInputs: string[] = [];
	for (let i = 0; i < segCount; i++) {
		audioInputs.push("-i", segments[i]!.videoPath);
	}
	const audioLabels = segments.map((_, i) => `[${i}:a]`);

	let audioGraph: string;
	let audMap: string;

	if (hasMusic) {
		audioInputs.push("-i", bgMusicPath!);
		audioGraph =
			`${audioLabels.join("")}concat=n=${segCount}:v=0:a=1[voice];` +
			`[voice]asplit=2[voice_out][sc_side];` +
			`[${segCount}:a]volume=0.85[bgm];` +
			`[bgm][sc_side]sidechaincompress=threshold=0.03:ratio=4:attack=5:release=100[bgm_ducked];` +
			`[voice_out][bgm_ducked]amix=inputs=2:duration=first:weights=1 0.5[aud_out]`;
		audMap = "[aud_out]";
	} else {
		audioGraph = `${audioLabels.join("")}concat=n=${segCount}:v=0:a=1[aud_out]`;
		audMap = "[aud_out]";
	}

	const audioTemp = join(tmp, "aud.mp3");
	const audProc = Bun.spawn([
		process.cwd() + "/bin/ffmpeg/ffmpeg",
		"-y", "-hide_banner", "-loglevel", "error",
		...audioInputs,
		"-filter_complex", audioGraph,
		"-map", audMap,
		"-c:a", "libmp3lame",
		"-b:a", EXPORT_AUDIO_BITRATE,
		audioTemp,
	]);
	const [audStderr, audExit] = await Promise.all([
		new Response(audProc.stderr).text(),
		audProc.exited,
	]);
	if (audExit !== 0) {
		console.error("Concat audio error:", audStderr);
		throw new Error(`Audio concat failed (exit ${audExit})`);
	}

	const mux = Bun.spawn([
		process.cwd() + "/bin/ffmpeg/ffmpeg",
		"-y", "-hide_banner", "-loglevel", "error",
		"-i", videoTemp,
		"-i", audioTemp,
		"-map", "0:v:0",
		"-map", "1:a:0",
		"-c:v", "copy",
		"-c:a", "copy",
		"-movflags", "+faststart",
		outputPath,
	]);
	const [muxStderr, muxCode] = await Promise.all([
		new Response(mux.stderr).text(),
		mux.exited,
	]);
	if (muxCode !== 0) {
		console.error("Mux error:", muxStderr);
		throw new Error(`Mux failed (exit ${muxCode})`);
	}
}
