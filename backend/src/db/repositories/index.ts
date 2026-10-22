import type { Database } from "../client.js";
import { createAnalysesRepository } from "./analyses.js";
import { createFilesRepository } from "./files.js";
import { createManualsRepository } from "./manuals.js";
import { createRoundsRepository } from "./rounds.js";
import { createSnapshotsRepository } from "./snapshots.js";

export function createRepositories(db: Database) {
  return {
    analyses: createAnalysesRepository(db),
    snapshots: createSnapshotsRepository(db),
    files: createFilesRepository(db),
    rounds: createRoundsRepository(db),
    manuals: createManualsRepository(db),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
