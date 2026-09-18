import chalk from "chalk";
import gradient from "gradient-string";
import figlet from "figlet";
import { promisify } from "util";

const figletAsync = promisify(figlet);

const yuta = gradient(["#7B2FBE", "#E040FB", "#00E5FF"]);
const separator = chalk.hex("#7B2FBE")("─".repeat(55));

export async function printBanner() {
  const art = await figletAsync("YUTA", { font: "ANSI Shadow" });
  console.clear();
  console.log("\n" + yuta(art));
  console.log(chalk.hex("#E040FB").bold("        ⚡  Yuta Okkotsu Bot  ⚡"));
  console.log(chalk.hex("#00E5FF")("        ✦  Jujutsu Kaisen Edition  ✦"));
  console.log(separator);
  console.log(
    chalk.white("        Powered by ") +
    chalk.hex("#E040FB").bold("DuarteXV")
  );
  console.log(separator + "\n");
}

const tag = {
  info:  chalk.bgHex("#7B2FBE").white.bold("  INFO  "),
  ok:    chalk.bgHex("#00C853").white.bold("   OK   "),
  warn:  chalk.bgHex("#FF6F00").white.bold("  WARN  "),
  error: chalk.bgHex("#D50000").white.bold(" ERROR  "),
  conn:  chalk.bgHex("#1A237E").white.bold("  CONN  "),
  bot:   chalk.bgHex("#263238").white.bold("  BOT   "),
};

function ts() {
  return new Date().toLocaleTimeString("es-CO", { hour12: true });
}

export const log = {
  info:  (msg) => console.log(`${chalk.gray(`[${ts()}]`)} ${tag.info}  ${chalk.white(msg)}`),
  ok:    (msg) => console.log(`${chalk.gray(`[${ts()}]`)} ${tag.ok}  ${chalk.greenBright(msg)}`),
  warn:  (msg) => console.log(`${chalk.gray(`[${ts()}]`)} ${tag.warn}  ${chalk.yellow(msg)}`),
  error: (msg) => console.log(`${chalk.gray(`[${ts()}]`)} ${tag.error}  ${chalk.red(msg)}`),
  conn:  (msg) => console.log(`${chalk.gray(`[${ts()}]`)} ${tag.conn}  ${chalk.cyan(msg)}`),
  bot:   (msg) => console.log(`${chalk.gray(`[${ts()}]`)} ${tag.bot}  ${chalk.hex("#B0BEC5")(msg)}`),

  message() {},

  cmdExec({ cmdName, sender, success, ms, botLabel = "MAIN" }) {
    const numero = sender?.split("@")[0] || sender || "";
    const estado = success ? chalk.greenBright.bold("EXITOSO") : chalk.red.bold("FALLIDO");

    console.log(
      chalk.hex("#00E5FF")(`▸ ${ts()}`) + chalk.gray("  ·  ") + chalk.hex("#E040FB").bold(botLabel) + "\n" +
      chalk.white("  Comando  ") + chalk.hex("#7B2FBE").bold(`.${cmdName}`) + "\n" +
      chalk.white("  Usuario  ") + chalk.greenBright(`+${numero}`) + "\n" +
      chalk.white("  Estado   ") + estado + chalk.gray(`  ·  ${ms}ms`) + "\n" +
      chalk.gray("  " + "·".repeat(50))
    );
  },
};