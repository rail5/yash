import * as vscode from 'vscode';
import { YACCDocument, NodeType } from './parser/yaccParser';

export function decorateComponentNumbers(editor: vscode.TextEditor, yaccDoc: YACCDocument) {
    if (editor.document.languageId !== 'yacc') return;

    const decorations: vscode.DecorationOptions[] = [];
    const decoType = vscode.window.createTextEditorDecorationType({});

    for (const node of yaccDoc.nodes) {
        if (node.nodeType !== NodeType.Rule) continue;

        const rhsComponents = yaccDoc.components
            .filter(c => c.offset >= node.offset && c.end <= node.end)
            .sort((a, b) => a.offset - b.offset); // be explicit

        let count = 1;
        for (const comp of rhsComponents) {
            if (comp.name === '|') {
                count = 1;
                continue;
            }

			decorations.push({
				range: new vscode.Range(
					editor.document.positionAt(comp.offset),
					editor.document.positionAt(comp.offset)
				),
				renderOptions: {
					before: {
						contentText: `\$${count++}:`,
						color: '#888',
						margin: '0 3px 0 0'
					}
				}
			});
        }
    }

    editor.setDecorations(decoType, decorations);
}
