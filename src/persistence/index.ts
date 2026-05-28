/**
 * Persistence module — durable-execution checkpoints and related primitives.
 *
 * See `src/memory/` for the broader SQLite store used by aistack;
 * `persistence/` is reserved for crash-recovery / replay machinery that
 * sits on top of that store.
 */

export {
  Checkpointer,
  getCheckpointer,
  resetCheckpointer,
  saveCheckpointIfEnabled,
} from './checkpointer.js';
export type {
  Checkpoint,
  CheckpointFormat,
  CheckpointerOptions,
} from './checkpointer.js';
