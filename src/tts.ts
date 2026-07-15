import { $, type BunFile } from "bun";
import { join, resolve } from "node:path";

const VOICES_ROOT = resolve(import.meta.dirname, "..", "voices");
const RELEASE_BASE_URL =
	"https://github.com/fox3000foxy/valorant-short-maker/releases/download/voices";

const PIPER = join(import.meta.dirname, "..", ".venv", "bin", "piper");
const FFMPEG = join(import.meta.dirname, "..", "bin", "ffmpeg", "ffmpeg");

const KNOWN_AGENTS = [
	"astra",
	"breach",
	"brimstone",
	"chamber",
	"clove",
	"cypher",
	"deadlock",
	"fade",
	"gekko",
	"harbor",
	"iso",
	"jett",
	"kayo",
	"killjoy",
	"neon",
	"omen",
	"phoenix",
	"raze",
	"reyna",
	"sage",
	"skye",
	"sova",
	"tejo",
	"viper",
	"vyse",
	"yoru",
] as const;

export type AgentName = (typeof KNOWN_AGENTS)[number];

export function listAgents(): string[] {
	return [...KNOWN_AGENTS];
}

export async function listDownloadedAgents(): Promise<string[]> {
	const { stdout } = await $`ls ${VOICES_ROOT}`.quiet().nothrow();
	if (!stdout) {
		return [];
	}
	return stdout.toString().trim().split("\n").filter(Boolean);
}

function isKnownAgent(agent: string): agent is AgentName {
	return (KNOWN_AGENTS as readonly string[]).includes(agent);
}

function modelPath(agent: string): string {
	return join(VOICES_ROOT, agent, `${agent}.onnx`);
}

function configPath(agent: string): string {
	return join(VOICES_ROOT, agent, `${agent}.onnx.json`);
}

export async function ensureVoice(agentName: string): Promise<void> {
	if (!isKnownAgent(agentName)) {
		throw new Error(
			`Unknown agent "${agentName}". Available: ${KNOWN_AGENTS.join(", ")}`
		);
	}

	if (
		(await Bun.file(modelPath(agentName)).exists()) &&
		(await Bun.file(configPath(agentName)).exists())
	) {
		return;
	}

	await $`mkdir -p ${VOICES_ROOT}`;

	const zipUrl = `${RELEASE_BASE_URL}/${agentName}.zip`;
	const tmpZipPath = join(VOICES_ROOT, `.${agentName}.download.zip`);

	const res = await fetch(zipUrl);
	if (!res.ok) {
		throw new Error(
			`Failed to download voice "${agentName}" (${res.status} ${res.statusText}) from ${zipUrl}`
		);
	}
	const buf = await res.arrayBuffer();
	await Bun.write(tmpZipPath, buf);

	try {
		const { exitCode, stderr } =
			await $`unzip -o ${tmpZipPath} -d ${VOICES_ROOT}`.nothrow();
		if (exitCode !== 0) {
			throw new Error(
				`unzip failed for "${agentName}" (exit ${exitCode}): ${stderr.toString()}`
			);
		}
	} finally {
		await $`rm -f ${tmpZipPath}`;
	}

	if (
		!(
			(await Bun.file(modelPath(agentName)).exists()) &&
			(await Bun.file(configPath(agentName)).exists())
		)
	) {
		throw new Error(
			`Voice "${agentName}" downloaded and extracted, but expected files are missing. Check the zip layout on the release.`
		);
	}
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

	private constructor(agent: string, text: string, options?: TTSOptions) {
		this.agent = agent;
		this.text = text;
		this.options = { ...DEFAULT_OPTIONS, ...options };
		this._modelPath = modelPath(agent);
		this._configPath = configPath(agent);
	}

	static async create(
		agent: string,
		text: string,
		options?: TTSOptions
	): Promise<ValorantTTS> {
		await ensureVoice(agent);
		return new ValorantTTS(agent, text, options);
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
			await $`mkdir -p ${tmpDir}`;

			const segments = this.text.split(/\[(\d+\.?\d*)\]/);
			const inputParts: string[] = [];

			for (let i = 0; i < segments.length; i++) {
				const part = segments[i]!;
				if (i % 2 === 0) {
					const text = part.trim();
					if (!text) {
						continue;
					}
					const wavPath = join(tmpDir, `seg_${i}.wav`);
					const piperProc = Bun.spawn(
						[
							PIPER,
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
						{ stdin: "pipe", stdout: "ignore", stderr: "ignore" }
					);
					const writer = piperProc.stdin;
					writer.write(new TextEncoder().encode(text));
					writer.end();
					const piperExit = await piperProc.exited;
					if (piperExit !== 0) {
						throw new Error(`Piper TTS failed with exit code ${piperExit}`);
					}
					inputParts.push(wavPath);
				} else {
					const dur = Number.parseFloat(part);
					if (dur <= 0) {
						continue;
					}
					const silPath = join(tmpDir, `sil_${i}.wav`);
					await $`${FFMPEG} -y -hide_banner -loglevel error -f lavfi -i anullsrc=r=22050:cl=mono -t ${String(dur)} ${silPath}`.quiet();
					inputParts.push(silPath);
				}
			}

			if (inputParts.length === 0) {
				throw new Error("No audio segments generated from text");
			}

			if (inputParts.length === 1) {
				await $`cp ${inputParts[0]} ${outputPath}`;
			} else {
				const filterParts = inputParts.map((_, i) => `[${i}:a]`).join("");
				const graph = `${filterParts}concat=n=${inputParts.length}:v=0:a=1[out]`;
				const inputs = inputParts.flatMap((p) => ["-i", p]);
				await $`${FFMPEG} -y -hide_banner -loglevel error ${inputs} -filter_complex ${graph} -map [out] ${outputPath}`.quiet();
			}

			return Bun.file(outputPath);
		} finally {
			await $`rm -rf ${tmpDir}`;
		}
	}
}
