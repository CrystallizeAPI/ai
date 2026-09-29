import type { AnalyticsEvent } from "../contracts/analytics-tracker";
import { buildSelectionEvent, selectionOutcome, type JevSelectingTool } from "./analytics";

type Selection = { picked: { name: string; probability: number }[]; qualified: number };

/**
 * Records one Jev selection two ways and returns the Plausible event for the tool to hand back:
 *
 *   - the event (`/jev/{tool}/{outcome}`) gives the dashboard ratios: how often the cap bites, how often Jev fails
 *   - one JSON log line gives Workers Logs the detail Plausible cannot hold on Growth: what was picked, with what
 *     scores, out of how many candidates, and how long Jev took
 *
 * The intent or task text is never logged: it is the caller's words about their own tenant.
 */
export function reportSelection(
    tool: JevSelectingTool,
    result: Selection | "failed",
    candidates: number,
    ms: number,
): AnalyticsEvent {
    const outcome = selectionOutcome(
        result === "failed" ? "failed" : { picked: result.picked.length, qualified: result.qualified },
    );
    console.log(
        JSON.stringify({
            event: "jev_selection",
            tool,
            outcome,
            candidates,
            qualified: result === "failed" ? 0 : result.qualified,
            picked:
                result === "failed"
                    ? []
                    : result.picked.map((p) => ({ name: p.name, probability: Math.round(p.probability * 100) / 100 })),
            ms,
        }),
    );
    return buildSelectionEvent(tool, outcome);
}
