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

	console.log(`[${index + 1}/3] TTS ${phrase.agent}...`);
	const tts = new ValorantTTS(phrase.agent, phrase.text);
	await tts.generate(audioPath);

	const duration = await getAudioDuration(audioPath);
	console.log(`  ${duration.toFixed(2)}s`);

	const sub = new ValorantSubtitle(phrase.agent, {
		fontName: FONT_NAME,
		fontSize: FONT_SIZE,
	});
	const colors = await sub.getColors();
	const captions = ValorantSubtitle.groupTextToWords(phrase.text, duration);
	await Bun.write(assPath, sub.generateKaraokeASS(captions, colors));

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
	const totalFrames = Math.ceil(info.duration * 25);
	// zoompan centers natively from image center (default x,y),
	// then scales to CIRCLE_SIZE output
	const circleFilter =
		"[1:v]format=rgba," +
		`zoompan=z='1+0.05*sin(2*PI*on/25*3)':` +
		`d=${totalFrames}:fps=25:s=${CIRCLE_SIZE}x${CIRCLE_SIZE},` +
		"setpts=PTS-STARTPTS[circle]";

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
		`${circleFilter};` +
			`[0:v][circle]overlay=(W-w)/2:${CIRCLE_Y}:format=auto[vid]`,
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
		"volume=3.0",
		"-shortest",
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

	// Concat with concat demuxer (-c copy preserves both video+audio streams)
	console.log("\nConcatenating...");
	const listPath = join(OUT_DIR, "list.txt");
	await Bun.write(
		listPath,
		segments.map((seg) => `file '${seg.videoPath}'`).join("\n")
	);

	const outputPath = join(OUT_DIR, "demo.mp4");
	const proc = Bun.spawn([
		"ffmpeg",
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-f",
		"concat",
		"-safe",
		"0",
		"-i",
		listPath,
		"-c",
		"copy",
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

	console.log(`\nDone: ${outputPath}`);
}

main().catch(console.error);
