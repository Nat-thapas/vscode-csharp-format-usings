import * as vs from 'vscode';

export interface IFormatOptions {
    sortOrder: string;
    splitGroups: boolean;
    removeUnnecessaryUsings: boolean;
    numEmptyLinesAfterUsings: number;
    numEmptyLinesBeforeUsings: number;
}

export interface IResult {
    source?: string;
    error?: string;
}

declare type Func<T, S> = (...args: S[]) => T;

const replaceCode = (source: string, condition: RegExp, cb: Func<string, string>): string => {
    const flags = condition.flags.replace(/[gm]/g, '');
    const regexp = new RegExp(condition.source, `gm${flags}`);
    return source.replace(regexp, (s: string, ...args: string[]) => {
        if (s[0] === '"' || s[0] === "'" || (s[0] === '/' && (s[1] === '/' || s[1] === '*'))) {
            return s;
        }
        return cb(s, ...args.slice(1));
    });
};

const getNamespaceOrder = (ns: string, orderedNames: string[]): number => {
    for (let i = 0; i < orderedNames.length; i++) {
        const item = orderedNames[i];
        let nsTest = item.length < ns.length ? ns.substr(0, item.length) : ns;
        if (item === nsTest) {
            return orderedNames.length - i;
        }
    }
    return 0;
};

export function process(editor: vs.TextEditor, options: IFormatOptions): string {
    var content = editor.document.getText();
    const endOfline = editor.document.eol === vs.EndOfLine.LF ? '\n' : '\r\n';
    const firstUsing = content.search(/using\s+[.\w]+;/);
    const firstUsingLine = content.substring(0, firstUsing).split(endOfline).length - 1;

    content = replaceCode(content, /\s*(using\s+[.\w]+;\s*)+/gm, (rawBlock) => {
        const lines = rawBlock.split(endOfline).map((l) => l?.trim() ?? ''); // remove heading and trailing whitespaces
        const usings = lines.filter((l) => l.length > 0);

        if (options.removeUnnecessaryUsings) {
            removeUnncessaryUsings(editor, usings, firstUsingLine);
        }

        sortUsings(usings, options);

        if (options.splitGroups) {
            splitGroups(usings);
        }

        // if there are characters, like comments, before usings
        if (content.substring(0, firstUsing).search(/./) >= 0) {
            // Keep numEmptyLinesBeforeUsings empty lines before usings if there are in the source
            for (
                var i = Math.min(options.numEmptyLinesBeforeUsings, lines.length - 1);
                i >= 0;
                i--
            ) {
                if (lines[i].length === 0) {
                    usings.unshift('');
                }
            }
        }

        // if no using left, there is no need to insert extra empty lines
        if (usings.length > 0) {
            // Preserve num empty lines between usings and code block
            for (var i = 0; i <= options.numEmptyLinesAfterUsings; i++) {
                usings.push('');
            }
        }

        return usings.join(endOfline);
    });
    return content;
}

export function removeUnncessaryUsings(
    editor: vs.TextEditor,
    usings: string[],
    firstUsingLine: number
) {
    const unnecessaryUsingIndexs = vs.languages
        .getDiagnostics(editor.document.uri)
        .filter(
            (diagnostic) =>
                diagnostic.source === 'csharp' && 'CS8019' === diagnostic.code?.toString()
        )
        .map((diagnostic) => diagnostic.range.start.line - firstUsingLine);

    if (unnecessaryUsingIndexs.length === 0) {
        return;
    }

    for (let i = usings.length - 1; i >= 0; i--) {
        if (unnecessaryUsingIndexs.includes(i)) {
            usings.splice(i, 1);
        }
    }
}

export function sortUsings(usings: string[], options: IFormatOptions) {
    const trimSemiColon = /^\s+|;\s*$/;
    usings.sort((a: string, b: string) => {
        let res = 0;
        // because we keep lines with indentation and semicolons.
        a = a.replace(trimSemiColon, '');
        b = b.replace(trimSemiColon, '');
        if (options.sortOrder) {
            const ns = options.sortOrder.split(' ');
            res -= getNamespaceOrder(a.substr(6), ns);
            res += getNamespaceOrder(b.substr(6), ns);
            if (res !== 0) {
                return res;
            }
        }
        for (let i = 0; i < a.length; i++) {
            const lhs = a[i].toLowerCase();
            const rhs = b[i] ? b[i].toLowerCase() : b[i];
            if (lhs !== rhs) {
                res = lhs < rhs ? -1 : 1;
                break;
            }
            if (lhs !== a[i]) {
                res++;
            }
            if (rhs !== b[i]) {
                res--;
            }
            if (res !== 0) {
                break;
            }
        }
        return res === 0 && b.length > a.length ? -1 : res;
    });
}

function splitGroups(usings: string[]) {
    let i = usings.length - 1;
    const baseNS = /\s*using\s+(\w+).*/;
    let lastNS = usings[i--].replace(baseNS, '$1');
    let nextNS: string;
    for (; i >= 0; i--) {
        nextNS = usings[i].replace(baseNS, '$1');
        if (nextNS !== lastNS) {
            lastNS = nextNS;
            usings.splice(i + 1, 0, '');
        }
    }
}
