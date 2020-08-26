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
  ObjectLiteral,
  SelectQueryBuilder,
  WhereExpression,
} from "typeorm";
import { ColumnMetadata } from "typeorm/metadata/ColumnMetadata";

interface ProcessNodeOptions {
  connective?: Connective;
  whereExpression?: WhereExpression;
}

const comparators = {
  [Comparator.EQ]: "=",
  [Comparator.LT]: "<",
  [Comparator.GT]: ">",
  [Comparator.LE]: "<=",
  [Comparator.GE]: ">=",
};

function applyWhereToQueryBuilder<T>(
  queryBuilder: SelectQueryBuilder<T>,
  tableName: string,
  column: ColumnMetadata,
  node: TermNode,
  options: ProcessNodeOptions = {}
) {
  const connective = options.connective || Connective.AND;
  const whereExpression = options.whereExpression || queryBuilder;

  const parameterKey = crypto.randomBytes(4).toString("hex");

  let where = `${tableName}.${column.databaseName} ${
    comparators[node.comparator]
  } :${parameterKey}`;

  let parameters: ObjectLiteral = {
    [parameterKey]: node.value,
  };

  // 如果值为空
  if (node.value === null) {
    whereExpression[connective === Connective.AND ? "andWhere" : "orWhere"](
      node.not
        ? `${tableName}.${column.databaseName} IS NOT NULL`
        : `${tableName}.${column.databaseName} IS NULL`
    );

    return;
  }

  if (
    !column.isArray &&
    node.comparator === Comparator.EQ &&
    typeof node.value === "string"
  ) {
    where = `LOWER(${tableName}.${column.databaseName}) LIKE LOWER(:${parameterKey})`;
    parameters = { [parameterKey]: `%${node.value}%` };
  }

  if (
    column.type === "json" &&
    typeof column.entityMetadata.target === "function" &&
    Reflect.getMetadata(
      "design:type",
      column.entityMetadata.target.prototype,
      column.propertyName
    ) === Array &&
    node.comparator === Comparator.EQ
  ) {
    where = `JSON_CONTAINS(${tableName}.${column.databaseName}, :${parameterKey})`;
    parameters = { [parameterKey]: JSON.stringify(node.value) };
  }

  if (node.not) {
    where = `NOT (${where})`;
  }

  whereExpression[connective === Connective.AND ? "andWhere" : "orWhere"](
    where,
    parameters
  );
}

function processTermNode<T>(
  queryBuilder: SelectQueryBuilder<T>,
  node: TermNode,
  options: ProcessNodeOptions = {}
): void {
  // 跳过没有指定字段的查询项
  if (!node.name) return;

  const connective = options.connective || Connective.AND;
  const whereExpression = options.whereExpression || queryBuilder;

  const { tableName, columns } = queryBuilder.expressionMap.mainAlias?.metadata;

  const propertyNamePrefix = node.name.split(".")[0];

  // 跳过找不到列的查询项
  const column = columns.find((c) => c.propertyName === propertyNamePrefix);
  if (!column) return;

  // 如果查询的是关联字段，自动加载关联表
  if (column.relationMetadata) {
    queryBuilder.leftJoinAndSelect(
      `${tableName}.${column.propertyName}`,
      column.relationMetadata.inverseEntityMetadata.tableName
    );

    applyWhereToQueryBuilder<T>(
      queryBuilder,
      column.relationMetadata.inverseEntityMetadata.tableName,
      column.relationMetadata.inverseEntityMetadata.columns.find(
        (c) => c.propertyName === node.name.split(".")[1]
      ),
      node,
      {
        connective,
        whereExpression,
      }
    );
  } else {
    applyWhereToQueryBuilder<T>(queryBuilder, tableName, column, node, {
      connective,
      whereExpression,
    });
  }
}

function processQueryNode<T>(
  queryBuilder: SelectQueryBuilder<T>,
  { value }: QueryNode,
  options: ProcessNodeOptions = {}
): void {
  const connective = options.connective || Connective.AND;
  const whereExpression = options.whereExpression || queryBuilder;

  value.forEach((item) => {
    if (item.node.type === NodeType.QUERY) {
      whereExpression[connective === Connective.AND ? "andWhere" : "orWhere"](
        new Brackets((qb: WhereExpression) => {
          processQueryNode(queryBuilder, item.node as QueryNode, {
            connective: item.connective,
            whereExpression: qb,
          });
        })
      );
    } else {
      processTermNode(queryBuilder, item.node, {
        connective,
        whereExpression,
      });
    }
  });
}

export function applySearchSyntaxToQueryBuilder<T>(
  queryBuilder: SelectQueryBuilder<T>,
  query: string
): SelectQueryBuilder<T> {
  const node = parse(query);

  if (node) {
    processQueryNode<T>(queryBuilder, node);
  }

  return queryBuilder;
}
