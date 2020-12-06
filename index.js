import chalk from "chalk";
import _ from "lodash";
import { parseFile } from "./text-parsing.js";

async function main() {
  const ast = await parseFile({
    path: "./input.txt",
    lexemes: [
      {
        type: "floor",
        re: /[()]+/,
        value: (p) =>
          p.split("").reduce((curr, instruction, i) => {
            const next = curr + (instruction === "(" ? 1 : -1);
            if (next === -1) console.log(`Entering the basement at ${i + 1}`);
            return next;
          }, 0),
      },
    ],
    grammar: {
      directions: {
        syntax: [["floor"]],
      },
    },
    entry: "directions",
  });

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
