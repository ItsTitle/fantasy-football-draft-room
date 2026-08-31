/// <reference types="vite/client" />

/**
 * The settings this app reads from the environment at build time.
 *
 * Both are optional and both are read in one place. See `src/config.ts` and
 * `.env.example`.
 */
interface ImportMetaEnv {
  /** Your Sleeper leagues, as a JSON array of `{ id, name }`. */
  readonly VITE_SEED_LEAGUES?: string;
  /** Your Sleeper display name. */
  readonly VITE_DEFAULT_MANAGER?: string;
  /** Where the client sends `/api`. Defaults to the same origin. */
  readonly VITE_API_BASE?: string;
}
