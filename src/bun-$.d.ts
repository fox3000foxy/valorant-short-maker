declare module "bun" {
	interface ShellOutput {
		stdout: Buffer;
		stderr: Buffer;
		exitCode: number;
	}

	interface ShellPromise extends Promise<ShellOutput> {
		text(): Promise<string>;
		json(): Promise<unknown>;
		arrayBuffer(): Promise<ArrayBuffer>;
		blob(): Promise<Blob>;
		quiet(): ShellPromise;
		nothrow(): ShellPromise;
		stdin(
			data: string | Buffer | ArrayBufferView | ArrayBuffer | Blob | Response
		): ShellPromise;
		env(env: Record<string, string>): ShellPromise;
		cwd(path: string): ShellPromise;
	}

	function $(strings: TemplateStringsArray, ...values: unknown[]): ShellPromise;
}
