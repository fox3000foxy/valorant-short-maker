import { ValorantTTS } from "./tts.ts";
import { ValorantSubtitle } from "./subtitle.ts";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

interface Phrase {
	agent: string;
	text: string;
}

const PHRASES: Phrase[] = [
	{ agent: "raze", text: "This video is a test of subtitle" },
	{ agent: "jett", text: "We can switch between agents" },
	{ agent: "phoenix", text: "Let's see how it works" },
];

const OUT_DIR = mkdtempSync(join(tmpdir(), "demo-"));
const FONT_NAME = "Montserrat";
const FONT_SIZE = 72;
const CIRCLE_SIZE = 300;
const CIRCLE_Y = 180;
const VIBRATE_AMPLITUDE = 0.05;
const VIBRATE_FREQ = 2;

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

interface SegmentInfo {
	agent: string;
	audioPath: string;
	duration: number;
	assPath: string;
	iconPath: string;
	videoPath: string;
}

async function processPhrase(
	phrase: Phrase,
	index: number
): Promise<SegmentInfo> {
	const audioPath = join(OUT_DIR, `${index}_${phrase.agent}.wav`);
	const assPath = join(OUT_DIR, `${index}_${phrase.agent}.ass`);
	const iconPath = join(
		import.meta.dirname,
		"..",
		"icons",
		`${phrase.agent.charAt(0).toUpperCase() + phrase.agent.slice(1)}.png`
	);
	const videoPath = join(OUT_DIR, `${index}_${phrase.agent}.mp4`);

	console.log(`[${index + 1}/3] Generating TTS for ${phrase.agent}...`);
	const tts = new ValorantTTS(phrase.agent, phrase.text);
	await tts.generate(audioPath);

	const duration = await getAudioDuration(audioPath);
	console.log(`  Duration: ${duration.toFixed(2)}s`);

	const sub = new ValorantSubtitle(phrase.agent, {
		fontName: FONT_NAME,
		fontSize: FONT_SIZE,
	});
	const colors = await sub.getColors();
	console.log(`  Colors: ${colors.slice(0, 3).join(", ")}`);

	const captions = ValorantSubtitle.groupTextToWords(phrase.text, duration);
	const ass = sub.generateKaraokeASS(captions, colors);
	await Bun.write(assPath, ass);

	return {
		agent: phrase.agent,
		audioPath,
		duration,
		assPath,
		iconPath,
		videoPath,
	};
}

async function renderSegment(info: SegmentInfo): Promise<void> {
	console.log(`  Rendering ${info.agent} (${info.duration.toFixed(2)}s)...`);

	const totalFrames = Math.ceil(info.duration * 25);

	const proc = Bun.spawn([
		"ffmpeg",
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-f",
		"lavfi",
		"-i",
		`color=c=black:s=1080x1920:r=25:d=${info.duration}`,
		"-i",
		info.iconPath,
		"-i",
		info.audioPath,
		"-filter_complex",
		[
			"[1:v]format=rgba," +
				`loop=loop=${totalFrames}:size=1,` +
				"setpts=N/25/TB," +
				"scale=" +
				`${CIRCLE_SIZE}*(1+${VIBRATE_AMPLITUDE}*sin(n*PI/${VIBRATE_FREQ}))` +
				":-1:eval=frame[circle]",
			`[0:v][circle]overlay=(W-w)/2:${CIRCLE_Y}[base]`,
			`[base]ass=${info.assPath}[vid]`,
		].join(";"),
		"-map",
		"[vid]",
		"-map",
		"2:a",
		"-c:v",
		"libx264",
		"-preset",
		"fast",
		"-crf",
		"23",
		"-c:a",
		"aac",
		"-b:a",
		"192k",
		"-af",
		"volume=2.0",
		"-shortest",
		info.videoPath,
	]);

	const [stderr, _exitCode] = await Promise.all([
		new Response(proc.stderr).text(),
		proc.exited,
	]);

	if (_exitCode !== 0) {
		console.error("  FFmpeg stderr:", stderr);
		throw new Error(`FFmpeg rendering failed (exit ${_exitCode})`);
	}
}

async function main() {
	console.log("=== Valorant Karaoke Demo ===\n");

	const segments: SegmentInfo[] = [];
	for (let i = 0; i < PHRASES.length; i++) {
		const info = await processPhrase(PHRASES[i]!, i);
		segments.push(info);
	}

	// Render each segment with video + audio embedded
	for (const info of segments) {
		await renderSegment(info);
	}

	// Concat all segments using concat filter (reliable audio)
	console.log("\nMuxing final video...");
	const inputs: string[] = [];
	const filterParts: string[] = [];
	for (const seg of segments) {
		inputs.push("-i", seg.videoPath);
		filterParts.push(
			`[${filterParts.length / 2}:v][${filterParts.length / 2}:a]`
		);
	}
	const concatFilter = `${filterParts.join("")}concat=n=${segments.length}:v=1:a=1[vid][aud]`;

	const outputPath = join(OUT_DIR, "demo.mp4");
	const proc = Bun.spawn([
		"ffmpeg",
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		...inputs,
		"-filter_complex",
		concatFilter,
		"-map",
		"[vid]",
		"-map",
		"[aud]",
		"-c:v",
		"libx264",
		"-preset",
		"fast",
		"-crf",
		"23",
		"-c:a",
		"aac",
		"-b:a",
		"192k",
		outputPath,
	]);

	const [stderr, _exitCode] = await Promise.all([
		new Response(proc.stderr).text(),
		proc.exited,
	]);

	if (_exitCode !== 0) {
		console.error("  Mux stderr:", stderr);
		throw new Error("Mux failed");
	}

	console.log("\n=== Done! ===");
	console.log(`Output: ${outputPath}`);
}

main().catch(console.error);
