import _ from "lodash";
import fs from "fs";
import chalk from "chalk";

export async function parseFile({ path, lexemes, grammar, entry }) {
  validateGrammar({ grammar, lexemes });
  const file = await readFile(path);
  const tokens = tokenize(file, lexemes);
  return parseGrammar(file, tokens, grammar, entry);
}

export async function readFile(filepath) {
  process.stdout.write(`Reading from ${chalk.red(filepath)}. `);
  const code = fs.readFileSync(filepath, { encoding: "utf-8" });
  const lines = code.split("\n");
  process.stdout.write(`${code.length} chars, ${lines.length} lines.\n`);
  return new File({ path: filepath, lines, code });
}

class CodeLocation {
  constructor({ file, ln, col }) {
    Object.assign(this, { file, ln, col });
  }
}

class CodeSnippet {
  constructor({ start, end }) {
    if (start.file !== end.file) {
      throw new Error(
        "Attempted to create a code snippet between two distinct files"
      );
    }
    Object.assign(this, { file: start.file, start, end });
  }

  toString() {
    return this.code();
  }

  read() {
    return this.file.read(this.start, this.end);
  }

  static join(snippets) {
    const files = _.map(snippets, "file");
    if (_.uniq(files) > 1)
      throw new Error("Can't join code snippets from multiple files!");

    const [start] = _.map(snippets, "start").sort((a, b) =>
      a.ln == b.ln ? a.col - b.col : a.ln - b.ln
    );
    const [end] = _.map(snippets, "end").sort((b, a) =>
      a.ln == b.ln ? a.col - b.col : a.ln - b.ln
    );

    return new CodeSnippet({ file: _.first(files), start, end });
  }
}

class File {
  constructor(file) {
    Object.assign(this, file);
  }

  read(startLocation, endLocation) {
    let result = "";
    for (let i = startLocation.ln - 1; i < endLocation.ln; ++i) {
      const start = i === startLocation.ln - 1 ? startLocation.col - 1 : 0;
      const end =
        i === endLocation.ln - 1 ? endLocation.col - 1 : this.lines[i].length;
      result += this.lines[i].slice(start, end);
    }
    return result;
  }
}

class Token extends CodeSnippet {
  constructor({ type, value, ignore, start, end }) {
    super({ start, end });
    Object.assign(this, { type, value, ignore });
  }
}

class Clause extends CodeSnippet {
  constructor({ type, parts, start, end }) {
    super({ start, end });
    Object.assign(this, { type, parts });
  }
}

class LineNumberError extends Error {
  constructor({ message, file, ln, col }) {
    const loc = chalk.bold([file.path, ln, col].join(":"));

    super(
      [
        `Parsing failed at ${loc}: ${message}`,
        file.lines[ln - 1],
        `${_.repeat(" ", col - 1)}^`,
      ].join("\n")
    );
  }
}

export function tokenize(file, lexemes) {
  const { code: input } = file;

  const tokens = [];
  let readHead = 0;
  let ln = 1;
  let col = 1;

  tokens: while (readHead < input.length) {
    const remain = input.slice(readHead);
    for (const { re, type, value: valueFn, ignore } of lexemes) {
      const result = remain.match(re);
      if (result == null || result.index != 0) continue;

      const text = result[0];
      readHead += text.length;

      const newLines = Array.from(text.matchAll(/\n[^\n]*/g));
      let endCol;
      if (newLines.length > 0) endCol = _.last(newLines)[0].length;
      else endCol = col + text.length;

      tokens.push(
        new Token({
          type,
          value: valueFn ? valueFn(text) : text,
          ignore,
          start: new CodeLocation({ file, ln, col }),
          end: new CodeLocation({
            file,
            ln: ln + newLines.length,
            col: endCol,
          }),
        })
      );

      ln += newLines.length;
      col = endCol;
      continue tokens;
    }

    throw new LineNumberError({
      message: `unparsable character ${chalk.red(input[readHead])}`,
      file,
      ln,
      col,
    });
  }

  return tokens;
}

function validateGrammar({ lexemes, grammar }) {
  const validSubClauses = new Set();
  for (const lexeme of lexemes) validSubClauses.add(lexeme.type);
  for (const name of Object.keys(grammar)) validSubClauses.add(name);

  _.forEach(grammar, (clause, name) => {
    for (const option of clause.syntax) {
      for (const subClause of option) {
        if (!validSubClauses.has(subClause)) {
          throw new Error(
            `Grammar rule for ${chalk.blue(
              name
            )} references invalid sub-clause ${chalk.red(subClause)}`
          );
        }
      }
    }
  });
}

export function parseGrammar(file, tokens, grammar, expectedType = "program") {
  const remainingTokensM = new WeakMap();

  const ast = parse(tokens, expectedType);

  const remainingTokens = remainingTokensM.get(ast);
  if (remainingTokens.length > 0) {
    const failedAtToken = _.first(remainingTokens);
    throw new LineNumberError({
      message: `unexpected token ${chalk.red(failedAtToken.type)}`,
      file,
      ...failedAtToken.start,
    });
  }

  return ast;

  function parse(tokens, expectedType) {
    const expectedClause = grammar[expectedType];
    if (expectedClause == null) return null;

    debugLog(chalk.blue("parse"), {
      expectedType,
      code: debugTokens(tokens),
    });

    option: for (const option of expectedClause.syntax) {
      let remainingTokens = tokens;
      const resultParts = [];

      parts: for (const part of option) {
        debugLog(chalk.blue("clause"), `[${option.join(" ")}]: ${part}`);

        const token = remainingTokens[0];
        if (token != null && token.type == part) {
          debugLog(chalk.green("match"), token);
          resultParts.push(token);
          remainingTokens = remainingTokens.slice(1);
          continue parts;
        }

        const subClause = parse(remainingTokens, part);
        if (subClause != null) {
          debugLog(chalk.green("match"), subClause);

          remainingTokens = remainingTokensM.get(subClause);

          if (subClause.type === expectedType) {
            /* append repeats rather than nesting them: */
            resultParts.push(...subClause.parts);
          } else {
            resultParts.push(subClause);
          }

          continue parts;
        }

        debugLog(chalk.red("fail"), `[${option.join(" ")}]: ${part}`);
        continue option;
      }

      const clause = new Clause({
        type: expectedType,
        parts: resultParts.filter((part) => !part.ignore),
        ...CodeSnippet.join(resultParts),
      });

      if (expectedClause.value != null)
        clause.value = expectedClause.value(clause);
      else clause.value = _.map(resultParts, "value");

      remainingTokensM.set(clause, remainingTokens);
      return clause;
    }

    return null;
  }
}

function debugTokens(tokens) {
  return (
    tokens
      .map((t) => `${t.type}(${t.code})`)
      .join(" ")
      .slice(0, 100) + "..."
  );
}

function debugLog(...args) {
  // console.log(...args);
}
