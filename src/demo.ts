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
	audioPath: string;
	duration: number;
	assPath: string;
	iconPath: string;
	colors: string[];
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
	const videoPath = join(OUT_DIR, `${index}_${phrase.agent}.mp4");

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
		audioPath,
		duration,
		assPath,
		iconPath,
		colors,
		videoPath,
	};
}

async function renderSegment(
	info: SegmentInfo,
): Promise<void> {
	console.log(`  Rendering segment (${info.duration.toFixed(2)}s)...`);

	// Create animated agent circle with subtle zoom via zoompan
	const circleAnimPath = join(OUT_DIR, `${info.agent}_anim_%03d.png`);
	const circleAnimDir = join(OUT_DIR, `${info.agent}_anim_frames`);
	Bun.spawnSync(["mkdir", "-p", circleAnimDir]);

	// Generate zoom frames: subtle breathing effect
	const totalFrames = Math.ceil(info.duration * 25);
	for (let f = 0; f < totalFrames; f++) {
		const t = f / 25;
		const zoom = 1 + 0.03 * Math.sin(2 * Math.PI * t / 0.6);
		const scale = Math.round(250 * zoom);
		const framePath = join(circleAnimDir, `frame_${f.toString().padStart(4, "0")}.png`);
		Bun.spawnSync([
			"ffmpeg",
			"-y", "-hide_banner", "-loglevel", "error",
			"-i", info.iconPath,
			"-vf", `scale=${scale}:${scale}:force_original_aspect_ratio=decrease,pad=${scale}:${scale}:(ow-iw)/2:(oh-ih)/2:color=black@0`,
			"-frames:v", "1",
			framePath,
		]);
	}

	// Convert frames to video
	const circleVideo = join(OUT_DIR, `${info.agent}_circle.mp4`);
	Bun.spawnSync([
		"ffmpeg",
		"-y", "-hide_banner", "-loglevel", "error",
		"-framerate", "25",
		"-i", join(circleAnimDir, "frame_%04d.png"),
		"-c:v", "libx264",
		"-pix_fmt", "yuv420p",
		"-vf", "scale=250:250",
		circleVideo,
	]);

	// Render final segment with overlay
	const proc = Bun.spawn([
		"ffmpeg",
		"-y", "-hide_banner", "-loglevel", "error",
		"-f", "lavfi",
		"-i", `color=c=black:s=${RESOLUTION}:d=${info.duration}`,
		"-i", circleVideo,
		"-filter_complex",
		`[1:v]format=rgba,setpts=PTS-STARTPTS[circle];` +
		`[0:v][circle]overlay=(W-w)/2:80:shortest=1[vid]`,
		"-map", "[vid]",
		"-c:v", "libx264",
		"-preset", "fast",
		"-crf", "23",
		"-t", info.duration.toString(),
		info.videoPath,
	]);
	const output = await new Response(proc.stderr).text();
	if (proc.exitCode !== 0) {
		console.error("  FFmpeg error:", output);
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
	console.log(`Temp dir: ${OUT_DIR}`);

	// Cleanup circle frames
	for (const info of segments) {
		const dir = join(OUT_DIR, `${info.agent}_anim_frames`);
		Bun.spawnSync(["rm", "-rf", dir]);
	}
}

main().catch(console.error);
