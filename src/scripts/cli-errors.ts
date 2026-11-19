/** A bad command line: the CLIs print its message and exit with code 1. */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}
