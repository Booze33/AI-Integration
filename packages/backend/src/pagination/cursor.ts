/**
 * Cursor-Based Pagination Utilities
 *
 * More efficient than offset/limit pagination for large datasets.
 * Uses database cursors to reduce query complexity and improve performance.
 *
 * Benefits:
 * - Efficient for large datasets
 * - Handles data mutations between requests
 * - Native database support
 * - SEO-friendly URLs
 */

/**
 * Cursor pagination metadata
 */
export interface CursorPaginationMeta {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  nextCursor: string | null;
  previousCursor: string | null;
  totalCount?: number; // Optional, expensive to calculate
}

/**
 * Cursor pagination result
 */
export interface CursorPaginationResult<T> {
  data: T[];
  meta: CursorPaginationMeta;
}

/**
 * Encode value to cursor
 */
export function encodeCursor(value: any): string {
  return Buffer.from(JSON.stringify(value)).toString('base64');
}

/**
 * Decode cursor to value
 */
export function decodeCursor(cursor: string): any {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
  } catch {
    throw new Error('Invalid cursor format');
  }
}

/**
 * Cursor pagination options
 */
export interface CursorPaginationOptions {
  after?: string; // Cursor to start after
  before?: string; // Cursor to start before
  limit?: number; // Items per page (default: 20, max: 100)
  orderBy?: 'asc' | 'desc'; // Sort direction
}

/**
 * Build SQL WHERE clause for cursor pagination
 */
export function buildCursorWhereClause(
  cursorField: string,
  options: CursorPaginationOptions
): { clause: string; params: any[] } {
  const params: any[] = [];
  const clauses: string[] = [];

  // Fetch limit + 1 to determine if there are more results

  if (options.after) {
    const cursor = decodeCursor(options.after);
    const operator = options.orderBy === 'desc' ? '<' : '>';
    clauses.push(`${cursorField} ${operator} $${params.length + 1}`);
    params.push(cursor[cursorField]);
  }

  if (options.before) {
    const cursor = decodeCursor(options.before);
    const operator = options.orderBy === 'desc' ? '>' : '<';
    clauses.push(`${cursorField} ${operator} $${params.length + 1}`);
    params.push(cursor[cursorField]);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  return {
    clause: whereClause,
    params,
  };
}

/**
 * Generate cursor from item
 */
export function generateCursor<T>(item: T, cursorField: keyof T): string {
  const cursorValue = {
    [cursorField]: item[cursorField],
  };
  return encodeCursor(cursorValue);
}

/**
 * Process pagination results
 */
export function processCursorPaginationResults<T>(
  items: T[],
  cursorField: keyof T,
  limit: number,
  options: CursorPaginationOptions,
  totalCount?: number
): CursorPaginationResult<T> {
  // We fetched limit + 1 to check if there are more items
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;

  // Calculate cursors for existing items
  const nextCursor = hasMore ? generateCursor(data[data.length - 1], cursorField) : null;
  const previousCursor = data.length > 0 ? generateCursor(data[0], cursorField) : null;

  // Determine page direction
  const hasPreviousPage = options.after ? data.length > 0 : false;
  const hasNextPage = hasMore;

  return {
    data,
    meta: {
      hasNextPage,
      hasPreviousPage,
      nextCursor,
      previousCursor,
      totalCount,
    },
  };
}

/**
 * Build Order By clause for cursor pagination
 */
export function buildCursorOrderBy(cursorField: string, options: CursorPaginationOptions): string {
  const direction = options.orderBy === 'desc' ? 'DESC' : 'ASC';
  return `ORDER BY ${cursorField} ${direction}`;
}

/**
 * Complete cursor pagination query builder
 */
export function buildCursorPaginationQuery(options: {
  baseQuery: string; // Base SELECT query (without ORDER BY, LIMIT)
  cursorField: string; // Field to use for cursor
  cursorOptions: CursorPaginationOptions;
  countQuery?: string; // Optional count query for totalCount
}) {
  const limit = Math.min(options.cursorOptions.limit || 20, 100);
  const { clause, params } = buildCursorWhereClause(options.cursorField, options.cursorOptions);
  const orderBy = buildCursorOrderBy(options.cursorField, options.cursorOptions);

  // Fetch limit + 1 to determine if there are more results
  const query = `${options.baseQuery} ${clause} ${orderBy} LIMIT ${limit + 1}`;

  return {
    query,
    params,
    limit,
  };
}

/**
 * Express middleware for parsing cursor pagination from query
 */
export function parseCursorPaginationQuery(req: any): CursorPaginationOptions {
  return {
    after: req.query.after as string | undefined,
    before: req.query.before as string | undefined,
    limit: req.query.limit ? Math.min(parseInt(req.query.limit), 100) : 20,
    orderBy: (req.query.orderBy as string) === 'desc' ? 'desc' : 'asc',
  };
}

/**
 * Relay-style cursor connection (GraphQL-compatible)
 */
export interface RelayEdge<T> {
  node: T;
  cursor: string;
}

export interface RelayConnection<T> {
  edges: RelayEdge<T>[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
  totalCount?: number;
}

/**
 * Convert pagination result to Relay connection
 */
export function toRelayConnection<T>(
  result: CursorPaginationResult<T>,
  cursorField: keyof T
): RelayConnection<T> {
  const edges = result.data.map((item) => ({
    node: item,
    cursor: generateCursor(item, cursorField),
  }));

  return {
    edges,
    pageInfo: {
      hasNextPage: result.meta.hasNextPage,
      hasPreviousPage: result.meta.hasPreviousPage,
      startCursor: edges.length > 0 ? edges[0].cursor : null,
      endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
    },
    totalCount: result.meta.totalCount,
  };
}

/**
 * Convert pagination result to REST format with Link headers
 */
export function formatPaginationLinks(
  result: CursorPaginationResult<any>,
  baseUrl: string
): string[] {
  const links: string[] = [];

  if (result.meta.nextCursor) {
    links.push(`<${baseUrl}?after=${result.meta.nextCursor}>; rel="next"`);
  }

  if (result.meta.previousCursor) {
    links.push(`<${baseUrl}?before=${result.meta.previousCursor}>; rel="prev"`);
  }

  return links;
}

/**
 * Helper: Apply cursor pagination to Express response
 */
export function applyCursorPaginationHeaders(
  res: any,
  result: CursorPaginationResult<any>,
  baseUrl: string
) {
  const links = formatPaginationLinks(result, baseUrl);
  if (links.length > 0) {
    res.set('Link', links.join(', '));
  }

  res.set('X-Has-Next-Page', String(result.meta.hasNextPage));
  res.set('X-Has-Previous-Page', String(result.meta.hasPreviousPage));

  if (result.meta.totalCount !== undefined) {
    res.set('X-Total-Count', String(result.meta.totalCount));
  }
}

/**
 * Keyset pagination (offset-free pagination using unique keys)
 * Better performance than cursor pagination for sequential access
 */
export interface KeysetPaginationOptions {
  after?: { id: string; value: any }; // Last key from previous page
  limit?: number;
  orderBy?: 'asc' | 'desc';
  reversePagination?: boolean; // For going backwards
}

/**
 * Build keyset pagination WHERE clause
 */
export function buildKeysetWhereClause(
  primaryKey: string,
  sortKey: string,
  options: KeysetPaginationOptions
): { clause: string; params: any[] } {
  const params: any[] = [];
  const clauses: string[] = [];

  if (options.after) {
    if (options.reversePagination) {
      clauses.push(
        `(${sortKey} < $${params.length + 1} OR (${sortKey} = $${params.length + 1} AND ${primaryKey} < $${params.length + 2}))`
      );
    } else {
      clauses.push(
        `(${sortKey} > $${params.length + 1} OR (${sortKey} = $${params.length + 1} AND ${primaryKey} > $${params.length + 2}))`
      );
    }
    params.push(options.after.value);
    params.push(options.after.id);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  return { clause: whereClause, params };
}
