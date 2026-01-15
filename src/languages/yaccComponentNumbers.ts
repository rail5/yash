import * as vscode from 'vscode';
import { YACCDocument, NodeType } from './parser/yaccParser';
import { createScanner } from './parser/yaccScanner';
import { TokenType } from './yaccLanguageTypes';

const componentNumberDecorationType = vscode.window.createTextEditorDecorationType({});

function buildDollarIndexByOffset(
    text: string,
    ruleOffset: number,
    ruleEnd: number,
    // Offsets of RHS components (from the parser) that are eligible to be numbered.
    componentOffsets: ReadonlySet<number>
): Map<number, number> {
    const scanner = createScanner(text, ruleOffset);
    const map = new Map<number, number>();

    let count = 1;
    let skipNext = false;

    for (;;) {
        const tok = scanner.scan();
        const off = scanner.getTokenOffset();
        if (tok === TokenType.EOS || off >= ruleEnd) break;

        switch (tok) {
            case TokenType.Bar:
                count = 1;
                skipNext = false;
                break;

            case TokenType.StartAction:
            case TokenType.Action:
            case TokenType.EndAction:
                // Actions do not contribute to $n numbering.
                break;

            case TokenType.Option: {
                const opt = scanner.getTokenText().toLowerCase();
                // These directives take an argument that is not a RHS component.
                if (opt === '%prec' || opt === '%dprec' || opt === '%merge') {
                    skipNext = true;
                }
                break;
            }

            case TokenType.Word:
            case TokenType.Literal: {
                // Only number tokens that correspond to parsed RHS components.
                // Don't count the LHS or other non-component words.
                const isComponent = componentOffsets.has(off);

                if (skipNext) {
                    // Skip the directive argument (e.g. SOME_PRECEDENCE after %prec)
                    skipNext = false;
                    break;
                }

                if (isComponent) {
                    map.set(off, count++);
                }
                break;
            }

            default:
                break;
        }
    }

    return map;
}

export function decorateComponentNumbers(editor: vscode.TextEditor, yaccDoc: YACCDocument) {
    if (editor.document.languageId !== 'yacc') {
        // Clear any old decorations if this editor is not yacc anymore.
        editor.setDecorations(componentNumberDecorationType, []);
        return;
    }

    const text = editor.document.getText();
    const decorations: vscode.DecorationOptions[] = [];

    for (const node of yaccDoc.nodes) {
        if (node.nodeType !== NodeType.Rule) continue;

        const rhsComponents = yaccDoc.components
            .filter(c => c.offset >= node.offset && c.end <= node.end)
            .sort((a, b) => a.offset - b.offset);

        // Offsets for actual RHS components we might decorate.
        const componentOffsets = new Set<number>(
            rhsComponents
                .filter(c => c.name !== '|')
                .map(c => c.offset)
        );

        const dollarIndexByOffset = buildDollarIndexByOffset(text, node.offset, node.end, componentOffsets);

        for (const comp of rhsComponents) {
            if (comp.name === '|') continue;

            const n = dollarIndexByOffset.get(comp.offset);
            if (!n) continue; // skips %prec arg, etc.

            decorations.push({
                range: new vscode.Range(
                    editor.document.positionAt(comp.offset),
                    editor.document.positionAt(comp.offset)
                ),
                renderOptions: {
                    before: {
                        contentText: `\$${n}:`,
                        color: '#888',
                        margin: '0 3px 0 0'
                    }
                }
            });
        }
    }

    editor.setDecorations(componentNumberDecorationType, decorations);
}
