import crypto from "crypto";
import {
  Comparator,
  Connective,
  NodeType,
  parse,
  QueryNode,
  TermNode,
} from "search-syntax";
import {
  Brackets,
  createQueryBuilder,
  getConnection,
  ObjectLiteral,
  ObjectType,
  SelectQueryBuilder,
  WhereExpression,
} from "typeorm";
import { ColumnMetadata } from "typeorm/metadata/ColumnMetadata";

const comparators = {
  [Comparator.EQ]: "=",
  [Comparator.LT]: "<",
  [Comparator.GT]: ">",
  [Comparator.LE]: "<=",
  [Comparator.GE]: ">=",
};

function processTermNode({
  columns,
  connective,
  node,
  queryBuilder,
  tableName,
}: {
  columns: ColumnMetadata[];
  connective: Connective;
  node: TermNode;
  queryBuilder: WhereExpression;
  tableName: string;
}): void {
  if (!node.name) return;

  const column = columns.find(({ propertyName }) => propertyName === node.name);

  if (!column) {
    return;
  }

  const parameterKey = crypto.randomBytes(4).toString("hex");

  const { databaseName } = column;

  let where = `${tableName}.${databaseName} ${
    comparators[node.comparator]
  } :${parameterKey}`;

  let parameters: ObjectLiteral = {
    [parameterKey]: node.value,
  };

  if (
    !column.isArray &&
    node.comparator === Comparator.EQ &&
    typeof node.value === "string"
  ) {
    where = `${tableName}.${databaseName} ILIKE :${parameterKey}`;
    parameters = { [parameterKey]: `%${node.value}%` };
  }

  if (column.isArray && node.comparator === Comparator.EQ) {
    where = `:${parameterKey} = ANY(${tableName}.${databaseName})`;
  }

  if (node.not) {
    where = `NOT (${where})`;
  }

  queryBuilder[connective === Connective.AND ? "andWhere" : "orWhere"](
    where,
    parameters
  );
}

function processQueryNode({
  connective = Connective.AND,
  columns,
  node: { value },
  queryBuilder,
  tableName,
}: {
  columns: ColumnMetadata[];
  connective?: Connective;
  node: QueryNode;
  queryBuilder: WhereExpression;
  tableName: string;
}): void {
  value.forEach((item) => {
    if (item.node.type === NodeType.QUERY) {
      queryBuilder[connective === Connective.AND ? "andWhere" : "orWhere"](
        new Brackets((qb: WhereExpression) => {
          processQueryNode({
            connective: item.connective,
            columns,
            node: item.node as QueryNode,
            queryBuilder: qb,
            tableName,
          });
        })
      );
    } else {
      processTermNode({
        columns,
        connective,
        node: item.node,
        queryBuilder,
        tableName,
      });
    }
  });
}

export function processQuery<T>(
  target: string | ObjectType<T>,
  query: string,
  queryBuilder?: SelectQueryBuilder<T>
): SelectQueryBuilder<T> {
  // eslint-disable-next-line no-param-reassign
  queryBuilder = queryBuilder || createQueryBuilder(target);

  if (!query) {
    return queryBuilder;
  }

  const { tableName, columns } = getConnection().getMetadata(target);

  processQueryNode({
    columns,
    node: parse(query),
    queryBuilder,
    tableName,
  });

  return queryBuilder;
}
