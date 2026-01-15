import { TextDocument, Hover, Position, MarkdownString, workspace, Range } from 'vscode';
import { YACCDocument, ISymbol, predefined, NodeType, Node } from '../parser/yaccParser';
import { createMarkedCodeString } from './utils';

function getDollarRefAt(document: TextDocument, position: Position): { text: string; range: Range } | null {
    const line = document.lineAt(position.line).text;
    const i = position.character;

    // Match $$ or $123 anywhere on the line and pick the one under the cursor.
    const re = /\$\$|\$\d+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        if (i >= start && i <= end) {
            return {
                text: m[0],
                range: new Range(new Position(position.line, start), new Position(position.line, end))
            };
        }
    }
    return null;
}

function findEnclosingRule(yaccDocument: YACCDocument, offset: number): Node | undefined {
    // Smallest Rule node containing the offset.
    let best: Node | undefined;
    for (const n of yaccDocument.nodes) {
        if (n.nodeType !== NodeType.Rule) continue;
        if (offset < n.offset || offset > n.end) continue;
        if (!best || (n.end - n.offset) < (best.end - best.offset)) best = n;
    }
    return best;
}

function resolveComponentNameForDollarRef(
    yaccDocument: YACCDocument,
    rule: Node,
    embeddedOffset: number,
    embeddedEnd: number,
    n: number
): string | null {
    if (n <= 0) return null;

    const compsInRule = yaccDocument.components
        .filter(c => c.offset >= rule.offset && c.end <= rule.end)
        .sort((a, b) => a.offset - b.offset);

    // Determine which alternative we are in by looking for the nearest '|' before this action (if present),
    // and the next '|' after it (if present).
    let startBound = rule.offset;
    for (let i = 0; i < compsInRule.length; i++) {
        const c = compsInRule[i];
        if (c.name === '|' && c.offset < embeddedOffset) {
            startBound = c.end; // start after bar
        }
    }

    let endBound = rule.end;
    for (let i = 0; i < compsInRule.length; i++) {
        const c = compsInRule[i];
        if (c.name === '|' && c.offset >= embeddedEnd) {
            endBound = c.offset; // end before next bar
            break;
        }
    }

    const prod = compsInRule
        .filter(c => c.name !== '|' && c.offset >= startBound && c.end <= endBound)
        .sort((a, b) => a.offset - b.offset);

    const target = prod[n - 1];
    return target ? target.name : null;
}

export function doYACCHover(document: TextDocument, position: Position, yaccDocument: YACCDocument): Hover | null {
    const offset = document.offsetAt(position);

    // Provide hover for $n/$$ inside actions.
    const embedded = yaccDocument.getEmbeddedNode(offset);
    if (embedded) {
        const ref = getDollarRefAt(document, position);
        if (!ref) {
            return null;
        }

        const rule = findEnclosingRule(yaccDocument, offset);
        if (!rule) {
            return null;
        }

        // $$ refers to the LHS non-terminal of the enclosing rule.
        if (ref.text === '$$') {
            if (!rule.name) return null;
            return { contents: [createMarkedCodeString(`${ref.text} → ${rule.name}`, 'yacc')] };
        }

        const n = Number.parseInt(ref.text.slice(1), 10);
        if (!Number.isFinite(n)) {
            return null;
        }

        const name = resolveComponentNameForDollarRef(yaccDocument, rule, embedded.offset, embedded.end, n);
        if (!name) {
            return null;
        }

        return { contents: [createMarkedCodeString(`${ref.text} → ${name}`, 'yacc')] };
    }

    var symbol: ISymbol;
    const word = document.getText(document.getWordRangeAtPosition(position));
    const node = yaccDocument.getNodeByOffset(offset);
    if (node) {
        // Inside <...>
        if (node.typeOffset && offset > node.typeOffset) {
            if (!node.typeEnd || offset <= node.typeEnd) {
                if ((symbol = yaccDocument.types[word])) {
                    message = createMarkedCodeString(symbol.type, 'yacc');
                    return { contents: [createMarkedCodeString(symbol.type, 'yacc')] }
                }
                return null;
            }
        }
    }

    var message: MarkdownString | undefined = undefined;
    if ((symbol = yaccDocument.symbols[word])) {
        const config = workspace.getConfiguration('yash');
        const yyType = config.get('YYTYPE', '');
        const guess = yyType !== '' ? yyType : '?';
        message = createMarkedCodeString(`%type <${symbol.type ? symbol.type : guess}> ${symbol.name}`, 'yacc');
    } else if ((symbol = yaccDocument.tokens[word])) {
        const node = yaccDocument.getNodeByOffset(symbol.offset)!;
        const head = document.getText(document.getWordRangeAtPosition(document.positionAt(node!.offset + 1)));
        message = createMarkedCodeString(`%${head} <${symbol.type ? symbol.type : '?'}> ${symbol.name}`, 'yacc');
    } else if ((symbol = yaccDocument.aliases[`"${word}"`])) {
        if (symbol.alias) {
            symbol = symbol.alias;
            const node = yaccDocument.getNodeByOffset(symbol.offset)!;
            const head = document.getText(document.getWordRangeAtPosition(document.positionAt(node!.offset + 1)));
            message = createMarkedCodeString(`%${head} <${symbol.type ? symbol.type : '?'}> ${symbol.name}`, 'yacc');
        }
    } else if (predefined[word]) {
        message = createMarkedCodeString(predefined[word], 'yacc');
    }

    const namedReference = yaccDocument.namedReferences[`[${word}]`]
    if (namedReference) {
        if (namedReference.symbol) {
            message = createMarkedCodeString(`Named reference for ${namedReference.symbol}`, 'plaintext');
        } else {
            message = createMarkedCodeString(`Middle rule action reference`, 'plaintext');
        }
    }

    if (message)
        return { contents: [message] };

    return null;
}
