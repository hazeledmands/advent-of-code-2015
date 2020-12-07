import chalk from "chalk";
import _ from "lodash";
import { File, Grammar, Rule, Lexeme } from "./text-parsing.js";

async function main() {
  const grammar = new Grammar([
    new Lexeme("dimension", { re: /\d+/, value: (d) => parseInt(d) }),
    new Lexeme("x", { re: /x/, ignore: true }),
    new Lexeme("separator", { re: /\n/, ignore: true }),
    new Rule("box", {
      syntax: [["dimension", "x", "dimension", "x", "dimension"]],
      value: (b) => {
        const [l, w, h] = _(b.parts)
          .map("value")
          .sort((a, b) => a - b)
          .value();
        const volume = l * w * h;
        const perimiter = 2 * l + 2 * w;
        const result = perimiter + volume;
        // console.log({ code: b.read(), l, w, h, volume, perimiter, result });
        return result;
      },
    }),
    new Rule("boxList", {
      syntax: [["box", "separator", "boxList"], ["box"]],
      value: (l) => _(l.parts).map("value").sum(),
    }),
  ]);

  const file = await File.loadFrom("./test.txt");
  const ast = grammar.parse(file, "boxList");
  console.log(ast.value);
}

function log() {
  console.log(...arguments);
}

const startDate = new Date();
log(
  // random so it's easier to see that something changed in the console:
  _.repeat("\n", _.random(1, 4))
);
log(
  chalk.underline(
    [
      startDate.getHours().toString().padStart(2, 0),
      startDate.getMinutes().toString().padStart(2, 0),
      startDate.getSeconds().toString().padStart(2, 0),
    ].join(":") + _.repeat(" ", 50)
  )
);

main()
  .catch((error) => log(`\n\n${error.stack}`))
  .finally(() => log(`Done in ${Date.now() - startDate.valueOf()}ms`));
