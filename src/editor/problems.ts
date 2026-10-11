/**
 * The content check's problems as editors read them: which component, which setting, what's wrong
 * ("Hero › Heading is required"), with the node to select. Shown by the "Content: n problems" badge.
 * Pure.
 */
import type { ComponentManifest, FieldDefinition, PropDefinition, TapestryDocument, TapestryNode } from '../types.js';
import type { ValidationIssue } from '../validate.js';

export interface Problem {
	/** The component to select, or null for page-level problems. */
	nodeId: string | null;
	/** The component's name (its editor label, else the component's), or "Page". */
	component: string;
	/** What's wrong, e.g. "Heading is required". */
	text: string;
}

const NODE_STEP = /^(?:root|\.children)\[(\d+)\]/;
const PROP_STEP = /^\.props\.([A-Za-z_$][\w$]*)/;
const ITEM_STEP = /^\[(\d+)\]/;
const FIELD_STEP = /^\.([A-Za-z_$][\w$]*)/;

/** One issue → a problem. `path` is the validator's (`root[2].children[0].props.items[1].question`). */
export function describeIssue(doc: TapestryDocument, manifest: ComponentManifest, issue: ValidationIssue): Problem {
	let rest = issue.path;
	let nodes: readonly TapestryNode[] | undefined = doc.root;
	let node: TapestryNode | undefined;
	for (let step = NODE_STEP.exec(rest); step; step = NODE_STEP.exec(rest)) {
		node = nodes?.[Number(step[1])];
		nodes = node?.children;
		rest = rest.slice(step[0].length);
	}
	if (!node) return { nodeId: null, component: 'Page', text: issue.message };

	const entry = manifest[node.type];
	const component = node.label?.trim() || entry?.label || node.type;
	const where: string[] = [];
	const prop = PROP_STEP.exec(rest);
	if (prop) {
		rest = rest.slice(prop[0].length);
		const name = prop[1] ?? '';
		const def: PropDefinition | undefined = entry?.props?.[name];
		where.push(def?.label ?? name);
		const item = ITEM_STEP.exec(rest);
		if (item) {
			rest = rest.slice(item[0].length);
			where.push(`item ${Number(item[1]) + 1}`);
		}
		const field = FIELD_STEP.exec(rest);
		if (field && def && (def.type === 'object' || def.type === 'list')) {
			const fieldName = field[1] ?? '';
			const fieldDef: FieldDefinition | undefined = def.fields[fieldName];
			where.push(fieldDef?.label ?? fieldName);
		}
	}
	return { nodeId: node.id, component, text: where.length ? `${where.join(' › ')} ${issue.message}` : issue.message };
}

/** The errors (warnings aren't problems: nothing is lost), described, without repeats. */
export function describeProblems(
	doc: TapestryDocument,
	manifest: ComponentManifest,
	issues: readonly ValidationIssue[],
): Problem[] {
	const seen = new Set<string>();
	const problems: Problem[] = [];
	for (const issue of issues) {
		if (issue.severity !== 'error') continue;
		const problem = describeIssue(doc, manifest, issue);
		const key = `${problem.nodeId}\u0000${problem.text}`;
		if (seen.has(key)) continue;
		seen.add(key);
		problems.push(problem);
	}
	return problems;
}
