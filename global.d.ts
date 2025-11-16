import Database from "better-sqlite3";

declare global {
  var _sqlite: Database.Database | undefined;
}