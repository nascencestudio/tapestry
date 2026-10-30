/**
 * A document's plain text (ADR 0046): the words of its rich text and multi-line text fields, in page
 * order, for excerpts ("trim the Full text") in companions such as Tapestry Fabric. Pure.
 */
import { richTextToPlain } from './richtext.js';
import type { ComponentManifest, ObjectValue, PropDefinition, PropValue, RichTextDoc, TapestryNode } from './types.js';

function valueText(def: PropDefinition, value: PropValue | undefined, out: string[]): void {
	if (value === undefined) return;
	if (def.type === 'richtext' && typeof value === 'object' && !Array.isArray(value)) {
		out.push(richTextToPlain(value as RichTextDoc));
	} else if (def.type === 'textarea' && typeof value === 'string') {
		out.push(value);
	} else if (def.type === 'object' && typeof value === 'object' && !Array.isArray(value)) {
		for (const [name, field] of Object.entries(def.fields)) valueText(field, (value as ObjectValue)[name], out);
	} else if (def.type === 'list' && Array.isArray(value)) {
		for (const item of value) {
			if (typeof item !== 'object') continue;
			for (const [name, field] of Object.entries(def.fields)) valueText(field, item[name], out);
		}
	}
}

/** The plain text of these nodes and their children, whitespace collapsed. */
export function nodesText(nodes: readonly TapestryNode[], manifest: ComponentManifest): string {
	const out: string[] = [];
	const walk = (list: readonly TapestryNode[]) => {
		for (const node of list) {
			const entry = manifest[node.type];
			for (const [name, def] of Object.entries(entry?.props ?? {})) valueText(def, node.props[name], out);
			if (node.children) walk(node.children);
		}
	};
	walk(nodes);
	return out.join(' ').replace(/\s+/g, ' ').trim();
}
