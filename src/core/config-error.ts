/** A missing or invalid config file. The CLIs print its message and exit with code 1. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
