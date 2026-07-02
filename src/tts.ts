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
	lengthScale: 1.3,
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

		try {
			await Bun.$`mkdir -p ${tmpDir}`;

			const segments = this.text.split(/\[(\d+\.?\d*)\]/);
			const inputParts: string[] = [];
			const concatInputs: string[] = [];

			await Bun.$`mkdir -p ${tmpDir}`;

			for (let i = 0; i < segments.length; i++) {
				const part = segments[i]!;
				if (i % 2 === 0) {
					const text = part.trim();
					if (!text) continue;
					const wavPath = join(tmpDir, `seg_${i}.wav`);
					const piper = Bun.spawn(
						[
							process.cwd() + "/.venv/bin/piper",
							"-m",
							this._modelPath,
							"--output_file",
							wavPath,
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
					writer.write(new TextEncoder().encode(text));
					writer.end();
					const piperExit = await piper.exited;
					if (piperExit !== 0) {
						throw new Error(`Piper TTS failed with exit code ${piperExit}`);
					}
					inputParts.push(wavPath);
				} else {
					const dur = Number.parseFloat(part);
					if (dur <= 0) continue;
					const silPath = join(tmpDir, `sil_${i}.wav`);
					const silProc = Bun.spawn([
						process.cwd() + "/bin/ffmpeg/ffmpeg",
						"-y", "-hide_banner", "-loglevel", "error",
						"-f", "lavfi", "-i", `anullsrc=r=22050:cl=mono`,
						"-t", String(dur),
						silPath,
					]);
					const silExit = await silProc.exited;
					if (silExit !== 0) {
						throw new Error(`Silence generation failed (exit ${silExit})`);
					}
					inputParts.push(silPath);
				}
			}

			if (inputParts.length === 0) {
				throw new Error("No audio segments generated from text");
			}

			if (inputParts.length === 1) {
				await Bun.$`cp ${inputParts[0]} ${outputPath}`;
			} else {
				const filterParts = inputParts.map((_, i) => `[${i}:a]`).join("");
				const graph = `${filterParts}concat=n=${inputParts.length}:v=0:a=1[out]`;
				const ffArgs = [
					process.cwd() + "/bin/ffmpeg/ffmpeg",
					"-y", "-hide_banner", "-loglevel", "error",
					...inputParts.flatMap((p) => ["-i", p]),
					"-filter_complex", graph,
					"-map", "[out]",
					outputPath,
				];
				const ff = Bun.spawn(ffArgs);
				const ffExit = await ff.exited;
				if (ffExit !== 0) {
					throw new Error(`Audio concat failed (exit ${ffExit})`);
				}
			}

			return Bun.file(outputPath);
		} finally {
			await Bun.$`rm -rf ${tmpDir}`;
		}
	}
}
