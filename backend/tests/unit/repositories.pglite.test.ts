import { describeRepositoryContract } from "../contract/repositories.contract.js";
import { createPgliteDb } from "../support/pglite-db.js";

describeRepositoryContract("PGlite", createPgliteDb);
