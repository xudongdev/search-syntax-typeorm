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

interface ProcessNodeOptions<T> {
  columns: ColumnMetadata[];
  connective: Connective;
  queryBuilder: SelectQueryBuilder<T>;
  subQueryBuilder?: WhereExpression;
  tableName: string;
}

const comparators = {
  [Comparator.EQ]: "=",
  [Comparator.LT]: "<",
  [Comparator.GT]: ">",
  [Comparator.LE]: "<=",
  [Comparator.GE]: ">=",
};

function applyWhereToQueryBuilder<T>(
  node: TermNode,
  tableName: string,
  column: ColumnMetadata,
  options: ProcessNodeOptions<T>
) {
  const { connective } = options;
  const whereExpression = options.subQueryBuilder || options.queryBuilder;

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
  node: TermNode,
  options: ProcessNodeOptions<T>
): void {
  // 跳过没有指定字段的查询项
  if (!node.name) return;

  const { columns, queryBuilder, tableName } = options;

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
      node,
      column.relationMetadata.inverseEntityMetadata.tableName,
      column.relationMetadata.inverseEntityMetadata.columns.find(
        (c) => c.propertyName === node.name.split(".")[1]
      ),
      options
    );
  } else {
    applyWhereToQueryBuilder<T>(node, tableName, column, options);
  }
}

function processQueryNode<T>(
  { value }: QueryNode,
  options: ProcessNodeOptions<T>
): void {
  const connective = options.connective || Connective.AND;
  const whereExpression = options.subQueryBuilder || options.queryBuilder;

  value.forEach((item) => {
    if (item.node.type === NodeType.QUERY) {
      whereExpression[connective === Connective.AND ? "andWhere" : "orWhere"](
        new Brackets((subQueryBuilder) => {
          processQueryNode<T>(item.node as QueryNode, {
            ...options,
            connective: item.connective,
            subQueryBuilder,
          });
        })
      );
    } else {
      processTermNode(item.node, {
        ...options,
        connective: item.connective,
      });
    }
  });
}

export function applySearchSyntaxToQueryBuilder<T>(
  queryBuilder: SelectQueryBuilder<T>,
  query: string
): SelectQueryBuilder<T> {
  const node = parse(query);

  const { tableName, columns } = queryBuilder.expressionMap.mainAlias?.metadata;

  if (node) {
    queryBuilder.andWhere(
      new Brackets((subQueryBuilder) => {
        processQueryNode<T>(node, {
          columns,
          connective: Connective.AND,
          queryBuilder,
          subQueryBuilder,
          tableName,
        });
      })
    );
  }

  return queryBuilder;
}
