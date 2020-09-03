import { Connection, createConnection } from "typeorm";

import { applySearchSyntaxToQueryBuilder } from "../src";
import { User } from "./entities/User";

describe("QueryBuilder", () => {
  let connection: Connection;

  beforeAll(async () => {
    connection = await createConnection({
      type: "sqlite",
      database: ":memory:",
      dropSchema: true,
      entities: [User],
      synchronize: true,
    });
  });

  it("AND", async () => {
    const queryBuilder = connection.getRepository(User).createQueryBuilder();

    applySearchSyntaxToQueryBuilder(
      queryBuilder,
      'name:"John Wick" AND enable:true'
    );

    expect(queryBuilder.getSql()).toBe(
      'SELECT "User"."id" AS "User_id", "User"."name" AS "User_name", "User"."enable" AS "User_enable", "User"."createdAt" AS "User_createdAt", "User"."updatedAt" AS "User_updatedAt" FROM "user" "User" WHERE LOWER(user.name) LIKE LOWER(?) AND user.enable = ?'
    );
  });

  it("OR", async () => {
    const queryBuilder = connection.getRepository(User).createQueryBuilder();

    applySearchSyntaxToQueryBuilder(
      queryBuilder,
      'name:"John Wick" OR enable:true'
    );

    expect(queryBuilder.getSql()).toBe(
      'SELECT "User"."id" AS "User_id", "User"."name" AS "User_name", "User"."enable" AS "User_enable", "User"."createdAt" AS "User_createdAt", "User"."updatedAt" AS "User_updatedAt" FROM "user" "User" WHERE LOWER(user.name) LIKE LOWER(?) OR user.enable = ?'
    );
  });
});
