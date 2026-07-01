import type { BunFile } from "bun";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const VOICES_ROOT = resolve(import.meta.dirname, "..", "voices");

const AGENTS = readdirSync(VOICES_ROOT, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name);

export function listAgents(): string[] {
	return [...AGENTS];
}

export interface TTSOptions {
	noiseScale?: number;
	noiseW?: number;
	lengthScale?: number;
	pause?: number;
	filterChain?: string;
}

const DEFAULT_OPTIONS: Required<TTSOptions> = {
	noiseScale: 0.333,
	noiseW: 0.1,
	lengthScale: 1.1,
	pause: 0.3,
	filterChain:
		"highpass=f=80,lowpass=f=14000,anlmdn=s=0.0001:p=0.002:r=0.002,loudnorm=I=-20:TP=-2:LRA=7",
};

export class ValorantTTS {
	readonly agent: string;
	readonly text: string;
	readonly options: Required<TTSOptions>;
	readonly _modelPath: string;
	readonly _configPath: string;

	constructor(agent: string, text: string, options?: TTSOptions) {
		if (!AGENTS.includes(agent)) {
			throw new Error(
				`Unknown agent "${agent}". Available: ${AGENTS.join(", ")}`
			);
		}

		this.agent = agent;
		this.text = text;
		this.options = { ...DEFAULT_OPTIONS, ...options };
		this._modelPath = join(VOICES_ROOT, agent, `${agent}.onnx`);
		this._configPath = join(VOICES_ROOT, agent, `${agent}.onnx.json`);

		if (!existsSync(this._modelPath)) {
			throw new Error(`Model not found: ${this._modelPath}`);
		}
		if (!existsSync(this._configPath)) {
			throw new Error(`Config not found: ${this._configPath}`);
		}
	}

	get sampleRate(): number {
		return 22050;
	}

	async generate(outputPath: string): Promise<BunFile> {
		const tmpDir = resolve(
			import.meta.dirname,
			"..",
			".tmp",
			`tts_${this.agent}_${Date.now()}`
		);
		const rawWav = join(tmpDir, "seg.wav");

		try {
			await Bun.$`mkdir -p ${tmpDir}`;

			const piper = Bun.spawn(
				[
					"python3",
					"-m",
					"piper",
					"-m",
					this._modelPath,
					"--output_file",
					rawWav,
					"--noise_scale",
					String(this.options.noiseScale),
					"--noise_w",
					String(this.options.noiseW),
					"--length_scale",
					String(this.options.lengthScale),
				],
				{
					stdin: "pipe",
					stdout: "ignore",
					stderr: "ignore",
				}
			);

			const writer = piper.stdin;
			writer.write(new TextEncoder().encode(this.text));
			writer.end();
			const piperExit = await piper.exited;

			if (piperExit !== 0) {
				throw new Error(`Piper TTS failed with exit code ${piperExit}`);
			}

			const ffmpeg = Bun.spawn(
				[
					"ffmpeg",
					"-i",
					rawWav,
					"-af",
					this.options.filterChain,
					"-ar",
					String(this.sampleRate),
					outputPath,
					"-y",
				],
				{
					stdout: "ignore",
					stderr: "ignore",
				}
			);

			const ffmpegExit = await ffmpeg.exited;

			if (ffmpegExit !== 0) {
				throw new Error(
					`FFmpeg processing failed with exit code ${ffmpegExit}`
				);
			}

			return Bun.file(outputPath);
		} finally {
			await Bun.$`rm -rf ${tmpDir}`;
		}
	}
}
