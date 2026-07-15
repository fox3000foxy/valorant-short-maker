import { join } from "node:path";
import {
	type SegmentInfo,
	applyFisheyeTransition,
	BG_MUSIC_PATH,
	concatSegments,
	OUT_DIR,
	parseScript,
	processPhrase,
	renderSegment,
} from "./core.ts";

export {
	applyFisheyeTransition,
	BG_MUSIC_PATH,
	BG_VIDEO_PATH,
	computeScaleExpr,
	concatSegments,
	FPS,
	getAudioDuration,
	OUT_DIR,
	processPhrase,
	renderSegment,
	setBgVideoPath,
	setOutDir,
	type Phrase,
	type SegmentInfo,
} from "./core.ts";

export const PHRASES = await parseScript();

async function main() {
	console.log("=== Demo ===\n");
	const segments: SegmentInfo[] = [];
	for (let i = 0; i < PHRASES.length; i++) {
		const info = await processPhrase(PHRASES[i]!, i);
		segments.push(info);
	}

	const totalDuration = segments.reduce((sum, s) => sum + s.duration, 0);
	console.log(
		`  Total: ${totalDuration.toFixed(1)}s (${segments.length} segments)\n`
	);

	let bgOffset = 0;
	for (let i = 0; i < segments.length; i++) {
		const info = segments[i]!;
		console.log(`  Rendering ${info.agent} (${info.duration.toFixed(2)}s)...`);
		await renderSegment(info, bgOffset);
		bgOffset += info.duration;
	}

	const firstPath = join(OUT_DIR, "00_intro.mp4");
	console.log("\n  Applying fisheye intro + whoosh...");
	await applyFisheyeTransition(segments[0]!.videoPath, firstPath);
	segments[0]!.videoPath = firstPath;

	console.log("\nMuxing final video with audio...");

	const bgMusic = (await Bun.file(BG_MUSIC_PATH).exists())
		? BG_MUSIC_PATH
		: undefined;
	const outputPath = join(OUT_DIR, "demo.mp4");
	await concatSegments(segments, outputPath, bgMusic);

	console.log(`\nDone: ${outputPath}`);
}

if (import.meta.main) {
	main().catch(console.error);
}
