/**
 * Public surface of the translation layer.
 *
 * `core` holds everything that works without React (dictionaries, plural and
 * number formatting, device detection); `provider` holds the React context and
 * its hook. Consumers import from here and need not care which is which.
 */
export * from "./core";
export * from "./provider";
