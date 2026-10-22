import { createPostgresDb } from "../../src/db/client.js";
import { describeRepositoryContract } from "../contract/repositories.contract.js";
import { requireTestDatabaseUrl } from "./test-database.js";

describeRepositoryContract("Postgres", async () => {
  const handle = createPostgresDb(requireTestDatabaseUrl(), { max: 2 });
  await handle.migrate();
  return handle;
});
