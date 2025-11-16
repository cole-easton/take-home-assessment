import { describe, it, expect, vi, beforeEach } from "vitest";

type MockDB = {
  exec: ReturnType<typeof vi.fn>;
};

vi.mock('better-sqlite3', () => {
  return {
    default: vi.fn(function(this: MockDB) {
      this.exec = vi.fn();
    })
  };
});

describe("database connection singleton", () => {
    beforeEach(() => {
        vi.resetModules();
    });
    
    it("should create only one sqlite connection", async () => {
        const SQLite = (await import("better-sqlite3")).default as any; //Database() constructor

        const { db } = await import("../lib/db/index");

        expect(SQLite).toHaveBeenCalledTimes(1);

        // Importing again should not call constructor
        const { db: db2 } = await import("../lib/db/index");
        expect(SQLite).toHaveBeenCalledTimes(1);

        expect(db).toBeDefined();
        expect(db2).toBeDefined();
    });
});
