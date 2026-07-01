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
const RESOLUTION = "1080:1920";
const FONT_NAME = "Montserrat";
const FONT_SIZE = 48;

async function getAudioDuration(path: string): Promise<number> {
	const proc = Bun.spawn([
		"ffprobe",
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		path,
	]);
	const out = await new Response(proc.stdout).text();
	return Number.parseFloat(out.trim());
}

type SegmentInfo = {
	agent: string;
	audioPath: string;
	duration: number;
	assPath: string;
	iconPath: string;
	videoPath: string;
};

async function processPhrase(
	phrase: Phrase,
	index: number,
): Promise<SegmentInfo> {
	const audioPath = join(OUT_DIR, `${index}_${phrase.agent}.wav`);
	const assPath = join(OUT_DIR, `${index}_${phrase.agent}.ass`);
	const iconPath = join(
		import.meta.dirname,
		"..",
		"icons",
		`${phrase.agent.charAt(0).toUpperCase() + phrase.agent.slice(1)}.png`,
	);
	const videoPath = join(OUT_DIR, `${index}_${phrase.agent}.mp4`);

	// Generate TTS audio
	console.log(`[${index + 1}/3] Generating TTS for ${phrase.agent}...`);
	const tts = new ValorantTTS(phrase.agent, phrase.text);
	await tts.generate(audioPath);

	// Get audio duration
	const duration = await getAudioDuration(audioPath);
	console.log(`  Duration: ${duration.toFixed(2)}s`);

	// Get agent colors
	const sub = new ValorantSubtitle(phrase.agent, {
		fontName: FONT_NAME,
		fontSize: FONT_SIZE,
	});
	const colors = await sub.getColors();
	console.log(`  Colors: ${colors.slice(0, 3).join(", ")}`);

	// Generate word captions (proportional to audio duration)
	const captions = ValorantSubtitle.groupTextToWords(phrase.text, duration);

	// Generate karaoke ASS
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
	console.log(`  Rendering ${info.agent} segment (${info.duration.toFixed(2)}s)...`);

	const proc = Bun.spawn([
		"ffmpeg",
		"-y", "-hide_banner", "-loglevel", "error",
		"-f", "lavfi",
		"-i", `color=c=black:s=${RESOLUTION}:d=${info.duration}`,
		"-i", info.iconPath,
		"-filter_complex",
		[
			`[1:v]format=rgba,zoompan=` +
			`z='1+0.03*sin(2*PI*on/25/0.6)'` +
			`:d=${Math.ceil(info.duration * 25)}` +
			`:fps=25` +
			`:x='iw/2*(1-1/z)'` +
			`:y='ih/2*(1-1/z)'` +
			`:s=250x250,setpts=PTS-STARTPTS[circle]`,
			`[0:v][circle]overlay=(W-w)/2:80[base]`,
			`[base]ass=${info.assPath}[vid]`,
		].join(";"),
		"-map", "[vid]",
		"-c:v", "libx264",
		"-preset", "fast",
		"-crf", "23",
		"-t", info.duration.toString(),
		info.videoPath,
	]);
	const out = await new Response(proc.stderr).text();
	if (proc.exitCode !== 0) {
		console.error("  FFmpeg error:", out);
		throw new Error("FFmpeg rendering failed");
	}
}

async function main() {
	console.log("=== Valorant Karaoke Demo ===\n");

	// Process all phrases
	const segments: SegmentInfo[] = [];
	for (let i = 0; i < PHRASES.length; i++) {
		const info = await processPhrase(PHRASES[i]!, i);
		segments.push(info);
	}

	// Render each segment
	for (const info of segments) {
		await renderSegment(info);
	}

	// Create concat files
	console.log("\nConcatenating...");
	const videoListPath = join(OUT_DIR, "videos.txt");
	const audioListPath = join(OUT_DIR, "audios.txt");
	await Bun.write(
		videoListPath,
		segments.map((s) => `file '${s.videoPath}'`).join("\n"),
	);
	await Bun.write(
		audioListPath,
		segments.map((s) => `file '${s.audioPath}'`).join("\n"),
	);

	const finalVideo = join(OUT_DIR, "raw_video.mp4");
	const finalAudio = join(OUT_DIR, "combined.wav");

	// Concat video segments
	const videoProc = Bun.spawn([
		"ffmpeg",
		"-y", "-hide_banner", "-loglevel", "error",
		"-f", "concat",
		"-safe", "0",
		"-i", videoListPath,
		"-c", "copy",
		finalVideo,
	]);
	await new Response(videoProc.stderr).text();

	// Concat audio
	const audioProc = Bun.spawn([
		"ffmpeg",
		"-y", "-hide_banner", "-loglevel", "error",
		"-f", "concat",
		"-safe", "0",
		"-i", audioListPath,
		"-c", "copy",
		finalAudio,
	]);
	await new Response(audioProc.stderr).text();

	// Final mux
	const outputPath = join(OUT_DIR, "demo.mp4");
	console.log(`\nFinal mux to ${outputPath}...`);
	const muxProc = Bun.spawn([
		"ffmpeg",
		"-y", "-hide_banner", "-loglevel", "error",
		"-i", finalVideo,
		"-i", finalAudio,
		"-c:v", "copy",
		"-c:a", "aac",
		"-shortest",
		outputPath,
	]);
	await new Response(muxProc.stderr).text();

	console.log(`\n=== Done! ===`);
	console.log(`Output: ${outputPath}`);
}

main().catch(console.error);
