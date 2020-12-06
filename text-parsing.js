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
  return { path: filepath, lines, code };
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

      const code = result[0];
      readHead += code.length;

      const newLines = Array.from(code.matchAll(/\n[^\n]*/g));
      let endCol;
      if (newLines.length > 0) endCol = _.last(newLines)[0].length;
      else endCol = col + code.length;

      tokens.push({
        type,
        code,
        value: valueFn ? valueFn(code) : code,
        start: { ln, col },
        end: { ln: ln + newLines.length, col: endCol },
        ignore,
      });

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
  console.log(validSubClauses);

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
          if (!token.ignore) resultParts.push(token);
          remainingTokens = remainingTokens.slice(1);
          continue parts;
        }

        const subClause = parse(remainingTokens, part);
        if (subClause != null) {
          debugLog(chalk.green("match"), subClause.type);

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

      const clause = {
        type: expectedType,
        parts: resultParts,
        code: resultParts.map(({ code }) => code).join(""),
      };

      if (expectedClause.value != null)
        clause.value = expectedClause.value(clause);
      else clause.value = _.map(resultParts, "value");

      remainingTokensM.set(clause, remainingTokens);
      return clause;
    }

    return null;
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
