import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";

const PUSH_REASON =
	"yum-pi guardrail: pushes to main/master are blocked. Use a feature branch and open a PR instead.";
const WRITE_REASON = "yum-pi guardrail: file writes are limited to the working directory.";

function listPushInvocations(command: string): string[] {
	return (
		command.match(/(^|[;&|\n()])\s*(?:sudo\s+)?git\s+(?:-C\s+[^\s;&|()]+\s+)*push\b[^;&|\n()]*/g) ??
		[]
	);
}

function pushesProtectedBranch(command: string): boolean {
	return listPushInvocations(command).some((invocation) => /\b(main|master)\b/.test(invocation));
}

function expandHome(target: string): string {
	if (target === "~") return nodeOs.homedir();
	if (target.startsWith("~/")) return nodePath.join(nodeOs.homedir(), target.slice(2));
	return target;
}

function isInside(parent: string, child: string): boolean {
	const relative = nodePath.relative(parent, child);
	return relative === "" || (!relative.startsWith("..") && !nodePath.isAbsolute(relative));
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (isToolCallEventType("bash", event)) {
			if (pushesProtectedBranch(event.input.command)) {
				ctx.ui.notify("yum-pi blocked: push to main/master", "warning");
				return { block: true, reason: PUSH_REASON };
			}
			return;
		}

		let target: string | undefined;
		if (isToolCallEventType("write", event)) target = event.input.path;
		else if (isToolCallEventType("edit", event)) target = event.input.path;
		else return;

		const resolved = nodePath.resolve(ctx.cwd, expandHome(target));
		if (isInside(ctx.cwd, resolved)) return;
		if (isInside(nodePath.join(nodeOs.homedir(), ".pi", "agent"), resolved)) return;
		if (isInside(nodeOs.tmpdir(), resolved)) return;

		ctx.ui.notify("yum-pi blocked: write outside working directory", "warning");
		return { block: true, reason: WRITE_REASON };
	});
}
