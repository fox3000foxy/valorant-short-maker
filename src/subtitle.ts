import { $ } from "bun";
import { join, resolve } from "node:path";

const ICONS_ROOT = resolve(import.meta.dirname, "..", "icons");
const ICON_MAP = new Map<string, string>();

const PYTHON = join(import.meta.dirname, "..", ".venv", "bin", "python3");

async function _findIconPath(agent: string): Promise<string> {
	const cachedIcon = ICON_MAP.get(agent);
	if (cachedIcon) {
		return cachedIcon;
	}
	const { stdout } = await $`ls ${ICONS_ROOT}`.quiet().nothrow();
	if (!stdout) {
		return join(ICONS_ROOT, `${agent}.png`);
	}
	const files = stdout.toString().trim().split("\n").filter(Boolean);
	const match = files.find(
		(file: string) => file.toLowerCase() === `${agent.toLowerCase()}.png`
	);
	if (match) {
		const full = join(ICONS_ROOT, match);
		ICON_MAP.set(agent, full);
		return full;
	}
	return join(ICONS_ROOT, `${agent}.png`);
}

const COLOR_CACHE = new Map<string, string[]>();

async function _extractColors(agent: string): Promise<string[]> {
	const iconPath = await _findIconPath(agent);
	if (!(await Bun.file(iconPath).exists())) {
		return ["#ffffff", "#cccccc"];
	}

	const { stdout } = await $`${PYTHON} -c ${`
from PIL import Image
from collections import Counter
import json, sys

img = Image.open("${iconPath}").convert("RGBA")
w, h = img.size
pixels = img.load()

colors = []
for y in range(0, h, 2):
    for x in range(0, w, 2):
        r, g, b, a = pixels[x, y]
        if a > 200:
            colors.append((r, g, b))

quantized = Counter()
for r, g, b in colors:
    qr, qg, qb = (r//32)*32, (g//32)*32, (b//32)*32
    quantized[(qr, qg, qb)] += 1

top = [c for c, _ in quantized.most_common(25)]
vibrant = []
for r, g, b in top:
    mx, mn = max(r,g,b), min(r,g,b)
    sat = (mx - mn) / 255 if mx > 0 else 0
    if sat > 0.15 and not (mx > 240 and mn > 200):
        vibrant.append(f"#{r:02x}{g:02x}{b:02x}")

print(json.dumps(vibrant[:6] if vibrant else ["#ffffff", "#cccccc"]))
`}`.quiet();
	const colors: string[] = JSON.parse(stdout.toString().trim());
	return colors;
}

export interface SubtitleOptions {
	fontName?: string;
	fontSize?: number;
	borderSize?: number;
	colors?: string[];
	width?: number;
	height?: number;
}

export class ValorantSubtitle {
	readonly agent: string;
	readonly options: Required<SubtitleOptions>;
	private _colors: string[] | null = null;

	constructor(agent: string, options?: SubtitleOptions) {
		this.agent = agent;
		this.options = {
			fontName: "Arial",
			fontSize: 36,
			borderSize: 2,
			colors: [],
			width: 1080,
			height: 1920,
			...options,
		};
	}

	async getColors(): Promise<string[]> {
		if (this._colors) {
			return this._colors;
		}
		if (this.options.colors.length > 0) {
			this._colors = this.options.colors;
			return this._colors;
		}

		const cached = COLOR_CACHE.get(this.agent);
		if (cached) {
			this._colors = cached;
			return this._colors;
		}

		const colors = await _extractColors(this.agent);
		COLOR_CACHE.set(this.agent, colors);
		this._colors = colors;
		return this._colors;
	}

	async getFFmpegDrawtext(
		text: string,
		position: "top" | "bottom" | "center" = "bottom"
	): Promise<string[]> {
		const colors = await this.getColors();
		const mainColor = colors[0] ?? "#ffffff";
		const borderColor = colors.length > 1 ? colors[1]! : "#000000";

		const height = this.options.height;

		const positions: Record<string, string> = {
			top: `:x=(w-text_w)/2:y=${Math.round(height * 0.05)}`,
			bottom: `:x=(w-text_w)/2:y=h-text_h-${Math.round(height * 0.06)}`,
			center: ":x=(w-text_w)/2:y=(h-text_h)/2",
		};

		const base = `fontfile=${this.options.fontName}:fontsize=${this.options.fontSize}:text='${text}'${positions[position]}`;

		return [
			`drawtext=${base}:fontcolor=${borderColor}:borderw=${this.options.borderSize + 2}:bordercolor=black@0.6`,
			`drawtext=${base}:fontcolor=${mainColor}:borderw=0`,
		];
	}

	async generateASS(lines: string[]): Promise<string> {
		const colors = await this.getColors();
		const primary = _assColor(colors[0] ?? "#ffffff");
		const secondary = _assColor(colors[1] ?? "#000000");
		const tertiary = _assColor(colors.length > 1 ? colors[1]! : "#000000");

		const escaped = lines
			.map((line) => line.replace(/{/g, "\\{").replace(/}/g, "\\}"))
			.join("\\N");

		return `[Script Info]
ScriptType: v4.00+
PlayResX: ${this.options.width}
PlayResY: ${this.options.height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${this.options.fontName},${this.options.fontSize},${primary},${secondary},${tertiary},&H00000000,0,0,0,0,100,100,0,0,1,${this.options.borderSize},0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:30.00,Default,,0,0,0,,${escaped}`;
	}

	generateWordByWordASS(
		captions: WordCaption[],
		colorScheme: "white" | "yellow" = "white"
	): string {
		const primaryColor =
			colorScheme === "yellow" ? _assColor("#FFD700") : _assColor("#FFFFFF");
		const outlineColor = _assColor("#000000");

		const marginV = Math.round(this.options.height * 0.33);
		const events = captions
			.map((word) => {
				const text = word.text
					.replace(/{/g, "\\{")
					.replace(/}/g, "\\}")
					.replace(/\n/g, "\\N");
				const boldTag = word.bold ? "{\\b1}" : "";
				const boldEnd = word.bold ? "{\\b0}" : "";
				return `Dialogue: 0,${_formatTime(word.startTime)},${_formatTime(word.endTime)},Default,,0,0,${marginV},,${boldTag}${text}${boldEnd}`;
			})
			.join("\n");

		return `[Script Info]
ScriptType: v4.00+
PlayResX: ${this.options.width}
PlayResY: ${this.options.height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${this.options.fontName},${this.options.fontSize},${primaryColor},${primaryColor},${outlineColor},&H00000000,-1,0,0,0,100,100,0,0,1,${this.options.borderSize + 1},0,2,10,10,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}`;
	}

	generateTikTokASS(chunks: ChunkCaptions[], agentColors: string[]): string {
		const outlineColor = _assColor(agentColors[1] ?? "#000000");
		const highlightColor = _assColor(agentColors[0] ?? "#FFFFFF");
		const defaultTextColor = _assColor("#FFFFFF");
		const fontSize = this.options.fontSize;
		const marginV = Math.round(this.options.height * 0.4);
		const targetY = this.options.height - marginV;
		const slideAnim = `{\\move(${this.options.width / 2}\\,${this.options.height + 80}\\,${this.options.width / 2}\\,${targetY}\\,0\\,200)}`;
		const fadeAnim = "{\\fad(120\\,80)}";

		const events: string[] = [];

		for (const chunk of chunks) {
			for (let idx = 0; idx < chunk.words.length; idx++) {
				const word = chunk.words[idx]!;
				const nextWord = chunk.words[idx + 1];
				const eventEnd = nextWord ? nextWord.startTime : chunk.endTime;

				const tags = idx === 0 ? slideAnim + fadeAnim : fadeAnim;
				const textParts: string[] = [tags];
				for (let j = 0; j < chunk.words.length; j++) {
					const cur = chunk.words[j]!;
					const escaped = cur.text
						.replace(/{/g, "\\{")
						.replace(/}/g, "\\}")
						.replace(/\n/g, "\\N");
					if (j === idx) {
						const boldTag = cur.bold ? "{\\b1}" : "";
						textParts.push(
							`${boldTag}{\\c${highlightColor}}${escaped}{\\c${defaultTextColor}}`
						);
					} else {
						const boldTag = cur.bold ? "{\\b1}" : "";
						textParts.push(`${boldTag}${escaped}`);
					}
				}
				events.push(
					`Dialogue: 0,${_formatTime(word.startTime)},${_formatTime(eventEnd)},Default,,0,0,${marginV},,${textParts.join(" ")}`
				);
			}
		}

		return `[Script Info]
ScriptType: v4.00+
PlayResX: ${this.options.width}
PlayResY: ${this.options.height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${this.options.fontName},${fontSize},${defaultTextColor},${defaultTextColor},${outlineColor},&H00000000,-1,0,0,0,100,100,0,0,1,${this.options.borderSize + 1},0,2,10,10,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}`;
	}

	generateKaraokeASS(captions: WordCaption[], agentColors: string[]): string {
		const outlineColor = _assColor(agentColors[1] ?? "#000000");
		const highlightColor = _assColor(agentColors[0] ?? "#FFFFFF");
		const defaultTextColor = _assColor("#FFFFFF");

		const marginV = Math.round(this.options.height * 0.33);
		const fontSize = this.options.fontSize;
		const maxCharsPerLine = 30;
		const lines: { text: string; words: WordCaption[] }[] = [];
		let currentLine: WordCaption[] = [];
		let currentChars = 0;

		for (const word of captions) {
			const wordLen = word.text.replace(/\s/g, "").length;
			if (currentChars + wordLen > maxCharsPerLine && currentLine.length > 0) {
				lines.push({
					text: currentLine.map((word) => word.text).join(" "),
					words: currentLine,
				});
				currentLine = [word];
				currentChars = wordLen;
			} else {
				currentLine.push(word);
				currentChars += wordLen;
			}
		}
		if (currentLine.length > 0) {
			lines.push({
				text: currentLine.map((word) => word.text).join(" "),
				words: currentLine,
			});
		}

		const events: string[] = [];

		for (const line of lines) {
			for (let idx = 0; idx < line.words.length; idx++) {
				const word = line.words[idx]!;
				const nextWord = line.words[idx + 1];
				const eventEnd = nextWord ? nextWord.startTime : word.endTime;

				const textParts: string[] = [];
				for (let j = 0; j < line.words.length; j++) {
					const word = line.words[j]!;
					const escaped = word.text
						.replace(/{/g, "\\{")
						.replace(/}/g, "\\}")
						.replace(/\n/g, "\\N");

					if (j === idx) {
						const boldTag = word.bold ? "{\\b1}" : "";
						const boldEnd = word.bold ? "{\\b0}" : "";
						textParts.push(
							`${boldTag}{\\c${highlightColor}}${escaped}{\\r}${boldEnd}`
						);
					} else {
						textParts.push(escaped);
					}
				}

				const text = textParts.join(" ");
				events.push(
					`Dialogue: 0,${_formatTime(word.startTime)},${_formatTime(eventEnd)},Default,,0,0,${marginV},,${text}`
				);
			}
		}

		return `[Script Info]
ScriptType: v4.00+
PlayResX: ${this.options.width}
PlayResY: ${this.options.height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${this.options.fontName},${fontSize},${defaultTextColor},${defaultTextColor},${outlineColor},&H00000000,-1,0,0,0,100,100,0,0,1,${this.options.borderSize + 1},0,2,10,10,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}`;
	}

	static groupTextToWords(
		text: string,
		totalDuration: number,
		highlightIndices?: number[]
	): WordCaption[] {
		const tokens = text.split(/(\s+)/).filter(Boolean);
		const words: { raw: string; isSpace: boolean }[] = [];
		for (const token of tokens) {
			if (/^\s+$/.test(token)) {
				words.push({ raw: token, isSpace: true });
			} else {
				words.push({ raw: token, isSpace: false });
			}
		}

		const meaningful: {
			text: string;
			originalIndex: number;
			charLen: number;
		}[] = [];
		let wordCount = 0;
		let totalChars = 0;
		for (const word of words) {
			if (!word.isSpace) {
				const entry = {
					text: word.raw,
					originalIndex: wordCount,
					charLen: word.raw.length,
				};
				meaningful.push(entry);
				totalChars += word.raw.length;
				wordCount++;
			}
		}

		const overlap = 0.08;
		let cursor = 0;
		return meaningful.map((entry) => {
			const wordDuration = (entry.charLen / totalChars) * totalDuration;
			const start = cursor;
			const end = Math.min(totalDuration, cursor + wordDuration + overlap);
			cursor += wordDuration;
			const bold = highlightIndices
				? highlightIndices.includes(entry.originalIndex)
				: false;
			return {
				text: entry.text,
				startTime: start,
				endTime: end,
				bold,
			};
		});
	}

	async getGradientFilter(
		text: string,
		position: "top" | "bottom" | "center" = "bottom"
	): Promise<string> {
		const filters = await this.getFFmpegDrawtext(text, position);
		return filters.join(",");
	}
}

function _assColor(hex: string): string {
	const hexClean = hex.replace("#", "");
	const red = Number.parseInt(hexClean.slice(0, 2) || "ff", 16);
	const green = Number.parseInt(hexClean.slice(2, 4) || "ff", 16);
	const blue = Number.parseInt(hexClean.slice(4, 6) || "ff", 16);
	return `&H${((blue << 16) | (green << 8) | red).toString(16).padStart(6, "0").toUpperCase()}&`;
}

function _formatTime(seconds: number): string {
	const totalCs = Math.round(seconds * 100);
	const centiseconds = totalCs % 100;
	const totalSec = Math.floor(totalCs / 100);
	const sec = totalSec % 60;
	const min = Math.floor(totalSec / 60) % 60;
	const hour = Math.floor(totalSec / 3600);
	return `${hour.toString().padStart(1, "0")}:${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
}

export interface WordCaption {
	text: string;
	startTime: number;
	endTime: number;
	bold?: boolean;
}

export interface ChunkCaptions {
	words: WordCaption[];
	startTime: number;
	endTime: number;
}
